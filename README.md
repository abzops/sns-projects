# StacknStock Projects

React + Vite project management app using Supabase Auth, Postgres, and Row Level Security.

## Local Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create `.env` from `.env.example`:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Fill in your Supabase values:

   ```env
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-key
   ```

4. Run the app:

   ```powershell
   npm run dev -- --host 127.0.0.1 --port 5173
   ```

5. Open:

   ```text
   http://127.0.0.1:5173/
   ```

## GitHub Pages Deployment

This app is deployed by `.github/workflows/deploy-pages.yml`.

For the live site to connect to Supabase, add these repository variables in GitHub:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then push to `main`. GitHub Actions builds `dist/` and deploys it to:

```text
https://abzops.github.io/sns-projects/
```

## Supabase Setup

1. Create a Supabase project.
2. In Supabase Auth, enable the Email provider.
3. Add these Auth URLs:
   - Site URL: `http://127.0.0.1:5173`
   - Redirect URL: `http://127.0.0.1:5173/*`
   - Site URL for GitHub Pages: `https://abzops.github.io/sns-projects/`
   - Redirect URL for GitHub Pages: `https://abzops.github.io/sns-projects/*`
4. Copy Project URL and anon public key into `.env`.
5. Restart Vite after editing `.env`.

## Database Setup

Create an ignored admin-only file named `.env.admin`:

```env
SUPABASE_DB_PASSWORD=your-database-password
SUPABASE_SEED_EMAIL=your-login-email@example.com
```

If your network supports IPv6, the script defaults to this Supabase database:

```text
host: db.gqerfixdmgbqahgslzsq.supabase.co
port: 5432
database: postgres
user: postgres
```

If the direct DB host times out, use Supabase's IPv4-compatible Session Pooler instead:

```env
SUPABASE_DB_URL=postgresql://postgres.gqerfixdmgbqahgslzsq:your-database-password@your-session-pooler-host:5432/postgres
SUPABASE_SEED_EMAIL=your-login-email@example.com
```

Find it in Supabase Dashboard → Connect → Connection pooling → Session pooler.

Then apply the database:

```powershell
npm run db:setup
```

This runs `supabase/schema.sql`, then imports `supabase/seed_sns_projects_dataset.sql` if `SUPABASE_SEED_EMAIL` is set.

## Import SNS Project Dataset

The Excel project list from `data.zip` has been converted into:

```text
supabase/seed_sns_projects_dataset.sql
```

To load it:

1. Sign up in the app with your real email.
2. Add that email as `SUPABASE_SEED_EMAIL` in `.env.admin`.
3. Run `npm run db:setup`.
5. Refresh the app; you will see a workspace named `SNS Projects Dataset`.

This imports 6 projects and 26 tasks. Original assignee, Phase, task list, and subtask details are preserved inside each task description.

## Important

- The frontend uses only the public Supabase anon key.
- Never put the Supabase service role key in `.env` for this Vite app.
- All real security belongs in `supabase/schema.sql` RLS policies.
- Demo/local data has been removed; all auth and records now come from Supabase.

## Clear Old Browser State

If your browser still has old local/session data, open DevTools Console on `http://127.0.0.1:5173/` and run:

```js
localStorage.clear()
sessionStorage.clear()
location.reload()
```
