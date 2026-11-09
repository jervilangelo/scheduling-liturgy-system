# ECCM Liturgy & Ministry Planning & Scheduling

A multi-page web application for planning Sunday liturgies and scheduling ministry volunteers.

Built with Vite, TypeScript and Tailwind CSS. Data lives in Supabase (PostgreSQL, Auth and Edge Functions), the song library syncs with the Google Sheets `SongList`, and the frontend is hosted on GitHub Pages.

**Live site (after the Pages workflow has run):** https://jervilangelo.github.io/scheduling-liturgy-system/

## Pages

Every module is its own physical HTML file with its own URL. Pages are linked with ordinary links, with no client-side router.

| URL | Module |
| --- | --- |
| `index.html` | Dashboard: upcoming Sundays, statuses, missing assignments, warnings, team cover matrix |
| `calendar.html` | Month and week Sunday calendar with special-Sunday and status indicators |
| `liturgy.html` | Liturgy builder: reorderable elements, songs, Scripture, sermon, templates, versions, review |
| `scheduling.html` | Role assignments, rotation suggestions, availability, conflict detection, overrides |
| `volunteers.html` | Volunteer directory: roles, ministries, availability, assignment history |
| `songs.html` | Song library: search by title or theme, usage history, `Last Sung` sync with SongList |
| `history.html` | Past schedules, liturgy revisions and the audit log |
| `published.html` | Read-only approved and published schedules: copy as text, print/PDF, Excel |
| `settings.html` | Settings, special-Sunday rules, ministries, roles, templates, Sheets, users, permissions, backups |
| `login.html` | Sign in |

## Special Sunday rules

- **First Sunday:** Communion
- **Second Sunday:** CPP
- **Last Sunday:** Creed, alternating monthly between the Nicene and Apostles' Creeds

The creed rotation is anchored to a configurable month, set in Settings.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173/scheduling-liturgy-system/
```

Without Supabase settings the app runs in **demo mode**:

- Sample data is stored in the browser.
- Demo accounts (admin, approver, planner, viewer) need no password.

To connect a real backend, see [docs/SETUP.md](docs/SETUP.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Type-check, then build every HTML entry into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Unit tests (Vitest): Sunday rules, conflicts, rotation, workflow, song sync, exports |
| `npm run test:e2e` | Playwright tests against the production build (desktop and phone) |
| `npm run check:secrets` | Fail if privileged keys appear in `dist/` |

## Documentation

- [docs/SETUP.md](docs/SETUP.md): Supabase, Google Sheets, GitHub Pages configuration
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): structure, data model, how to add future ministry pages, assumptions
