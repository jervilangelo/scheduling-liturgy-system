# ECCM Liturgy Planning

Plan the ECCM Sunday order of worship in the church's own written format, with songs from the church's SongList spreadsheet.

Built with Vite, TypeScript and Tailwind CSS, and hosted on GitHub Pages: https://jervilangelo.github.io/scheduling-liturgy-system/

## What it does

- **Order of worship.** Edit the plan as a document: "Label: detail" lines, dash lines for songs, and team lines at the end. The **Text** view reads and writes that exact text, so you can paste a plan in, and **Copy** puts it on the clipboard for Messenger.
- **Songs from the SongList.** Songs are read live from the [SongList spreadsheet](https://docs.google.com/spreadsheets/d/1_ksiD3P4ClBijGepPI7jqtGwxqKtt9oARny3V_VZlqM/edit). The page only reads the sheet; it never writes to it. Search by title, writer or theme. Each song line shows when it was last sung and warns if it was sung or planned within four weeks.
- **Special Sundays.** These are applied automatically:
  - **1st Sunday: Communion Sunday.** "Communion Proper" and "Communion Song" come after the Response Song.
  - **2nd Sunday: two added songs.** "Congregational Prayer and Praise" with two songs is added after the team lines.
  - **Last Sunday: creed.** The Congregational Reading of Scripture becomes the Nicene or Apostles' Creed. They alternate monthly (January 2026 is Nicene), and each Sunday can switch the creed by hand.
- **Versions.** Every save keeps a version that you can compare or restore.

Plans are saved in the browser you use, so they are not shared between devices. To share a plan, copy its text.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173/scheduling-liturgy-system/
npm test             # unit tests
npm run test:e2e     # browser tests against the production build
npm run build
```

`node scripts/fetch-songlist.ts` refreshes the bundled SongList copy (`src/services/songlist-snapshot.json`). The page uses that copy until the first live read succeeds, or when the spreadsheet can't be reached.

Pushing to `main` runs the tests and deploys to GitHub Pages. In the repository settings, set Pages to use "GitHub Actions" as the source.
