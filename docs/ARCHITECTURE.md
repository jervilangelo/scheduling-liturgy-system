# Architecture

## Multi-page application

Each module is a physical HTML file in the project root, with a matching entry module in `src/pages/<name>.ts`.

`vite.config.ts` builds **every** root `*.html` file automatically, so adding a page needs no build configuration.

Each page:

1. calls `bootPage()` (`src/components/shared/boot.ts`) to check the session, redirect to `login.html?next=…` when signed out, check permissions, and load settings;
2. mounts the shared shell (`src/components/navigation/shell.ts`): sidebar on desktop, top bar and menu sheet on phones;
3. renders its content from shared components (`src/components/shared/ui.ts`).

Navigation between pages uses plain links. Sessions persist in `localStorage` on this origin, so a sign-in on one page applies to all of them.

```text
index.html … login.html     Ten physical pages (thin documents)
src/pages/                  One entry module per page
src/components/             Shell and nav registry, shared UI, workflow bar, song picker
src/modules/                Framework-free domain logic (unit-tested)
  sunday-rules/             Communion / CPP / creed rotation
  conflict-detection/       Shared conflict engine (all ministries)
  rotations/                Fair-rotation suggestions and auto-fill
  volunteer-scheduling/     Ministry-specific rule registry
  publishing/               Review → approve → publish state machine
  song-library/             Search, usage, Last Sung, SongList parsing and merging
  liturgy/                  Element types, reordering, diff, Scripture checks
  permissions/              Role → permission matrix
  exports/                  .xlsx writer, text and workbook formatting
src/services/
  api/                      Data backend (Supabase or local demo), store with audit, workflow, Sheets client
  authentication/           Supabase Auth or demo accounts
  supabase/                 Lazy client (public URL and anon key only)
src/styles/app.css          Shared design system (Tailwind v4 and tokens) with print styles
supabase/migrations/        Schema, RLS, workflow trigger, defaults
supabase/functions/         songlist-sync Edge Function
tests/unit, tests/e2e       Vitest and Playwright
```

## Data backends

`src/services/api/backend.ts` exposes the same `list` / `upsert` / `remove` interface over two backends:

- **Supabase**, when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set. Tables are named after the collections, and columns are snake_case versions of the TypeScript fields.
- **Local demo** otherwise. Data lives in browser storage, seeded with sample data dated relative to today.

Every change made through `store.save` and `store.remove` can write an audit entry.

## One volunteer database for every ministry

Ministries (`ministries`) own their role definitions. `volunteers`, `availability`, `services` and `assignments` are shared.

The conflict engine checks a volunteer across **all** ministries' services. A kids teacher booked 09:30–10:30 is flagged against a 09:00–11:00 worship slot.

Ministry-specific behaviour lives in `src/modules/volunteer-scheduling/ministry-rules.ts`: overlap policy, special Sundays, and whether the ministry plans a liturgy.

### Adding a future ministry page (for example `kids-ministry.html`)

1. In Settings → Ministries, add the ministry (slug `kids`) and its roles. Volunteers then tick their eligibility in the directory.
2. Optionally register rules for the slug in `ministry-rules.ts`.
3. Create `kids-ministry.html` (copy any page's head) pointing at `src/pages/kids-ministry.ts`.
4. Add one entry to `src/components/navigation/nav-config.ts`.

The new page can reuse the scheduling roster, conflict detection, availability, permissions and exports.

The scheduling page already includes a ministry selector whenever more than one ministry is active. So a new ministry can also be scheduled there before it has its own page.

## Permissions

There are four roles: admin, approver (pastor), planner and viewer.

Ten permissions are configurable in Settings → Permissions. The same matrix is enforced:

- **in the app:** controls are hidden or disabled;
- **in the database:** RLS policies call `has_permission()`, and a trigger guards every workflow transition and the published lock.

Admins can never lose user and settings management.

## Assumptions (to confirm)

The comprehensive ECCM master prompt referred to in the instructions was not available, so these choices were made from the summary requirements:

- **CPP** is shown as a configurable label; the abbreviation is not expanded anywhere.
- **Creed rotation anchor:** January 2026 uses the Nicene Creed, changeable in Settings.
- **Default team roles** follow the foot of the church's plan: Service Leader, Scripture Reader and Music, one person each. Add more roles, or change the counts, in Settings.
- **Order of worship format:** every line is "Label: detail", and songs without a label are dash lines. This matches the church's weekly plan, which the Text view on the Liturgy page reads and writes. The element type is inferred from the label (for example "Response Song" is a song and "Nicene Creed" is the creed), so the special-Sunday rules still apply.
- **Service time** is 09:00–11:00.
- **SongList headers** are assumed to be `Title`, `Last Sung`, `Theme` and `Artist`. All are configurable.
- **Last Sung** moves forward only when a service is **published** and its date has passed, and is never moved backwards.
- **Demo data** (people, songs, sermons) is sample data in `src/services/api/seed.ts` and must be replaced with real records.
