import { describe, expect, it } from 'vitest';
import { applySundayRules, checkLiturgy, CPP_TITLE, CREED_ANCHOR as S, creedForMonth, describeSunday, sundayInfo } from '../../src/modules/sunday-rules';
import { defaultTemplateItems, liturgyToText } from '../../src/modules/liturgy';
import { songsFromSheet } from '../../src/modules/song-library';
import { sundaysOfMonth } from '../../src/utils/dates';

let n = 0;
const id = () => `i${++n}`;

describe('sundays', () => {
  it('lists the Sundays of a month', () => {
    expect(sundaysOfMonth(2026, 11)).toEqual(['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']);
    expect(sundaysOfMonth(2026, 2)).toEqual(['2026-02-01', '2026-02-08', '2026-02-15', '2026-02-22']);
  });
});

describe('special Sunday rules', () => {
  it('1st Sunday is Communion, 2nd adds two songs, last is the creed', () => {
    expect(sundayInfo('2026-11-01', S).specials).toEqual(['communion']);
    expect(sundayInfo('2026-11-08', S).specials).toEqual(['cpp']);
    expect(sundayInfo('2026-11-15', S).specials).toEqual([]);
    expect(sundayInfo('2026-11-22', S).specials).toEqual([]);
    expect(sundayInfo('2026-11-29', S).specials).toEqual(['creed']);
    expect(describeSunday(sundayInfo('2026-11-01', S))).toEqual(['Communion Sunday']);
    expect(describeSunday(sundayInfo('2026-11-08', S))).toEqual(['Two added songs']);
    expect(describeSunday(sundayInfo('2026-11-29', S))).toEqual(['Nicene Creed']);
  });

  it('four-Sunday months: the fourth is the last', () => {
    const info = sundayInfo('2026-02-22', S);
    expect(info.ordinal).toBe(4);
    expect(info.specials).toEqual(['creed']);
  });

  it('alternates Nicene and Apostles monthly from January 2026 = Nicene', () => {
    expect(creedForMonth('2026-01-25', S)).toBe('nicene');
    expect(creedForMonth('2026-02-22', S)).toBe('apostles');
    expect(creedForMonth('2026-11-29', S)).toBe('nicene');
    expect(creedForMonth('2026-12-27', S)).toBe('apostles');
    expect(creedForMonth('2025-12-28', S)).toBe('apostles');
    expect(sundayInfo('2026-11-29', S, 'apostles').creed).toBe('apostles');
  });

  it('communion: Communion Proper and Communion Song after the Response Song', () => {
    const info = sundayInfo('2026-11-01', S);
    const base = defaultTemplateItems(id);
    expect(checkLiturgy(base, info)).toHaveLength(1);
    const out = applySundayRules(base, info, id);
    const r = out.findIndex((i) => i.slot === 'response_song');
    expect(out[r + 1].title).toBe('Communion Proper');
    expect(out[r + 2]).toMatchObject({ title: 'Communion Song', slot: 'communion_song' });
    expect(checkLiturgy(out, info)).toHaveLength(0);
    expect(applySundayRules(out, info, id)).toHaveLength(out.length); // idempotent
  });

  it('second Sunday: two songs added after the team lines', () => {
    const info = sundayInfo('2026-11-08', S);
    const out = applySundayRules(defaultTemplateItems(id), info, id);
    expect(out.filter((i) => i.slot === 'cpp_song')).toHaveLength(2);
    expect(checkLiturgy(out, info)).toHaveLength(0);
    out.filter((i) => i.slot === 'cpp_song').forEach((s, k) => { s.detail = k ? 'Song B' : 'Song A'; });
    const text = liturgyToText('2026-11-08', out, new Map(), [{ role: 'Service Leader', names: 'Angelo' }]);
    expect(text.endsWith(`Service Leader: Angelo\n\n${CPP_TITLE}:\n1. Song A\n2. Song B`)).toBe(true);
  });

  it('last Sunday: the creed replaces the Congregational Reading', () => {
    const info = sundayInfo('2026-11-29', S);
    const out = applySundayRules(defaultTemplateItems(id), info, id);
    const reading = out.find((i) => i.slot === 'congregational_reading')!;
    expect(reading).toMatchObject({ kind: 'creed', detail: 'Nicene Creed' });
    expect(checkLiturgy(out, info)).toHaveLength(0);
    // Switching the creed rewrites the same line
    const apostles = applySundayRules(out, sundayInfo('2026-11-29', S, 'apostles'), id);
    expect(apostles.filter((i) => i.slot === 'congregational_reading')).toHaveLength(1);
    expect(apostles.find((i) => i.slot === 'congregational_reading')!.detail).toBe("Apostles' Creed");
  });
});

describe('SongList', () => {
  it('gives songs a title-based id and drops duplicate titles', () => {
    const row = (sheetRow: number, title: string) => ({ sheetRow, title, artist: '', themes: [], lastSung: null, lyricsLink: '', chordsLink: '' });
    const songs = songsFromSheet([row(5, 'Here Is Love'), row(6, 'HERE IS LOVE'), row(7, 'Come Thou Fount')]);
    expect(songs.map((s) => s.id)).toEqual(['song:here is love', 'song:come thou fount']);
  });
});
