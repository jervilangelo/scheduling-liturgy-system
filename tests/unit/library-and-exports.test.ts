import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { computeLastSungUpdates, mapSheetRows, mergeSheetSongs, parseDelimited, searchSongs } from '../../src/modules/song-library';
import { availableActions, canTransition, nextStatus } from '../../src/modules/publishing';
import { buildXlsx } from '../../src/modules/exports/xlsx';
import { serviceAsText, scheduleWorkbook } from '../../src/modules/exports/schedule';
import { diffLines, isPlausibleScripture, moveItem } from '../../src/modules/liturgy';
import { permissionsFor, defaultRolePermissions } from '../../src/modules/permissions';
import { buildSeed, DEFAULT_SETTINGS } from '../../src/services/api/seed';
import { parseLooseDate } from '../../src/utils/dates';
import { safeNext } from '../../src/utils/redirect';
import type { Permission, Service, Song } from '../../src/types/domain';

const song = (id: string, title: string, themes: string[] = [], lastSung: string | null = null, sheetRow: number | null = null): Song => ({ id, title, artist: '', themes, songKey: '', lastSung, sheetRow, notes: '' });

describe('song library', () => {
  const songs = [song('1', 'Amazing Grace', ['Grace']), song('2', 'Holy, Holy, Holy', ['Holiness']), song('3', 'Grace Alone', ['Grace'])];
  it('searches title and theme, ignoring punctuation and case', () => {
    expect(searchSongs(songs, 'holy holy').map((s) => s.id)).toEqual(['2']);
    expect(searchSongs(songs, 'grace').map((s) => s.id)).toEqual(['1', '3']);
    expect(searchSongs(songs, '', 'Holiness').map((s) => s.id)).toEqual(['2']);
  });
  it('moves Last Sung forward only from published services on or before the date', () => {
    const svc = (date: string, status: Service['status'], ids: string[]) => ({ date, status, id: date, liturgy: ids.map((x) => ({ id: x + date, kind: 'song' as const, title: '', songId: x })) }) as unknown as Service;
    const lib = [song('a', 'A', [], '2026-11-01'), song('b', 'B', [], '2026-12-01'), song('c', 'C')];
    const up = computeLastSungUpdates(lib, [svc('2026-11-08', 'published', ['a', 'b', 'c']), svc('2026-11-15', 'draft', ['c']), svc('2026-11-22', 'published', ['c'])], '2026-11-15');
    expect(up.map((u) => [u.song.id, u.lastSung])).toEqual([['a', '2026-11-08'], ['c', '2026-11-08']]);
  });
  it('parses pasted TSV/CSV with quotes', () => {
    expect(parseDelimited('Title,Last Sung\r\n"Holy, Holy",3/1/2026\n"Say ""Yes""",\n')).toEqual([['Title', 'Last Sung'], ['Holy, Holy', '3/1/2026'], ['Say "Yes"', '']]);
    expect(parseDelimited('Title\tTheme\nA\tx, y')).toEqual([['Title', 'Theme'], ['A', 'x, y']]);
  });
  it('maps SongList columns by header name regardless of order, keeping sheet row numbers', () => {
    const grid = [['Theme', 'Last Sung', 'Title'], ['Grace', '3/1/2026', 'Amazing Grace'], ['', '', ''], ['Praise', '', 'Doxology']];
    const rows = mapSheetRows(grid, { title: 'Title', lastSung: 'Last Sung', theme: 'Theme', artist: 'Artist' }, parseLooseDate);
    expect(rows).toEqual([
      { sheetRow: 2, title: 'Amazing Grace', artist: '', themes: ['Grace'], lastSung: '2026-03-01' },
      { sheetRow: 4, title: 'Doxology', artist: '', themes: ['Praise'], lastSung: null },
    ]);
    expect(() => mapSheetRows([['Name']], { title: 'Title', lastSung: 'Last Sung', theme: '', artist: '' }, parseLooseDate)).toThrow(/Title/);
  });
  it('merges sheet rows by row then title without losing a later Last Sung', () => {
    const existing = [song('1', 'Amazing Grace', [], '2026-05-01')];
    const r = mergeSheetSongs(existing, [{ sheetRow: 2, title: 'amazing grace', artist: '', themes: [], lastSung: '2026-03-01' }, { sheetRow: 3, title: 'New', artist: '', themes: [], lastSung: null }], () => 'new');
    expect(r.added).toBe(1);
    expect(r.updated).toBe(1);
    expect(r.upserts[0].lastSung).toBe('2026-05-01');
    expect(r.upserts[0].sheetRow).toBe(2);
  });
});

describe('publishing workflow', () => {
  const all = (_: Permission) => true;
  const planner = (p: Permission) => ['submit_review', 'edit_liturgy'].includes(p);
  it('follows draft → review → approved → published', () => {
    expect(nextStatus('draft', 'submit')).toBe('in_review');
    expect(nextStatus('in_review', 'approve')).toBe('approved');
    expect(nextStatus('approved', 'publish')).toBe('published');
    expect(nextStatus('published', 'unpublish')).toBe('draft');
    expect(() => nextStatus('draft', 'publish')).toThrow();
  });
  it('limits actions by permission', () => {
    expect(availableActions('draft', planner)).toEqual(['submit']);
    expect(availableActions('in_review', planner)).toEqual([]);
    expect(availableActions('in_review', all).sort()).toEqual(['approve', 'return']);
    expect(canTransition('approved', 'publish', planner)).toBe(false);
  });
});

describe('permissions', () => {
  it('admins always keep user management even if the matrix is emptied', () => {
    expect(permissionsFor('admin', []).has('manage_users')).toBe(true);
    const viewer = permissionsFor('viewer', defaultRolePermissions());
    expect([...viewer]).toEqual(['view']);
  });
});

describe('liturgy helpers', () => {
  it('reorders and diffs', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
    expect(diffLines(['a', 'b', 'c'], ['a', 'c', 'd'])).toEqual([
      { type: 'same', text: 'a' }, { type: 'removed', text: 'b' }, { type: 'same', text: 'c' }, { type: 'added', text: 'd' },
    ]);
  });
  it('accepts common Scripture references', () => {
    for (const r of ['John 3:16', 'Psalm 23', '1 Cor 13:4-7', 'Romans 8:28; Psalm 46:1-3', 'Song of Songs 2:1', 'John 1:1-2:5']) expect(isPlausibleScripture(r)).toBe(true);
    for (const r of ['hello', '3:16', 'John :']) expect(isPlausibleScripture(r)).toBe(false);
  });
});

describe('exports', () => {
  const seed = buildSeed('2026-11-09');
  const data = { services: seed.services, assignments: seed.assignments, roles: seed.role_definitions, volunteers: seed.volunteers, songs: seed.songs, settings: DEFAULT_SETTINGS };
  it('produces a valid xlsx package with escaped strings', () => {
    const bytes = buildXlsx([{ name: 'A/B?', rows: [['Name', 'n'], ['<Tom & "Jo">', 3]] }]);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('&lt;Tom &amp; &quot;Jo&quot;&gt;');
    expect(sheet).toContain('<v>3</v>');
    expect(strFromU8(files['xl/workbook.xml'])).toContain('name="A B"');
  });
  it('formats a service as text with specials, order and team', () => {
    const first = seed.services.find((s) => s.date === '2026-11-01')!;
    const txt = serviceAsText(data, first);
    expect(txt).toContain('Special: Holy Communion');
    expect(txt).toContain('Order of worship');
    expect(txt).toMatch(/Worship leader: \S+/);
  });
  it('builds a roster sheet plus one sheet per service', () => {
    const pub = seed.services.filter((s) => s.status === 'published');
    const wb = scheduleWorkbook(data, pub);
    expect(wb).toHaveLength(pub.length + 1);
    expect(wb[0].rows[0].length).toBe(pub.length + 1);
  });
});

describe('seed data', () => {
  it('is internally consistent: assignments reference real people, roles and services', () => {
    const s = buildSeed('2026-11-09');
    const vols = new Set(s.volunteers.map((v) => v.id));
    const roles = new Set(s.role_definitions.map((r) => r.id));
    const svcs = new Set(s.services.map((x) => x.id));
    expect(s.assignments.every((a) => vols.has(a.volunteerId) && roles.has(a.roleId) && svcs.has(a.serviceId))).toBe(true);
    expect(s.assignments.every((a) => s.volunteers.find((v) => v.id === a.volunteerId)!.roleIds.includes(a.roleId))).toBe(true);
  });
});

describe('login redirect', () => {
  it('only allows local page names', () => {
    expect(safeNext('liturgy.html?date=2026-11-15')).toBe('liturgy.html?date=2026-11-15');
    expect(safeNext('https://evil.example/x.html')).toBe('index.html');
    expect(safeNext('//evil.example')).toBe('index.html');
    expect(safeNext('login.html')).toBe('index.html');
    expect(safeNext(null)).toBe('index.html');
  });
});
