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
2. Open Supabase SQL Editor.
3. Run `supabase/schema.sql`.
4. In Supabase Auth, enable the Email provider.
5. Add these Auth URLs:
   - Site URL: `http://127.0.0.1:5173`
   - Redirect URL: `http://127.0.0.1:5173/*`
6. Copy Project URL and anon public key into `.env`.
7. Restart Vite after editing `.env`.

## Import SNS Project Dataset

The Excel project list from `data.zip` has been converted into:

```text
supabase/seed_sns_projects_dataset.sql
```

To load it:

1. Sign up in the app with your real email.
2. Open `supabase/seed_sns_projects_dataset.sql`.
3. Replace `CHANGE_ME_TO_YOUR_LOGIN_EMAIL` with that email.
4. Run the SQL in Supabase SQL Editor.
5. Refresh the app; you will see a workspace named `SNS Projects Dataset`.

This imports 6 projects and 26 tasks. Original assignee, phase/milestone, task list, and subtask details are preserved inside each task description.

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
