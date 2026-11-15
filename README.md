# Infinite Soft Tech CRM

Next.js 16 + Tailwind 4 + TypeScript. Leads (clients), Internship (students) and Expo clients with employee call distribution.

- **Roles**: admin (env `ADMIN_USERNAME` / `ADMIN_PASSWORD`) and employees (created in the Employees tab; they only see contacts assigned to them).
- **Leads**: add manually, or the website form can POST to `/api/public/lead` with `{ key: LEAD_KEY, name, phone, email, company, message }`.
- **Internship**: upload WhatsApp-group screenshots (OCR runs in the browser) or paste numbers, then divide calls to employees.
- **Expo**: paste the expo exhibitor list or a link, then divide calls.
- **Storage**: Upstash Redis (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) in production; `.data/db.json` locally.

See `.env.example`. Local: `npm install && npm run dev` (login admin / admin123 in dev only).
