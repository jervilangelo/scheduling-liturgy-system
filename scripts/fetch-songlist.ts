// Refreshes the bundled SongList snapshot used by demo mode:
//   node scripts/fetch-songlist.ts [spreadsheetId]
// Reads the public SongList (read-only) with the same parser the app uses.
import { writeFileSync } from 'node:fs';
import { parseSongListXlsx, songListExportUrl } from '../src/modules/song-library/sheet-xlsx.ts';

const id = process.argv[2] ?? '1_ksiD3P4ClBijGepPI7jqtGwxqKtt9oARny3V_VZlqM';
const res = await fetch(songListExportUrl(id));
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const songs = parseSongListXlsx(new Uint8Array(await res.arrayBuffer()), {
  table: 'SongList', title: 'TITLE OF SONGS', lastSung: 'Last Sung', theme: 'THEME', artist: 'WORDS AND MUSIC BY', lyrics: 'Lyrics Link', chords: 'Chords Link',
}, today);
writeFileSync('src/services/songlist-snapshot.json', JSON.stringify({ fetchedAt: new Date().toISOString(), spreadsheetId: id, songs }, null, 1) + '\n');
console.log(`${songs.length} songs, ${songs.filter((s) => s.lyricsLink).length} with lyrics links, ${songs.filter((s) => s.lastSung).length} with Last Sung; rows ${songs[0]?.sheetRow}–${songs.at(-1)?.sheetRow}`);
