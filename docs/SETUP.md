# Setup

The frontend is static and hosted on GitHub Pages. All privileged work runs in Supabase:

- **Database and row-level security:** Supabase PostgreSQL
- **Sign-in:** Supabase Auth
- **Google Sheets access:** an Edge Function

The browser only ever receives the public Supabase URL and anon key.

## 1. Supabase project

1. Create a project at https://supabase.com.
2. Apply the schema. Either way works:
   - With the CLI: `supabase link --project-ref <ref>`, then `supabase db push`.
   - In the dashboard: open the SQL editor and run `supabase/migrations/20261109000000_init.sql`.

   The schema creates:
   - all tables
   - row-level security policies, driven by the same role → permission matrix the app edits in Settings
   - a database trigger that enforces the review workflow (submit → approve → publish) and makes published services read-only
   - default roles, permissions, the worship ministry and a template
3. Configure Authentication:
   - Turn **off** public sign-ups (Authentication → Providers → Email → "Allow new users to sign up").
   - Invite users from the dashboard instead.
   - The **first user created becomes admin**. Everyone after starts as *viewer* until an admin assigns a role in Settings → Users.
   - Under URL configuration, set the site URL and add a redirect URL: `https://jervilangelo.github.io/scheduling-liturgy-system/`. Emailed sign-in links need this.
4. Copy **Project URL** and the **anon public key** (Project Settings → API).
   - **Never** use the `service_role` key in the frontend.

## 2. Google Sheets `SongList` sync

The `songlist-sync` Edge Function reads the existing sheet and writes only the `Last Sung` cell of existing rows. It never adds or removes rows, columns or tabs, and never changes formatting. Before writing, it checks that each row still holds the same song title.

1. In Google Cloud, create a service account and enable the **Google Sheets API**.
2. Create a JSON key for the service account.
3. Share the SongList spreadsheet with the service account's email as **Editor**.
4. Store the key as a function secret and deploy the function:

   ```bash
   supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"
   supabase functions deploy songlist-sync
   ```

5. In the app, open Settings → Google Sheets SongList and fill in:
   - the spreadsheet ID (the full sheet link also works)
   - the tab name (`SongList`)
   - the header names of the Title, Last Sung, Theme and Artist columns

   Columns are matched by header name, so their order doesn't matter.

Without Supabase (demo mode), the Songs page offers two manual alternatives:

- **Import:** paste the sheet into the app.
- **Export:** download the Last Sung dates as CSV to paste back.

## 3. Local development against Supabase

```bash
cp .env.example .env.local
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

## 4. GitHub Pages

1. In the repository, open **Settings → Pages → Build and deployment** and set **Source: GitHub Actions**.
2. Optional: under **Settings → Secrets and variables → Actions → Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Without them the site deploys in demo mode.
3. Push to `main`. `.github/workflows/deploy.yml` then runs these steps in order:
   1. type-check
   2. unit tests
   3. Playwright end-to-end tests
   4. build all ten HTML pages
   5. check that every page exists
   6. scan the bundle for privileged secrets
   7. deploy

The Vite base path is `/scheduling-liturgy-system/`. Every page works by direct URL and on refresh, because each one is a real file.
