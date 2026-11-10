# Architecture

One static page (`index.html` → `src/pages/liturgy.ts`). There is no server and no sign-in.

| Path | Role |
| --- | --- |
| `src/pages/liturgy.ts` | The planner: the order-of-worship document, the Text view, the Songs, Sermon and Versions panels |
| `src/modules/liturgy` | The church's text format (`parseLiturgyText` / `liturgyToText`), the default ECCM order, song warnings and diffs |
| `src/modules/sunday-rules` | The 1st/2nd/last-Sunday rules (`sundayInfo`, `checkLiturgy`, `applySundayRules`); idempotent |
| `src/modules/song-library` | Reads the SongList `.xlsx` (`sheet-xlsx.ts`), title-based song ids and search |
| `src/services/songlist.ts` | Fetches the spreadsheet's public `.xlsx` export (Google sends CORS headers), caches it in localStorage, falls back to the bundled snapshot |
| `src/services/plans.ts` | Plans and versions in localStorage; imports liturgies saved by older builds (`eccm:v2:services`) once |

## Assumptions

- The SongList stays shared as "Anyone with the link can view". Its songs are in the table `SongList`, with the headers `TITLE OF SONGS`, `Last Sung`, `THEME`, `WORDS AND MUSIC BY`, `Lyrics Link` and `Chords Link`.
- The creed anchor is January 2026 = Nicene (`CREED_ANCHOR`).
- Song ids come from the normalised title, so a saved plan still matches its song if spreadsheet rows move.

## Removed for now

Ministry scheduling, volunteers, the calendar, the review and publish workflow, sign-in and roles, and the Supabase backend were removed so the work can focus on liturgy planning. They remain in git history (commit `e6f101f` and earlier) and can be brought back.
