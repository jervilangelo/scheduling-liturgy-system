import type {
  AppSettings,
  Assignment,
  Availability,
  CollectionMap,
  LiturgyItem,
  LiturgyTemplate,
  LiturgyVersion,
  Ministry,
  Profile,
  RoleDefinition,
  Service,
  Song,
  Volunteer,
} from '../../types/domain';
import { defaultRolePermissions } from '../../modules/permissions';
import { applySundayRules, sundayInfo } from '../../modules/sunday-rules';
import { addDays, nextSunday, todayISO } from '../../utils/dates';
import { uid } from '../../utils/id';

/**
 * SAMPLE DATA for demo mode only. Names, songs and assignments are
 * illustrative and must be replaced with ECCM's real records (or come from
 * Supabase in production).
 */

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'global',
  churchName: 'ECCM',
  creedAnchorYear: 2026,
  creedAnchorMonth: 1,
  creedAnchorKind: 'nicene',
  communionLabel: 'Holy Communion',
  cppLabel: 'CPP',
  creedLabel: 'Creed',
  defaultTemplateId: 'tpl-standard',
  sheetSpreadsheetId: '',
  sheetName: 'SongList',
  sheetTitleHeader: 'Title',
  sheetLastSungHeader: 'Last Sung',
  sheetThemeHeader: 'Theme',
  sheetArtistHeader: 'Artist',
  consecutiveWeeksWarning: 3,
};

const WORSHIP = 'min-worship';

/** The team lines at the foot of the church's order of worship. */
const ROLE_DEFS: [string, string, number][] = [
  ['role-leader', 'Service Leader', 1],
  ['role-reader', 'Scripture Reader', 1],
  ['role-music', 'Music', 1],
];

const PEOPLE: [string, string[]][] = [
  ['Angelo Reyes', ['role-leader', 'role-music']],
  ['Maria Santos', ['role-leader', 'role-music']],
  ['Samuel Navarro', ['role-leader', 'role-reader']],
  ['Ana Fernandez', ['role-reader']],
  ['Grace Villanueva', ['role-reader', 'role-music']],
  ['Ruth Castillo', ['role-reader']],
  ['Lorna Ocampo', ['role-reader']],
  ['Isaac Manalo', ['role-reader']],
  ['Mark Dela Rosa', ['role-music']],
  ['Bea Mendoza', ['role-music']],
  ['Paolo Cruz', ['role-music']],
  ['Hannah Tan', ['role-music']],
];

const SONGS: [string, string, string[]][] = [
  ['Amazing Grace', 'John Newton', ['Grace', 'Salvation']],
  ['Holy, Holy, Holy', 'Reginald Heber', ['Holiness', 'Trinity']],
  ['Great Is Thy Faithfulness', 'Thomas Chisholm', ['Faithfulness']],
  ['It Is Well with My Soul', 'Horatio Spafford', ['Peace', 'Trust']],
  ['How Great Thou Art', 'Carl Boberg', ['Creation', 'Praise']],
  ['Be Thou My Vision', 'Traditional Irish', ['Devotion']],
  ['Come Thou Fount', 'Robert Robinson', ['Grace', 'Devotion']],
  ['When I Survey The Wondrous Cross', 'Isaac Watts', ['Cross', 'Communion']],
  ['Crown Him with Many Crowns', 'Matthew Bridges', ['Kingship', 'Praise']],
  ['A Mighty Fortress Is Our God', 'Martin Luther', ['Refuge', 'Trust']],
  ['Here Is Love', 'William Rees', ['Love', 'Cross']],
  ['Magnificent, Marvelous, Matchless Love', 'Haldor Lillenas', ['Love', 'Grace']],
  ['Beautiful Savior', 'Traditional', ['Praise']],
  ['The Lord is my Salvation', 'Keith & Kristyn Getty', ['Salvation']],
  ['Rock of Ages', 'Augustus Toplady', ['Salvation', 'Refuge']],
  ['Blessed Assurance', 'Fanny Crosby', ['Assurance']],
  ['And Can It Be', 'Charles Wesley', ['Grace', 'Salvation']],
  ['There Is a Fountain', 'William Cowper', ['Cross', 'Communion']],
  ['Jesus Paid It All', 'Elvina Hall', ['Cross', 'Grace']],
  ['God Rest Ye Merry Gentlemen', 'Traditional', ['Christmas']],
  ['O Come, All Ye Faithful', 'John Francis Wade', ['Christmas']],
  ['Joy to the World', 'Isaac Watts', ['Christmas', 'Joy']],
  ['Doxology', 'Thomas Ken', ['Praise', 'Benediction']],
];

/** The church's standard order of worship, as written in its weekly plan. */
function templateItems(): LiturgyItem[] {
  const line = (title: string, kind: LiturgyItem['kind']): LiturgyItem => ({ id: uid(), kind, title, detail: '' });
  const song = (): LiturgyItem => ({ id: uid(), kind: 'song', title: '', detail: '' });
  return [
    line('Preparatory', 'song'),
    line('Call to Worship', 'call_to_worship'),
    song(),
    song(),
    line('Scripture Reading', 'scripture'),
    line('Prayer of Confession', 'confession'),
    song(),
    line('Congregational Reading of Scripture', 'scripture'),
    line('Prayer of Thanksgiving', 'prayer'),
    song(),
    line('Pastoral Prayer', 'prayer'),
    song(),
    line('Sermon', 'sermon'),
    line('Response Song', 'song'),
  ];
}

/** Sample filled plans, one per seeded Sunday. */
const PLANS: { songs: string[]; call: string; reading: string; congregational: string; sermon: string; title: string; preacher: string }[] = [
  { songs: ['Crown Him with Many Crowns', 'Holy, Holy, Holy', 'Great Is Thy Faithfulness', 'Rock of Ages', 'Be Thou My Vision', 'How Great Thou Art', 'Blessed Assurance'], call: 'Psalm 95:1-7', reading: 'Genesis 16', congregational: 'Psalm 139:1-12', sermon: 'Genesis 16:7-14', title: 'The God who sees', preacher: 'Ptr. Daniel Reyes' },
  { songs: ['God Rest Ye Merry Gentlemen', 'Magnificent, Marvelous, Matchless Love', 'Here Is Love', 'When I Survey The Wondrous Cross', 'Beautiful Savior', 'Come Thou Fount', 'The Lord is my Salvation'], call: 'Psalm 89:5', reading: 'Romans 5', congregational: 'Matthew 5:38-47', sermon: 'Nehemiah 9', title: 'The God who keeps covenant', preacher: 'Ptr. Daniel Reyes' },
  { songs: ['A Mighty Fortress Is Our God', 'It Is Well with My Soul', 'Amazing Grace', 'Jesus Paid It All', 'And Can It Be', 'There Is a Fountain', 'Doxology'], call: 'Psalm 46:1-3', reading: 'Habakkuk 2', congregational: 'Hebrews 11:1-6', sermon: 'Habakkuk 2:1-4', title: 'Faith that waits', preacher: 'Ptr. Ruth Santiago' },
  { songs: ['Joy to the World', 'Holy, Holy, Holy', 'Here Is Love', 'Great Is Thy Faithfulness', 'Be Thou My Vision', 'Blessed Assurance', 'Crown Him with Many Crowns'], call: 'Psalm 118:19-24', reading: '1 Peter 2', congregational: 'Ephesians 2:19-22', sermon: '1 Peter 2:4-10', title: 'Living stones', preacher: 'Ptr. Daniel Reyes' },
  { songs: ['O Come, All Ye Faithful', 'Come Thou Fount', 'Magnificent, Marvelous, Matchless Love', 'Rock of Ages', 'Beautiful Savior', 'Amazing Grace', 'Joy to the World'], call: 'Isaiah 9:2', reading: 'John 1', congregational: 'Psalm 27:1-5', sermon: 'John 1:1-14', title: 'Light in the darkness', preacher: 'Ptr. Ruth Santiago' },
];

function fillPlan(items: LiturgyItem[], plan: (typeof PLANS)[number], songs: Song[]): LiturgyItem[] {
  let si = 0;
  const byTitle = new Map(songs.map((s) => [s.title, s]));
  return items.map((it) => {
    if (it.kind === 'song') {
      const title = plan.songs[si++ % plan.songs.length];
      return { ...it, detail: title, songId: byTitle.get(title)?.id ?? null };
    }
    if (it.kind === 'call_to_worship') return { ...it, detail: plan.call };
    if (it.title === 'Scripture Reading') return { ...it, detail: plan.reading };
    if (it.title === 'Congregational Reading of Scripture') return { ...it, detail: plan.congregational };
    if (it.kind === 'sermon') return { ...it, detail: plan.sermon };
    return it;
  });
}

export function buildSeed(today: string = todayISO()): { [K in keyof CollectionMap]: CollectionMap[K][] } {
  const now = new Date().toISOString();
  const ministries: Ministry[] = [
    { id: WORSHIP, slug: 'worship', name: 'Sunday worship', description: 'Main Sunday worship service', defaultStart: '09:00', defaultEnd: '11:00', usesSpecialSundays: true, active: true },
  ];
  const roles: RoleDefinition[] = ROLE_DEFS.map(([id, name, minCount], i) => ({
    id, ministryId: WORSHIP, name, minCount, sortOrder: i, compatibleRoleIds: [], active: true,
  }));
  // The service leader may also lead the music.
  roles.find((r) => r.id === 'role-leader')!.compatibleRoleIds = ['role-music'];

  const volunteers: Volunteer[] = PEOPLE.map(([name, roleIds], i) => ({
    id: `vol-${i + 1}`,
    name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.org`,
    phone: '',
    ministryIds: [WORSHIP],
    roleIds,
    maxPerMonth: 3,
    active: true,
    notes: '',
  }));

  const songs: Song[] = SONGS.map(([title, artist, themes], i) => ({
    id: `song-${i + 1}`, title, artist, themes, songKey: '', lastSung: null, sheetRow: i + 2, notes: '',
  }));

  const templates: LiturgyTemplate[] = [
    { id: 'tpl-standard', name: 'Standard Sunday', description: 'Regular order of worship', items: templateItems() },
    {
      id: 'tpl-short',
      name: 'Short service',
      description: 'For combined or outdoor services',
      items: [
        { id: uid(), kind: 'call_to_worship', title: 'Call to Worship', detail: '' },
        { id: uid(), kind: 'song', title: '', detail: '' },
        { id: uid(), kind: 'prayer', title: 'Opening Prayer', detail: '' },
        { id: uid(), kind: 'sermon', title: 'Sermon', detail: '' },
        { id: uid(), kind: 'song', title: 'Response Song', detail: '' },
      ],
    },
  ];

  // Past four Sundays published, this coming Sunday in review, the next one an empty draft.
  const first = nextSunday(today);
  const dates = [-28, -21, -14, -7, 0, 7].map((n) => addDays(first, n));
  const services: Service[] = [];
  const versions: LiturgyVersion[] = [];
  const assignments: Assignment[] = [];

  dates.forEach((date, i) => {
    const info = sundayInfo(date, DEFAULT_SETTINGS);
    const status: Service['status'] = i < 4 ? 'published' : i === 4 ? 'in_review' : 'draft';
    const plan = PLANS[i];
    const liturgy = plan ? applySundayRules(fillPlan(templateItems(), plan, songs), info, DEFAULT_SETTINGS, uid) : [];
    const svc: Service = {
      id: `svc-${date}`,
      ministryId: WORSHIP,
      date,
      startTime: '09:00',
      endTime: '11:00',
      status,
      theme: plan?.title ?? '',
      sermon: { title: plan?.title ?? '', scripture: plan?.sermon ?? '', preacher: plan?.preacher ?? '', series: '', notes: '' },
      liturgy,
      creedOverride: null,
      notes: '',
      liturgyVersion: liturgy.length ? 1 : 0,
      submittedBy: status !== 'draft' ? 'planner@example.org' : null,
      approvedBy: status === 'published' ? 'pastor@example.org' : null,
      publishedAt: status === 'published' ? now : null,
      updatedAt: now,
    };
    services.push(svc);
    if (liturgy.length) {
      versions.push({ id: uid(), serviceId: svc.id, version: 1, items: liturgy, sermon: svc.sermon, theme: svc.theme, note: 'Initial plan', savedBy: 'planner@example.org', savedAt: now });
    }
  });

  // Rotate volunteers through roles for the five planned Sundays.
  const counters = new Map<string, number>();
  services.slice(0, 5).forEach((svc, si) => {
    const used = new Set<string>();
    for (const r of roles) {
      // Leave the Scripture Reader open on the Sunday in review to show a gap.
      const need = si === 4 && r.id === 'role-reader' ? 0 : r.minCount;
      const pool = volunteers.filter((v) => v.roleIds.includes(r.id));
      for (let k = 0; k < need; k++) {
        let c = counters.get(r.id) ?? 0;
        let pick: Volunteer | undefined;
        for (let tries = 0; tries < pool.length; tries++) {
          const v = pool[(c + tries) % pool.length];
          if (!used.has(v.id)) { pick = v; c = c + tries + 1; break; }
        }
        counters.set(r.id, c);
        if (!pick) continue;
        used.add(pick.id);
        assignments.push({ id: uid(), serviceId: svc.id, roleId: r.id, volunteerId: pick.id, overridden: false, overrideReason: '', createdAt: now });
      }
    }
  });

  // Last Sung reflects the published services.
  for (const svc of services.filter((s) => s.status === 'published')) {
    for (const it of svc.liturgy) {
      const s = songs.find((x) => x.id === it.songId);
      if (s && (!s.lastSung || svc.date > s.lastSung)) s.lastSung = svc.date;
    }
  }

  const availability: Availability[] = [
    { id: uid(), volunteerId: 'vol-9', date: dates[5], note: 'Out of town' },
    { id: uid(), volunteerId: 'vol-4', date: dates[5], note: 'Family event' },
    { id: uid(), volunteerId: 'vol-1', date: addDays(dates[5], 7), note: 'Travelling' },
  ];

  const profiles: Profile[] = [
    { id: 'user-admin', email: 'admin@example.org', displayName: 'Church administrator', role: 'admin' },
    { id: 'user-pastor', email: 'pastor@example.org', displayName: 'Ptr. Daniel Reyes', role: 'approver' },
    { id: 'user-planner', email: 'planner@example.org', displayName: 'Worship coordinator', role: 'planner' },
    { id: 'user-viewer', email: 'member@example.org', displayName: 'Ministry member', role: 'viewer' },
  ];

  return {
    profiles,
    role_permissions: defaultRolePermissions(),
    ministries,
    role_definitions: roles,
    volunteers,
    availability,
    services,
    assignments,
    songs,
    liturgy_templates: templates,
    liturgy_versions: versions,
    audit_log: [{ id: uid(), at: now, actor: 'system', action: 'seed', entity: 'app', entityId: '-', details: 'Demo data created' }],
    app_settings: [DEFAULT_SETTINGS],
  };
}
