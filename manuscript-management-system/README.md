# Manuscript Management System

Secure manuscript submission, editorial review, approval and version control — with role-based access, an audit trail and file storage — built with plain JavaScript + [Vite](https://vitejs.dev) on a **Supabase** backend (Postgres, Auth, Storage). Responsive for phone and laptop, light/dark theme.

| Entry point | URL | Who |
|---|---|---|
| Public portal | `/` | Author, Editor, Other user (role drop-down at sign-in) |
| Admin portal | `/admin/` | Administrators only |

**Roles.** People register themselves. New accounts are *Other user*; choosing Author or Editor at registration (or later, from Profile) creates a **role request** that an administrator approves or rejects. Signing in with a role the account doesn’t hold is refused and logged.

| Role | Can do |
|---|---|
| Author | Upload manuscripts / drafts, upload revisions when returned, track status, see own work only |
| Editor | Review queue, search, start review, approve or return with comment, versions, reports, CSV export |
| Other user | Browse the catalog of approved manuscripts, request a role |
| Administrator | Users & roles, approve role requests, enable/disable accounts, audit trail, reports, exports |

## 1 · Set up Supabase (once)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query →** paste the whole of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. (Safe to re-run.) This creates the tables, row-level security, the workflow functions and the private `manuscripts` storage bucket.
3. **Authentication → URL Configuration:** set *Site URL* to your deployed site, and add these to *Redirect URLs* (add `http://localhost:5173/**` too for local work):
   `https://<your-site>/**` and `https://<your-site>/admin/**`
4. **Authentication → Providers → Email:** keep *Confirm email* on (recommended) or turn it off for instant sign-up. For real use, configure **custom SMTP** (Authentication → SMTP) — Supabase’s built-in mailer is rate-limited. It sends the confirmation and password-reset emails.

## 2 · Configure `.env`

```bash
cp .env.example .env      # then edit .env
```

| Variable | Where it goes | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | browser bundle | Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | browser bundle | The **anon / public** key. Safe to expose; RLS protects data |
| `VITE_APP_NAME` | browser bundle | Optional display name |
| `VITE_MAX_FILE_MB` | browser bundle | Upload limit, 1–50 (default 10) |
| `SUPABASE_SERVICE_ROLE_KEY` | **never in the browser** | Only used by `npm run seed:admin`. Never commit it, never prefix with `VITE_` |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | **never in the browser** | Used only by `npm run seed:admin` to create the administrator |

> Why the admin password isn’t read by the website: anything in a browser app is public. The password is used **once, server-side**, to create the account in Supabase Auth (stored hashed there). To change it later, edit `.env` and run `npm run seed:admin` again.

## 3 · Run

```bash
npm install
npm run seed:admin        # creates the administrator from .env
npm run dev               # http://localhost:5173  and  http://localhost:5173/admin/
```

Open `/admin/` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. If Supabase isn’t configured, the site shows a setup screen instead of failing.

## 4 · Deploy to GitHub Pages

1. Push this repo to GitHub (`.env` is git-ignored — never commit it).
2. **Settings → Secrets and variables → Actions → New repository secret** (secrets or variables both work for the first two):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — optional variables: `VITE_APP_NAME`, `VITE_MAX_FILE_MB`.
3. **Settings → Pages → Source: GitHub Actions**, then push to `main`. The workflow builds with your values and publishes. The site is at `https://<user>.github.io/<repo>/` and the admin portal at `.../admin/`. A custom domain works the same way (`https://yourdomain/admin/`).
4. **Create the admin without a terminal:** add secrets `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (and optionally `ADMIN_NAME`), then **Actions → “Seed administrator (manual)” → Run workflow**.

Any static host works too (Netlify, Cloudflare Pages, Vercel): build command `npm run build`, output directory `dist`, and set the same `VITE_*` variables in the host’s settings.

## How security works

- **Row-level security:** Authors read only their own manuscripts; Editors read submitted/reviewed work (not drafts); Other users read only *Approved* manuscripts (no files or versions); only Administrators read users and the audit log. Disabled accounts read nothing.
- **No direct writes:** the browser has no insert/update/delete rights on tables. Every change (submit, review, approve, role change…) goes through a database function that re-checks the caller’s role and the workflow state — so the UI can’t be bypassed with developer tools.
- **Files:** stored in a private bucket; downloads use 60-second signed URLs; type and size are enforced in the browser and the bucket.
- **Separate sessions:** `/` and `/admin/` keep independent sign-ins. Admin accounts are refused on the public portal and vice-versa; refusals are written to the audit log.
- **Passwords:** handled by Supabase Auth (hashed, with email reset). Failed logins are visible in Supabase → Authentication → Logs (they can’t be written to the app audit log because the user isn’t signed in).

## Project structure

```
index.html, admin/index.html   Entry pages (public / admin)
src/config.js                  Reads VITE_* environment variables
src/supabase.js                Supabase client (separate session per portal)
src/api.js                     Data loading, RPC calls, file upload/download
src/views.js                   All pages (login, dashboards, admin, …)
src/app.js                     Sign-in rules, actions, events, boot
src/styles.css                 Responsive light/dark styles
supabase/schema.sql            Tables, RLS, workflow functions, storage bucket
scripts/seed-admin.mjs         Creates/updates the admin from .env
.github/workflows/             Pages deploy + manual admin seeding
```

## Troubleshooting

- **“Setup required” screen:** `.env` missing/incorrect, or (on GitHub) the Actions secrets weren’t set before the build — add them and re-run the workflow.
- **Reset email link lands on the wrong page / “redirect not allowed”:** add the URL to *Redirect URLs* (step 1.3).
- **“Please confirm your email”:** the user must click the confirmation email, or disable *Confirm email* in Supabase.
- **Can’t sign in as admin:** run `npm run seed:admin` again (it also resets the password), and make sure `schema.sql` was run first.
- **Notifications are in-app only.** Email delivery of workflow notifications would need an Edge Function or database webhook.

MIT licence – see `LICENSE`.
