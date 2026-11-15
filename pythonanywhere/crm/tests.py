from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from . import services
from .models import CallLog, Contact


class ServiceTests(TestCase):
    def test_phone_and_parse(self):
        self.assertEqual(services.normalize_phone('94275 70993'), '+91 94275 70993')
        self.assertEqual(services.normalize_phone('+91-9427570993'), '+91 94275 70993')
        self.assertEqual(services.normalize_phone('12345'), '')
        rows = services.parse_lines('ABC Industries, Rajesh Shah, 98242 26405, abc.in, a@b.com\n+91 94275 70993\njunk')
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['company'], 'ABC Industries')
        self.assertEqual(rows[0]['website'], 'abc.in')
        self.assertEqual(rows[0]['email'], 'a@b.com')

    def test_add_dedupe_and_distribute(self):
        made, skipped = services.add_contacts('intern', [{'phone': '94275 70993'}, {'phone': '9427570993'}, {'phone': '12'}])
        self.assertEqual((made, skipped), (1, 2))
        for i in range(6):
            services.add_contacts('intern', [{'phone': '9%d000 00000' % (i + 1)}])
        a = services.create_employee('a', 'A', 'secret1')
        b = services.create_employee('b', 'B', 'secret1')
        n = services.distribute('intern', [a, b])
        self.assertEqual(n, Contact.objects.filter(kind='intern').count())
        self.assertAlmostEqual(a.crm_contacts.count(), b.crm_contacts.count(), delta=1)


class ViewTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user('boss', password='pw123456', is_staff=True)
        self.emp = services.create_employee('ravi', 'Ravi', 'secret1')
        self.emp2 = services.create_employee('meena', 'Meena', 'secret2')
        services.add_contacts('intern', [{'phone': '9427570993'}, {'phone': '9429601735'}], college='ABC College')
        services.distribute('intern', [self.emp, self.emp2])

    def test_anonymous_redirected(self):
        for url in ['/crm/', '/crm/internships/', '/crm/employees/', '/crm/export/intern/']:
            r = self.client.get(url)
            self.assertEqual(r.status_code, 302, url)
            self.assertIn('/crm/login/', r['Location'])

    def test_non_crm_user_forbidden(self):
        User.objects.create_user('rando', password='pw123456')
        self.client.login(username='rando', password='pw123456')
        self.assertEqual(self.client.get('/crm/').status_code, 403)

    def test_admin_pages(self):
        self.client.login(username='boss', password='pw123456')
        for url in ['/crm/', '/crm/leads/', '/crm/internships/', '/crm/expo/', '/crm/employees/',
                    '/crm/internships/?q=94275&status=New&who=none&college=ABC%20College&pending=1&date=2026-01-01']:
            self.assertEqual(self.client.get(url).status_code, 200, url)
        self.assertEqual(self.client.get('/crm/nope/').status_code, 404)
        r = self.client.get('/crm/export/intern/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('+91 94275 70993', r.content.decode())

    def test_employee_scope_and_call(self):
        self.client.login(username='ravi', password='secret1')
        page = self.client.get('/crm/internships/')
        self.assertEqual(page.status_code, 200)
        mine = Contact.objects.get(assigned_to=self.emp)
        theirs = Contact.objects.get(assigned_to=self.emp2)
        self.assertContains(page, mine.phone)
        self.assertNotContains(page, theirs.phone)
        # cannot touch someone else's contact
        self.assertEqual(self.client.post(reverse('crm:call', args=[theirs.pk]), {'outcome': 'Connected'}).status_code, 404)
        r = self.client.post(reverse('crm:call', args=[mine.pk]),
                             {'outcome': 'Connected', 'status': 'Interested', 'note': 'ok', 'follow_up': '2026-12-01'})
        self.assertEqual(r.status_code, 302)
        mine.refresh_from_db()
        self.assertEqual((mine.status, mine.call_count), ('Interested', 1))
        self.assertEqual(CallLog.objects.filter(contact=mine).count(), 1)
        j = self.client.get(reverse('crm:calls', args=[mine.pk])).json()
        self.assertEqual(j['calls'][0]['outcome'], 'Connected')
        # admin-only actions
        self.assertEqual(self.client.get('/crm/employees/').status_code, 403)
        self.assertEqual(self.client.post(reverse('crm:delete', args=[mine.pk])).status_code, 403)
        self.assertEqual(self.client.post(reverse('crm:assign', args=['intern']), {'employees': [self.emp.pk]}).status_code, 403)
        self.assertEqual(self.client.post(reverse('crm:import', args=['intern']), {'text': '9876543210'}).status_code, 403)

    def test_add_edit_import_assign_employee_mgmt(self):
        self.client.login(username='boss', password='pw123456')
        self.client.post(reverse('crm:save', args=['expo']), {'company': 'XYZ Ltd', 'phone': '98765 43210', 'website': 'xyz.in'})
        c = Contact.objects.get(kind='expo')
        self.assertEqual(c.phone, '+91 98765 43210')
        # duplicate rejected
        self.client.post(reverse('crm:save', args=['expo']), {'company': 'Dup', 'phone': '9876543210'})
        self.assertEqual(Contact.objects.filter(kind='expo').count(), 1)
        # edit
        self.client.post(reverse('crm:save', args=['expo']), {'id': c.pk, 'company': 'XYZ Pvt', 'phone': c.phone, 'status': 'Interested'})
        c.refresh_from_db()
        self.assertEqual((c.company, c.status), ('XYZ Pvt', 'Interested'))
        # import + assign
        self.client.post(reverse('crm:import', args=['expo']), {'text': 'A Co, 91234 56789, a.com\nB Co, 99887 76655', 'source': 'IIF'})
        self.assertEqual(Contact.objects.filter(kind='expo').count(), 3)
        self.client.post(reverse('crm:assign', args=['expo']), {'employees': [self.emp.pk, self.emp2.pk]})
        self.assertEqual(Contact.objects.filter(kind='expo', assigned_to__isnull=True).count(), 0)
        # employee management
        self.client.post(reverse('crm:employees'), {'action': 'create', 'name': 'New', 'username': 'newbie', 'password': 'abcdef'})
        self.assertTrue(User.objects.filter(username='newbie').exists())
        self.client.post(reverse('crm:employees'), {'action': 'remove', 'id': self.emp.pk})
        self.assertEqual(Contact.objects.filter(assigned_to=self.emp).count(), 0)
        self.emp.refresh_from_db()
        self.assertFalse(self.emp.is_active)
        # delete
        self.client.post(reverse('crm:delete', args=[c.pk]))
        self.assertFalse(Contact.objects.filter(pk=c.pk).exists())

    def test_unsafe_redirect_ignored(self):
        self.client.login(username='boss', password='pw123456')
        r = self.client.post(reverse('crm:save', args=['expo']), {'company': 'Q', 'next': 'https://evil.com/'})
        self.assertNotIn('evil.com', r['Location'])

    def test_website_sync_and_student_import(self):
        from web.models import ContactUs, Student
        ContactUs.objects.create(Name='Web Lead', Email='w@x.com', MobileNumber='9812345678',
                                 Service='QA_SERVICE', Budget='BELOW_250', ProjectType='NEW_PROJECT', Message='hello')
        self.assertEqual(services.sync_website_leads(force=True), 1)
        self.assertEqual(services.sync_website_leads(force=True), 0)
        self.assertEqual(Contact.objects.get(kind='lead').phone, '+91 98123 45678')
        Student.objects.create(contact='+91 90000 11111', status='callback', college_name='Z College')
        self.assertEqual(services.import_old_students(), 1)
        self.assertEqual(services.import_old_students(), 0)
        c = Contact.objects.get(kind='intern', phone='+91 90000 11111')
        self.assertEqual((c.status, c.college_name), ('Follow-up', 'Z College'))


class ExtraViewTests(TestCase):
    def test_login_and_employee_dashboard(self):
        emp = services.create_employee('ravi', 'Ravi', 'secret1')
        self.assertEqual(self.client.get('/crm/login/').status_code, 200)
        r = self.client.post('/crm/login/', {'username': 'ravi', 'password': 'secret1'})
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.client.get('/crm/').status_code, 200)
        self.assertEqual(self.client.post('/crm/logout/').status_code, 302)
        r = self.client.post('/crm/login/', {'username': 'ravi', 'password': 'bad'})
        self.assertContains(r, 'Wrong username or password')


class NamesOnlyTests(TestCase):
    def test_names_only_import(self):
        User.objects.create_user('boss2', password='pw123456', is_staff=True)
        self.client.login(username='boss2', password='pw123456')
        self.client.post(reverse('crm:import', args=['expo']), {'text': 'Alpha Ltd\nBeta Co\n\n', 'names_only': '1', 'source': 'IIF'})
        self.assertEqual(Contact.objects.filter(kind='expo', phone='').count(), 2)
        r = self.client.get('/crm/expo/')
        self.assertContains(r, 'lubindiaexpo.com/floor-plan')



class FetchLinkTests(TestCase):
    def test_fetch_link_guards_and_template(self):
        User.objects.create_user('boss3', password='pw123456', is_staff=True)
        services.create_employee('e3', 'E3', 'secret1')
        self.assertEqual(self.client.post('/crm/fetch-link/', {'url': 'http://x.com'}).status_code, 302)
        self.client.login(username='e3', password='secret1')
        self.assertEqual(self.client.post('/crm/fetch-link/', {'url': 'http://x.com'}).status_code, 403)
        self.client.login(username='boss3', password='pw123456')
        for bad in ['http://127.0.0.1/', 'http://localhost:8000', 'ftp://x.com', 'nonsense', 'http://169.254.169.254/']:
            self.assertIn('note', self.client.post('/crm/fetch-link/', {'url': bad}).json(), bad)
        page = self.client.get('/crm/expo/').content.decode()
        self.assertIn('id="expoUrl"', page)
        self.assertNotIn('id="imgs"', page)
        self.assertIn('id="imgs"', self.client.get('/crm/internships/').content.decode())



class StructuredImportTests(TestCase):
    def test_upsert_fills_existing_and_adds_new(self):
        services.add_contacts('expo', [{'phone': '7016230106', 'email': 'k@x.com'}], source='Expo')
        rows = [
            {'company': 'Khilan Enterprise', 'phone': '+91 70162 30106', 'website': 'khilan.in', 'address': 'GIDC, Ahmedabad'},
            {'company': 'New Co', 'name': 'Raj', 'phone': '9714938303', 'email': 'n@c.com', 'website': 'newco.com', 'address': 'Surat'},
            {'company': 'New Co dup', 'phone': '97149 38303'},
            {'company': 'No Phone Co'},
            {'name': 'nothing useful'},
        ]
        made, updated, skipped = services.upsert_rows('expo', rows, source='Expo')
        self.assertEqual((made, updated, skipped), (2, 1, 2))
        k = Contact.objects.get(kind='expo', phone='+91 70162 30106')
        self.assertEqual((k.company, k.website, k.address, k.email), ('Khilan Enterprise', 'khilan.in', 'GIDC, Ahmedabad', 'k@x.com'))
        self.assertTrue(Contact.objects.filter(kind='expo', company='No Phone Co').exists())
        self.assertEqual(services.upsert_rows('expo', rows, source='Expo')[:2], (0, 0))

    def test_import_view_rows_json(self):
        import json
        User.objects.create_user('boss4', password='pw123456', is_staff=True)
        self.client.login(username='boss4', password='pw123456')
        data = [{'company': 'ABC Ltd', 'phone': '9824226405', 'website': 'abc.in', 'email': 'a@abc.in', 'address': 'Rajkot'}]
        self.client.post(reverse('crm:import', args=['expo']), {'rows_json': json.dumps(data), 'text': 'x', 'source': 'IIF'})
        c = Contact.objects.get(kind='expo')
        self.assertEqual((c.company, c.address, c.source), ('ABC Ltd', 'Rajkot', 'IIF'))
        page = self.client.get('/crm/expo/?q=Rajkot').content.decode()
        self.assertIn('ABC Ltd', page)
        self.assertIn('Rajkot', page)
        self.assertIn('Rajkot', self.client.get('/crm/export/expo/').content.decode())
        self.client.post(reverse('crm:import', args=['expo']), {'rows_json': 'not json', 'text': ''})
        self.assertEqual(Contact.objects.filter(kind='expo').count(), 1)


class CsvTests(TestCase):
    def test_csv_cells(self):
        User.objects.create_user('boss5', password='pw123456', is_staff=True)
        self.client.login(username='boss5', password='pw123456')
        services.add_contacts('expo', [{'phone': '7016230106', 'name': '=1+1', 'company': '-cmd'}])
        body = self.client.get('/crm/export/expo/').content.decode()
        row = body.splitlines()[1]
        self.assertIn("'=1+1", row)
        self.assertIn("'-cmd", row)
        self.assertIn(',+91 70162 30106,', row)
        self.assertNotIn(",',", row)



class BulkDeleteTests(TestCase):
    def setUp(self):
        User.objects.create_user('boss6', password='pw123456', is_staff=True)
        services.add_contacts('expo', [{'phone': '9%d00000000' % i, 'company': 'Co %d' % i} for i in range(1, 8)])
        services.add_contacts('intern', [{'phone': '9811111111'}])

    def test_selected_and_all_matching(self):
        self.client.login(username='boss6', password='pw123456')
        page = self.client.get('/crm/expo/').content.decode()
        self.assertIn('Company Website', page)
        self.assertIn('Company Address', page)
        self.assertNotIn('<th>Last call</th>', page)
        ids = list(Contact.objects.filter(kind='expo').values_list('id', flat=True)[:2])
        self.client.post(reverse('crm:bulk_delete', args=['expo']), {'ids': ids})
        self.assertEqual(Contact.objects.filter(kind='expo').count(), 5)
        # all matching a search only
        self.client.post(reverse('crm:bulk_delete', args=['expo']), {'all_matching': '1', 'filters': 'q=Co+3'})
        self.assertEqual(Contact.objects.filter(kind='expo').count(), 4)
        # all matching, no filter -> only this kind
        self.client.post(reverse('crm:bulk_delete', args=['expo']), {'all_matching': '1', 'filters': ''})
        self.assertEqual(Contact.objects.filter(kind='expo').count(), 0)
        self.assertEqual(Contact.objects.filter(kind='intern').count(), 1)
        # cannot delete other kind's ids through expo
        iid = Contact.objects.get(kind='intern').id
        self.client.post(reverse('crm:bulk_delete', args=['expo']), {'ids': [iid]})
        self.assertEqual(Contact.objects.filter(kind='intern').count(), 1)

    def test_employee_forbidden(self):
        services.create_employee('e6', 'E6', 'secret1')
        self.client.login(username='e6', password='secret1')
        self.assertEqual(self.client.post(reverse('crm:bulk_delete', args=['expo']), {'all_matching': '1'}).status_code, 403)
        self.assertEqual(Contact.objects.filter(kind='expo').count(), 7)
