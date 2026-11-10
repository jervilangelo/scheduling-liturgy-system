import { describe, expect, it } from 'vitest';
import { formatLine, inferKind, isBullet, liturgyToText, normalizeItems, parseLiturgyText } from '../../src/modules/liturgy';
import type { LiturgyItem, Song } from '../../src/types/domain';

// The church's own weekly plan, exactly as written (including the tab after the dash).
const SAMPLE = `November 8
Preparatory: God Rest Ye Merry Gentlemen
Call to Worship: Psalm 89:5
-\tMagnificent, Marvelous, Matchless Love
-\tHere Is Love
Scripture Reading: Romans 5
Prayer of Confession
-\tWhen I Survey The Wondrous Cross
Congregational Reading of Scripture: Matthew 5:38-47
Prayer of Thanksgiving
-\tBeautiful Savior
Pastoral Prayer
-\tCome Thou Fount
Sermon: Nehemiah 9
Response Song: The Lord is my Salvation

Service Leader: Angelo
Scripture Reader:
Music:`;

const song = (id: string, title: string): Song => ({ id, title, artist: '', themes: [], lastSung: null, lyricsLink: '', chordsLink: '', sheetRow: null });
const library = [song('s1', 'Here Is Love'), song('s2', 'Come Thou Fount'), song('s3', 'The Lord is my Salvation')];
let n = 0;
const id = () => `i${++n}`;

describe('church text format', () => {
  const { items: all, skipped } = parseLiturgyText(SAMPLE, library, ['Service Leader', 'Scripture Reader', 'Music'], id);
  // Dash lines are grouped under hidden "Congregational Singing" headers that are not printed.
  const items = all.filter((i) => !i.hideInText);

  it('reads every element, skipping the date and team lines', () => {
    expect(items).toHaveLength(14);
    expect(all.filter((i) => i.kind === 'singing')).toHaveLength(4);
    expect(skipped).toEqual(['Service Leader: Angelo', 'Scripture Reader:', 'Music:']);
  });

  it('keeps colons inside Scripture references', () => {
    expect(items[1]).toMatchObject({ title: 'Call to Worship', detail: 'Psalm 89:5', kind: 'call_to_worship' });
    expect(items[7]).toMatchObject({ title: 'Congregational Reading of Scripture', detail: 'Matthew 5:38-47', kind: 'scripture' });
  });

  it('treats dash lines as songs and matches them to the library, ignoring case', () => {
    expect(isBullet(items[3])).toBe(true);
    expect(items[3]).toMatchObject({ detail: 'Here Is Love', songId: 's1' });
    expect(items[2].songId).toBeNull(); // not in the library
    expect(items[13]).toMatchObject({ title: 'Response Song', kind: 'song', songId: 's3' });
  });

  it('infers element types from labels', () => {
    expect(items.map((i) => i.kind)).toEqual([
      'song', 'call_to_worship', 'song', 'song', 'scripture', 'confession', 'song', 'scripture', 'prayer', 'song', 'prayer', 'song', 'sermon', 'song',
    ]);
    expect(inferKind('Nicene Creed', false)).toBe('creed');
    expect(inferKind("Lord's Supper", false)).toBe('communion');
    expect(inferKind('CPP', false)).toBe('cpp');
  });

  it('writes the same text back out', () => {
    const songs = new Map(library.map((s) => [s.id, s]));
    const text = liturgyToText('2026-11-08', all, songs, [
      { role: 'Service Leader', names: 'Angelo' }, { role: 'Scripture Reader', names: '' }, { role: 'Music', names: '' },
    ]);
    expect(text).toBe(SAMPLE.replace(/-\t/g, '- ').replace('Scripture Reader: ', 'Scripture Reader:'));
  });

  it('upgrades older saved items to label and detail', () => {
    const songs = new Map(library.map((s) => [s.id, s]));
    const old: LiturgyItem[] = [
      { id: 'a', kind: 'song', title: 'Here Is Love', songId: 's1' },
      { id: 'b', kind: 'scripture', title: 'Scripture reading', scripture: 'John 1' },
    ];
    expect(normalizeItems(old, songs).map((i) => formatLine(i, songs))).toEqual(['- Here Is Love', 'Scripture reading: John 1']);
  });
});
