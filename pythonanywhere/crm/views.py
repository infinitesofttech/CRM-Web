import csv
import datetime
import ipaddress
import json
import re
import socket
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo
from functools import wraps

from django.contrib import messages
from django.contrib.auth import logout as auth_logout
from django.contrib.auth.models import User
from django.core.paginator import Paginator
from django.db.models import Count, F, Q
from django.http import Http404, HttpResponse, HttpResponseForbidden, JsonResponse, QueryDict
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.http import require_POST

from . import services
from .models import CALL_OUTCOMES, CLOSED, KINDS, SLUG_TO_KIND, CallLog, Contact

IST = ZoneInfo('Asia/Kolkata')

BADGE = {
    'New': 'b-new', 'Won': 'b-good', 'Joined': 'b-good', 'Selected': 'b-good', 'Lost': 'b-bad',
    'Not Interested': 'b-bad', 'Wrong Number': 'b-bad', 'Interested': 'b-info', 'Follow-up': 'b-warn',
    'No Answer': 'b-warn',
}


def crm_required(admin=False):
    def deco(view):
        @wraps(view)
        def wrapper(request, *a, **kw):
            if not request.user.is_authenticated:
                return redirect('%s?next=%s' % (reverse('crm:login'), request.get_full_path()))
            if not services.has_access(request.user) or (admin and not services.is_admin(request.user)):
                return HttpResponseForbidden('You do not have access to this page.')
            timezone.activate(IST)
            try:
                return view(request, *a, **kw)
            finally:
                timezone.deactivate()
        return wrapper
    return deco


def _back(request, default):
    nxt = request.POST.get('next') or request.GET.get('next') or ''
    if nxt and url_has_allowed_host_and_scheme(nxt, allowed_hosts={request.get_host()}):
        return redirect(nxt)
    return redirect(default)


def _scope(request, qs):
    return qs if services.is_admin(request.user) else qs.filter(assigned_to=request.user)


def _kind_or_404(kind):
    if kind not in KINDS:
        raise Http404
    return kind


def _parse_date(s):
    try:
        return datetime.date.fromisoformat(s) if s else None
    except ValueError:
        return None


def logout_view(request):
    auth_logout(request)
    return redirect('crm:login')


# ------------------------------------------------------------------ dashboard
@crm_required()
def dashboard(request):
    admin = services.is_admin(request.user)
    services.sync_website_leads()
    today = timezone.localdate()
    qs = _scope(request, Contact.objects.all())
    start = timezone.make_aware(datetime.datetime.combine(today, datetime.time.min))
    calls_today = CallLog.objects.filter(created_at__gte=start)
    if not admin:
        calls_today = calls_today.filter(by=request.user)

    by_kind = {}
    for row in qs.values('kind', 'status').annotate(n=Count('id')):
        by_kind.setdefault(row['kind'], {})[row['status']] = row['n']
    cards = []
    for k, cfg in KINDS.items():
        counts = by_kind.get(k, {})
        cards.append({'slug': cfg['slug'], 'title': cfg['title'], 'total': sum(counts.values()),
                      'rows': [(s, counts.get(s, 0)) for s in cfg['statuses']]})

    work = []
    if admin:
        users = list(services.employees())
        stats = {r['assigned_to']: r for r in Contact.objects.exclude(assigned_to=None).values('assigned_to').annotate(
            total=Count('id'), called=Count('id', filter=Q(call_count__gt=0)))}
        today_calls = {r['by']: r['n'] for r in calls_today.values('by').annotate(n=Count('id'))}
        for u in users:
            s = stats.get(u.id, {'total': 0, 'called': 0})
            work.append({'name': services.display_name(u), 'total': s['total'], 'called': s['called'],
                         'pending': s['total'] - s['called'], 'today': today_calls.get(u.id, 0)})
    due = qs.filter(follow_up__lte=today).exclude(status__in=CLOSED).order_by('follow_up')[:10]
    return render(request, 'crm/dashboard.html', {
        'cards': cards, 'work': work, 'is_admin': admin, 'active': 'dashboard',
        'total': qs.count(), 'calls_today': calls_today.count(),
        'due_count': qs.filter(follow_up__lte=today).exclude(status__in=CLOSED).count(),
        'uncalled': qs.filter(call_count=0).count(), 'due': due,
    })


# ------------------------------------------------------------------ list
def _filter(qs, p, admin):
    """Apply the list filters (search, status, employee, college, date, not-called) from a GET/POST dict."""
    f = {'q': p.get('q', '').strip(), 'status': p.get('status', ''), 'who': p.get('who', '') if admin else '',
         'college': p.get('college', '').strip(), 'date': p.get('date', ''), 'pending': p.get('pending') == '1'}
    if f['q']:
        q = f['q']
        qs = qs.filter(Q(name__icontains=q) | Q(company__icontains=q) | Q(phone__icontains=q) |
                       Q(email__icontains=q) | Q(website__icontains=q) | Q(address__icontains=q) |
                       Q(notes__icontains=q))
    if f['status']:
        qs = qs.filter(status=f['status'])
    if f['who'] == 'none':
        qs = qs.filter(assigned_to__isnull=True)
    elif f['who'].isdigit():
        qs = qs.filter(assigned_to_id=int(f['who']))
    if f['college']:
        qs = qs.filter(college_name__iexact=f['college'])
    d = _parse_date(f['date'])
    if d:
        qs = qs.filter(created_at__date=d)
    if f['pending']:
        qs = qs.filter(call_count=0)
    return qs, f


@crm_required()
def contact_list(request, slug):
    kind = SLUG_TO_KIND.get(slug)
    if not kind:
        raise Http404
    cfg = KINDS[kind]
    admin = services.is_admin(request.user)
    if kind == 'lead':
        services.sync_website_leads()

    base = _scope(request, Contact.objects.filter(kind=kind))
    qs, f = _filter(base, request.GET, admin)
    q, status, who, college, date, pending = f['q'], f['status'], f['who'], f['college'], f['date'], f['pending']

    page = Paginator(qs.select_related('assigned_to'), 25).get_page(request.GET.get('page'))
    for c in page:
        c.badge = BADGE.get(c.status, 'b-other')
        c.assignee = services.display_name(c.assigned_to) if c.assigned_to else ''
    qd = request.GET.copy()
    qd.pop('page', None)
    colleges = []
    if kind == 'intern':
        colleges = list(base.exclude(college_name='').values('college_name').annotate(n=Count('id')).order_by('-n'))
    return render(request, 'crm/contacts.html', {
        'kind': kind, 'cfg': cfg, 'page': page, 'q': q, 'status': status, 'who': who, 'college': college,
        'date': date, 'pending': pending, 'is_admin': admin, 'active': cfg['slug'],
        'base_query': qd.urlencode(), 'total': base.count(), 'uncalled': base.filter(call_count=0).count(),
        'employees': list(services.employees()) if admin else [], 'colleges': colleges,
        'outcomes': CALL_OUTCOMES, 'full_path': request.get_full_path(),
        'unassigned': Contact.objects.filter(kind=kind, assigned_to__isnull=True).count() if admin else 0,
    })


# ------------------------------------------------------------------ create / edit / delete
@crm_required()
@require_POST
def contact_save(request, kind):
    _kind_or_404(kind)
    admin = services.is_admin(request.user)
    f = request.POST
    default = reverse('crm:list', args=[KINDS[kind]['slug']])
    raw_phone = f.get('phone', '').strip()
    phone = services.normalize_phone(raw_phone) or services.landline(raw_phone)
    if raw_phone and not phone:
        messages.error(request, 'Valid 10 digit mobile athva STD landline number lakho.')
        return _back(request, default)
    pk = f.get('id')
    if pk:
        c = get_object_or_404(_scope(request, Contact.objects.filter(kind=kind)), pk=pk)
    else:
        if not (phone or f.get('name') or f.get('company')):
            messages.error(request, 'Name, company athva number aapo.')
            return _back(request, default)
        c = Contact(kind=kind, source='Manual', assigned_to=None if admin else request.user)
    if phone and Contact.objects.filter(kind=kind, phone=phone).exclude(pk=c.pk).exists():
        messages.error(request, 'Aa number already list ma che.')
        return _back(request, default)
    c.phone = phone
    c.name = f.get('name', '').strip()[:120]
    c.company = f.get('company', '').strip()[:160]
    c.email = f.get('email', '').strip()[:160]
    c.website = f.get('website', '').strip()[:200]
    if 'address' in f:
        c.address = f.get('address', '').strip()[:255]
    c.college_name = f.get('college_name', '').strip()[:120]
    c.notes = f.get('notes', '')[:2000]
    if f.get('status') in KINDS[kind]['statuses']:
        c.status = f['status']
    if 'follow_up' in f:
        c.follow_up = _parse_date(f.get('follow_up'))
    if admin and 'assigned_to' in f:
        c.assigned_to = User.objects.filter(pk=f['assigned_to']).first() if f['assigned_to'].isdigit() else None
    c.save()
    messages.success(request, 'Saved.')
    return _back(request, default)


@crm_required(admin=True)
@require_POST
def contact_delete(request, pk):
    c = get_object_or_404(Contact, pk=pk)
    default = reverse('crm:list', args=[KINDS[c.kind]['slug']])
    c.delete()
    messages.success(request, 'Deleted.')
    return _back(request, default)


@crm_required(admin=True)
@require_POST
def bulk_delete(request, kind):
    """Delete the ticked contacts, or every contact matching the current filters."""
    _kind_or_404(kind)
    default = reverse('crm:list', args=[KINDS[kind]['slug']])
    base = Contact.objects.filter(kind=kind)
    if request.POST.get('all_matching') == '1':
        qs, _ = _filter(base, QueryDict(request.POST.get('filters', '')), True)
    else:
        ids = [int(i) for i in request.POST.getlist('ids') if i.isdigit()]
        qs = base.filter(id__in=ids)
    n = qs.count()
    if not n:
        messages.warning(request, 'Koi contact select nathi karyo.')
        return _back(request, default)
    qs.delete()
    messages.success(request, '%d contacts delete thaya.' % n)
    return redirect(default)


# ------------------------------------------------------------------ calls
@crm_required()
@require_POST
def call_log(request, pk):
    c = get_object_or_404(_scope(request, Contact.objects.all()), pk=pk)
    f = request.POST
    default = reverse('crm:list', args=[KINDS[c.kind]['slug']])
    outcome = f.get('outcome', '')
    if outcome not in CALL_OUTCOMES:
        messages.error(request, 'Call result select karo.')
        return _back(request, default)
    CallLog.objects.create(contact=c, by=request.user, by_name=services.display_name(request.user),
                           outcome=outcome, note=f.get('note', '')[:1000])
    if f.get('status') in KINDS[c.kind]['statuses']:
        c.status = f['status']
    c.follow_up = _parse_date(f.get('follow_up'))
    c.call_count = F('call_count') + 1
    c.last_call_at = timezone.now()
    c.save(update_fields=['status', 'follow_up', 'call_count', 'last_call_at', 'updated_at'])
    messages.success(request, 'Call saved.')
    return _back(request, default)


@crm_required()
def call_history(request, pk):
    c = get_object_or_404(_scope(request, Contact.objects.all()), pk=pk)
    return JsonResponse({'calls': [
        {'at': timezone.localtime(x.created_at).strftime('%d %b %Y %I:%M %p'), 'by': x.by_name,
         'outcome': x.outcome, 'note': x.note} for x in c.calls.all()[:50]]})


# ------------------------------------------------------------------ import / assign / export
@crm_required(admin=True)
@require_POST
def import_view(request, kind):
    _kind_or_404(kind)
    text = request.POST.get('text', '')
    if request.POST.get('names_only') == '1':
        # one company name per line, phone numbers can be added later
        rows = [{'company': ln.strip()[:160]} for ln in text.splitlines() if ln.strip()]
    else:
        rows = services.parse_lines(text)
    college = request.POST.get('college_name', '').strip()
    source = request.POST.get('source', '').strip() or {'intern': 'College group', 'expo': 'Expo', 'lead': 'Import'}[kind]
    rows_json = request.POST.get('rows_json', '').strip()
    if rows_json:
        try:
            items = json.loads(rows_json)
        except ValueError:
            items = []
        items = [i for i in items if isinstance(i, dict)][:5000] if isinstance(items, list) else []
        made, updated, skipped = services.upsert_rows(kind, items, source=source)
        messages.success(request, '%d navi company add thai, %d juni company ni details update thai, %d skip.'
                         % (made, updated, skipped))
        return redirect('crm:list', slug=KINDS[kind]['slug'])
    if not rows:
        messages.warning(request, 'Koi valid mobile number / company maryo nahi.')
    else:
        made, skipped = services.add_contacts(kind, rows, source=source, college=college)
        messages.success(request, '%d added, %d skipped (duplicate / invalid). Have "Divide calls" use karo.' % (made, skipped))
    return redirect('crm:list', slug=KINDS[kind]['slug'])


@crm_required(admin=True)
@require_POST
def assign_view(request, kind):
    _kind_or_404(kind)
    ids = [int(i) for i in request.POST.getlist('employees') if i.isdigit()]
    users = services.employees().filter(pk__in=ids)
    if not users:
        messages.error(request, 'Ochha ma ochha ek employee select karo.')
    else:
        n = services.distribute(kind, users, reassign=request.POST.get('reassign') == '1',
                                college=request.POST.get('college_name', '').strip())
        messages.success(request, '%d contacts %d employee(s) ma equal vahenchaya.' % (n, len(users)))
    return redirect('crm:list', slug=KINDS[kind]['slug'])


@crm_required(admin=True)
def export_csv(request, kind):
    _kind_or_404(kind)
    resp = HttpResponse(content_type='text/csv')
    resp['Content-Disposition'] = 'attachment; filename="crm-%s.csv"' % KINDS[kind]['slug']
    w = csv.writer(resp)
    w.writerow(['Name', 'Company', 'Phone', 'Email', 'Website', 'Address', 'College', 'Status', 'Assigned to',
                'Calls', 'Last call', 'Follow-up', 'Source', 'Notes', 'Added'])
    for c in Contact.objects.filter(kind=kind).select_related('assigned_to').iterator():
        def safe(v):  # stop spreadsheet formula injection
            v = '' if v is None else str(v)
            risky = v[:1] in ('=', '@') or (v[:1] in ('+', '-') and not re.fullmatch(r'[+\-\d\s()]+', v))
            return "'" + v if risky else v
        w.writerow([safe(x) for x in [
            c.name, c.company, c.phone, c.email, c.website, c.address, c.college_name, c.status,
            services.display_name(c.assigned_to) if c.assigned_to else '', c.call_count,
            c.last_call_at.strftime('%Y-%m-%d %H:%M') if c.last_call_at else '',
            c.follow_up or '', c.source, c.notes, c.created_at.strftime('%Y-%m-%d')]])
    return resp


# ------------------------------------------------------------------ employees
@crm_required(admin=True)
def employees_view(request):
    if request.method == 'POST':
        act = request.POST.get('action')
        if act == 'create':
            username = request.POST.get('username', '').strip().lower()
            name = request.POST.get('name', '').strip()
            pw = request.POST.get('password', '')
            if not name or len(pw) < 6 or not username.replace('.', '').replace('_', '').replace('-', '').isalnum():
                messages.error(request, 'Name, username (letters/numbers) ane password (6+) joiye.')
            elif User.objects.filter(username__iexact=username).exists():
                messages.error(request, 'Aa username already che.')
            else:
                services.create_employee(username, name, pw)
                messages.success(request, 'Employee add thayo.')
        else:
            u = get_object_or_404(services.employees(), pk=request.POST.get('id') or 0)
            if act == 'password' and len(request.POST.get('password', '')) >= 6:
                u.set_password(request.POST['password'])
                u.save()
                messages.success(request, 'Password badlayo.')
            elif act == 'remove':
                Contact.objects.filter(assigned_to=u).update(assigned_to=None)
                u.is_active = False
                u.save()
                messages.success(request, 'Employee remove thayo; tena contacts unassigned thaya.')
        return redirect('crm:employees')
    stats = {r['assigned_to']: r for r in Contact.objects.exclude(assigned_to=None).values('assigned_to').annotate(
        total=Count('id'), called=Count('id', filter=Q(call_count__gt=0)))}
    rows = []
    for u in services.employees():
        s = stats.get(u.id, {'total': 0, 'called': 0})
        rows.append({'u': u, 'name': services.display_name(u), 'total': s['total'], 'called': s['called']})
    return render(request, 'crm/employees.html', {'rows': rows, 'is_admin': True, 'active': 'employees'})


# ------------------------------------------------------------------ expo link -> list (admin)
def _public_host(host):
    try:
        for info in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
        return True
    except Exception:
        return False


def _json_lines(data, out):
    if isinstance(data, list):
        for d in data:
            _json_lines(d, out)
    elif isinstance(data, dict):
        def pick(*keys):
            for k, val in data.items():
                if any(x in k.lower() for x in keys) and isinstance(val, (str, int)) and str(val).strip():
                    return str(val).strip()
            return ''
        phone = pick('phone', 'mobile', 'contact', 'whatsapp')
        if phone:
            out.append(', '.join([pick('company', 'firm', 'business', 'brand', 'exhibitor'), pick('person', 'owner'),
                                  phone, pick('web', 'site'), pick('mail')]))
        for val in data.values():
            if isinstance(val, (dict, list)):
                _json_lines(val, out)


@crm_required(admin=True)
@require_POST
def fetch_link(request):
    url = request.POST.get('url', '').strip()
    u = urllib.parse.urlparse(url)
    if u.scheme not in ('http', 'https') or not u.hostname or not _public_host(u.hostname):
        return JsonResponse({'note': 'Valid public link nakho.'})
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 CRM-Importer'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read(3000000).decode('utf8', 'replace')
    except Exception:
        return JsonResponse({'note': 'Server aa link khodi shakyo nahi (PythonAnywhere free plan bahar na sites ne rok che, '
                                     'athva site e block karyu). Niche "Link thi list na aave to" ni rit vapro.'})
    lines = []
    try:
        _json_lines(json.loads(raw), lines)
    except ValueError:
        text = re.sub(r'(?is)<(script|style).*?</\1>', ' ', raw)
        text = re.sub(r'(?i)</(tr|li|p|div|h\d)>|<br\s*/?>', '\n', text)
        text = re.sub(r'<[^>]+>', ' ', text).replace('&nbsp;', ' ').replace('&amp;', '&')
        lines = [', '.join(x for x in (r['company'], r['name'], r['phone'], r['website'], r['email']) if x)
                 for r in services.parse_lines(text)]
    if not lines:
        return JsonResponse({'note': 'Aa link par koi phone number nathi mali. Expo sites ghani vaar list JavaScript thi load kare che; '
                                     'niche ni rit vapro.'})
    return JsonResponse({'lines': lines[:2000]})
