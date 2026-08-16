# Mini CRM

A minimal lead-calling dashboard: upload an Excel file of leads, agents log in
with a name + PIN, see only their assigned leads, and mark each one New /
Called / Qualified / Not Qualified with a notes field.

## Environment variables (set these in Vercel → Project → Settings → Environment Variables)

- `DATABASE_URL` — set automatically when you add Neon Postgres storage in Vercel.
- `SESSION_SECRET` — any long random string, used to sign login sessions.
- `INIT_SECRET` — any string you choose, used to protect the one-time setup URL.
- `INIT_ADMIN_NAME` (optional) — first admin's login name, defaults to `admin`.
- `INIT_ADMIN_PIN` (optional) — first admin's PIN, defaults to `1234` (change this!).

## First-time setup after deploying

1. Visit `https://YOUR-APP.vercel.app/api/init?key=YOUR_INIT_SECRET` once.
   This creates the database tables and your first admin login.
2. Log in at `/login` with the admin name + PIN from step 1.
3. Under the **Users** tab, add your agents (name + PIN each).
4. Under the **Upload Leads** tab, upload your Excel file. Include a column
   named Name, Mobile, Source, Language, and Owner (the agent's exact name).
5. Agents log in and see only their own leads under `/dashboard`.

## Local development

```
npm install
npm run dev
```
