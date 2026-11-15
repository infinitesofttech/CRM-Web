# Infinite Soft Tech CRM

**Live CRM now runs on PythonAnywhere** (Django app `crm` inside the website project):
`https://infinity3tech.pythonanywhere.com/crm/`

Source of the live app: [`pythonanywhere/crm/`](pythonanywhere/crm). To deploy, copy that folder to
`/home/Infinity3Tech/infinitewebsite/mywebsite/crm/`, add `'crm'` to `INSTALLED_APPS`, add
`path('crm/', include('crm.urls'))` to the project `urls.py`, run `python manage.py migrate crm`, then reload the web app.
Tests: `python manage.py test crm`.

Features: login (admin + employees), dashboard, Leads (website forms sync in automatically), Internship (photo OCR / paste import,
college filter), Expo (paste import with website), equal call distribution, call log + follow-ups, CSV export.

The Next.js code in `src/` was the earlier Vercel version (the Vercel project has been deleted); it is kept only for reference.
