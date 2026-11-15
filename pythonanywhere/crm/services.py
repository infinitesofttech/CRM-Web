import re
import time

from django.contrib.auth.models import Group, User
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import Contact

PHONE_RE = re.compile(r'(?:\+?\s*91[\s-]*)?0?[6-9](?:[\s-]?\d){9}')
EMAIL_RE = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
SITE_RE = re.compile(
    r'(?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|co\.in|org|net|biz|info)\b(?:/[^\s,;|]*)?', re.I)
EMPLOYEE_GROUP = 'CRM Employee'


def normalize_phone(raw):
    d = re.sub(r'\D', '', raw or '')
    if len(d) == 12 and d.startswith('91'):
        d = d[2:]
    elif len(d) == 11 and d.startswith('0'):
        d = d[1:]
    if re.fullmatch(r'[6-9]\d{9}', d):
        return '+91 %s %s' % (d[:5], d[5:])
    return ''


def extract_numbers(text):
    out = []
    for m in PHONE_RE.finditer(text or ''):
        p = normalize_phone(m.group(0))
        if p and p not in out:
            out.append(p)
    return out


def parse_lines(text):
    """Each line may hold 'Company, Name, phone, website, email' in any order. Only the phone is required."""
    rows, seen = [], set()
    for line in (text or '').splitlines():
        phones = extract_numbers(line)
        if not phones:
            continue
        no_email = EMAIL_RE.sub(' ', line)
        site = SITE_RE.search(no_email)
        rest = PHONE_RE.sub(' ', SITE_RE.sub(' ', no_email))
        parts = [re.sub(r'\s+', ' ', p).strip() for p in re.split(r'[,\t|;]', rest)]
        parts = [p for p in parts if p and not re.fullmatch(r'[-+\d\s]*', p)]
        email = EMAIL_RE.search(line)
        for ph in phones:
            if ph in seen:
                continue
            seen.add(ph)
            rows.append({
                'company': parts[0] if parts else '',
                'name': parts[1] if len(parts) > 1 else '',
                'phone': ph,
                'email': email.group(0) if email else '',
                'website': site.group(0) if site else '',
            })
    return rows


def add_contacts(kind, items, source='Manual', college='', assigned_to=None):
    """Insert contacts, skipping invalid / duplicate phones. Returns (created, skipped)."""
    existing = set(Contact.objects.filter(kind=kind).exclude(phone='').values_list('phone', flat=True))
    new, skipped = [], 0
    for it in items:
        raw = it.get('phone', '')
        phone = normalize_phone(raw)
        has_label = bool(it.get('name') or it.get('company'))
        if (raw and not phone) or (phone and phone in existing) or (not phone and not has_label):
            skipped += 1
            continue
        if phone:
            existing.add(phone)
        new.append(Contact(
            kind=kind, phone=phone,
            name=(it.get('name') or '').strip()[:120],
            company=(it.get('company') or '').strip()[:160],
            email=(it.get('email') or '').strip()[:160],
            website=(it.get('website') or '').strip()[:200],
            address=(it.get('address') or '').strip()[:255],
            college_name=(it.get('college_name') or college or '').strip()[:120],
            notes=(it.get('notes') or '')[:2000],
            source=(it.get('source') or source)[:80],
            assigned_to=assigned_to,
        ))
    if new:
        Contact.objects.bulk_create(new, batch_size=200)
    return len(new), skipped


def distribute(kind, users, reassign=False, college=''):
    """Round-robin contacts of a kind equally between the given users."""
    qs = Contact.objects.filter(kind=kind)
    if not reassign:
        qs = qs.filter(assigned_to__isnull=True)
    if college:
        qs = qs.filter(college_name__iexact=college)
    ids = list(qs.order_by('created_at', 'id').values_list('id', flat=True))
    users = list(users)
    if not users or not ids:
        return 0
    with transaction.atomic():
        for i, u in enumerate(users):
            chunk = ids[i::len(users)]
            for s in range(0, len(chunk), 500):
                Contact.objects.filter(id__in=chunk[s:s + 500]).update(assigned_to=u)
    return len(ids)


def is_admin(user):
    return bool(user.is_authenticated and user.is_active and (user.is_superuser or user.is_staff))


def has_access(user):
    if is_admin(user):
        return True
    return bool(user.is_authenticated and user.is_active and user.groups.filter(name=EMPLOYEE_GROUP).exists())


def employees():
    return User.objects.filter(is_active=True, groups__name=EMPLOYEE_GROUP, is_staff=False,
                               is_superuser=False).order_by('first_name', 'username')


def create_employee(username, name, password):
    g, _ = Group.objects.get_or_create(name=EMPLOYEE_GROUP)
    u = User.objects.create_user(username=username, password=password, first_name=name)
    u.groups.add(g)
    return u


def display_name(user):
    return user.get_full_name() or user.first_name or user.username


# ---------- website forms -> leads, old student list -> internship ----------

_last_sync = [0.0]


def sync_website_leads(force=False):
    """Copy new website form submissions into CRM leads (idempotent, throttled). Never raises."""
    if not force and time.time() - _last_sync[0] < 30:
        return 0
    _last_sync[0] = time.time()
    try:
        from web.models import ContactInquiry, ContactUs, CourseDemo, Curriculum
    except Exception:
        return 0
    made = 0
    have = set(Contact.objects.filter(ext_ref__isnull=False).values_list('ext_ref', flat=True))

    def put(ref, name, phone, email, note, source, created):
        nonlocal made
        if ref in have:
            return
        have.add(ref)
        p = normalize_phone(phone)
        if p:
            old = Contact.objects.filter(kind='lead', phone=p).first()
            if old:
                old.notes = ('%s\n[%s] %s' % (old.notes, source, note)).strip()[:2000]
                old.save(update_fields=['notes', 'updated_at'])
                return
        try:
            with transaction.atomic():
                Contact.objects.create(
                    kind='lead', name=(name or '')[:120], phone=p, email=(email or '')[:160],
                    notes=(note if p else '%s\nPhone given: %s' % (note, phone))[:2000],
                    source=source, ext_ref=ref, created_at=created or timezone.now())
            made += 1
        except IntegrityError:
            pass

    try:
        for r in ContactUs.objects.all():
            put('contactus:%s' % r.id, r.Name, r.MobileNumber, r.Email,
                '%s | Budget: %s | %s\n%s' % (r.get_Service_display(), r.get_Budget_display(),
                                              r.get_ProjectType_display(), r.Message),
                'Website: Contact Us', r.CreatedAt)
        for r in ContactInquiry.objects.all():
            put('inquiry:%s' % r.pk, r.Name, r.ContactNo, r.Email, '%s\n%s' % (r.Subject, r.Message),
                'Website: Inquiry', r.CreatedDate)
        for r in CourseDemo.objects.select_related('course'):
            put('demo:%s' % r.id, r.fullname, r.mobileNo, r.email, 'Course demo: %s' % r.course.title,
                'Website: Course Demo', r.created_at)
        for r in Curriculum.objects.select_related('course'):
            put('curriculum:%s' % r.id, r.fullname, r.mobileNo, r.email,
                'Curriculum request: %s' % r.course.title, 'Website: Curriculum', r.created_at)
    except Exception:
        pass
    return made


STUDENT_STATUS = {
    'pending': 'New', 'called': 'Called', 'interested': 'Interested', 'not_interested': 'Not Interested',
    'callback': 'Follow-up', 'no_answer': 'No Answer', 'wrong_number': 'Wrong Number', 'selected': 'Selected',
}


def import_old_students():
    """One-time copy of the old web.Student call list into CRM internships (idempotent)."""
    from web.models import Student
    done = set(Contact.objects.filter(ext_ref__startswith='student:').values_list('ext_ref', flat=True))
    seen = set(Contact.objects.filter(kind='intern').exclude(phone='').values_list('phone', flat=True))
    new = []
    for s in Student.objects.all().order_by('id'):
        ref = 'student:%s' % s.id
        phone = normalize_phone(s.contact)
        if ref in done or not phone or phone in seen:
            continue
        seen.add(phone)
        new.append(Contact(
            kind='intern', name=s.name or '', phone=phone, college_name=s.college_name or '',
            status=STUDENT_STATUS.get(s.status, 'New'), notes=s.message or '',
            source='Old student list', ext_ref=ref, created_at=s.created_at))
    Contact.objects.bulk_create(new, batch_size=200)
    return len(new)


UPSERT_LIMITS = {'company': 160, 'name': 120, 'email': 160, 'website': 200, 'address': 255}


def upsert_rows(kind, items, source='Import'):
    """Structured import (from an expo link). New phones are added; existing phones get company, name,
    website, email and address refreshed with the non-empty values from the link. Returns (created, updated, skipped)."""
    existing = list(Contact.objects.filter(kind=kind))
    by_phone = {c.phone: c for c in existing if c.phone}
    companies = {c.company.lower() for c in existing if c.company and not c.phone}
    new, changed, skipped, seen = [], {}, 0, set()
    now = timezone.now()
    for it in items:
        clean = {f: str(it.get(f) or '').strip()[:n] for f, n in UPSERT_LIMITS.items()}
        notes = str(it.get('notes') or '').strip()[:1000]
        phone = normalize_phone(str(it.get('phone') or ''))
        if not phone and not clean['company']:
            skipped += 1
            continue
        key = phone or clean['company'].lower()
        if key in seen:
            skipped += 1
            continue
        seen.add(key)
        old = by_phone.get(phone) if phone else None
        if old is None and not phone and key in companies:
            skipped += 1
            continue
        if old is not None:
            dirty = False
            for f, v in clean.items():
                if v and v != getattr(old, f):   # link data is the source of truth for these fields
                    setattr(old, f, v)
                    dirty = True
            if notes and notes not in old.notes:
                old.notes = ('%s\n%s' % (old.notes, notes)).strip()[:2000]
                dirty = True
            if dirty:
                old.updated_at = now
                changed[old.pk] = old
            else:
                skipped += 1
            continue
        new.append(Contact(kind=kind, phone=phone, source=source[:80], notes=notes, **clean))
    if new:
        Contact.objects.bulk_create(new, batch_size=200)
    if changed:
        Contact.objects.bulk_update(list(changed.values()), list(UPSERT_LIMITS) + ['notes', 'updated_at'], batch_size=200)
    return len(new), len(changed), skipped
