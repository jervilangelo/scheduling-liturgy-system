/**
 * Domain model for ECCM liturgy planning. One plan per Sunday, written in the
 * church's own text format ("Label: detail" lines, dash lines for songs).
 */

export type ISODate = string; // YYYY-MM-DD (Philippine calendar date)
export type ISODateTime = string; // full ISO timestamp

export type CreedKind = 'nicene' | 'apostles';

/** 1st Sunday: communion · 2nd Sunday: two added songs · last Sunday: creed. */
export type SpecialKind = 'communion' | 'cpp' | 'creed';

export type LiturgyItemKind =
  | 'call_to_worship'
  | 'singing'
  | 'song'
  | 'scripture'
  | 'prayer'
  | 'confession'
  | 'creed'
  | 'cpp'
  | 'communion'
  | 'offering'
  | 'announcements'
  | 'sermon'
  | 'benediction'
  | 'reflection'
  | 'custom';

/** Special places a line can hold, so the Sunday rules find them again without duplicating. */
export type LiturgySlot = 'congregational_reading' | 'communion_song' | 'cpp_song' | 'response_song';

/**
 * One line of the order of worship, written as "Label: detail"
 * (e.g. "Call to Worship: Psalm 89:5"). A song with no label is a dash line
 * ("- Here Is Love") and belongs to the singing section above it.
 */
export interface LiturgyItem {
  id: string;
  kind: LiturgyItemKind;
  /** The label, e.g. "Call to Worship". Empty for a song inside a singing section. */
  title: string;
  /** Text after the colon: a song title, Scripture passage or other detail. */
  detail?: string;
  /** SongList song this line refers to (songs only). */
  songId?: string | null;
  slot?: LiturgySlot;
  /** Section headers such as "Congregational Singing" are not printed in the shared text. */
  hideInText?: boolean;
  /** Legacy field (older saved plans). */
  scripture?: string;
}

export interface Sermon {
  title: string;
  preacher: string;
}

/** A team line at the foot of the plan, e.g. "Service Leader: Angelo". */
export interface TeamLine {
  role: string;
  names: string;
}

/** The plan for one Sunday. */
export interface Plan {
  id: string;
  date: ISODate;
  theme: string;
  sermon: Sermon;
  liturgy: LiturgyItem[];
  team: TeamLine[];
  /** Manual override of the computed creed (null = follow the monthly rotation). */
  creedOverride: CreedKind | null;
  version: number;
  updatedAt: ISODateTime;
}

export interface PlanVersion {
  id: string;
  planId: string;
  version: number;
  items: LiturgyItem[];
  note: string;
  savedAt: ISODateTime;
}

/** A row of the church's SongList spreadsheet. */
export interface Song {
  id: string;
  title: string;
  /** "WORDS AND MUSIC BY" */
  artist: string;
  themes: string[];
  lastSung: ISODate | null;
  lyricsLink: string;
  chordsLink: string;
  sheetRow: number | null;
}

export interface CreedSettings {
  /** Anchor month: in this year/month the creed is `creedAnchorKind`; it alternates monthly from there. */
  creedAnchorYear: number;
  creedAnchorMonth: number;
  creedAnchorKind: CreedKind;
}
