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

const ROLE_DEFS: [string, string, number][] = [
  ['role-leader', 'Worship leader', 1],
  ['role-vocals', 'Vocals', 2],
  ['role-keys', 'Keyboard', 1],
  ['role-guitar', 'Guitar', 1],
  ['role-bass', 'Bass', 1],
  ['role-drums', 'Drums', 1],
  ['role-reader', 'Scripture reader', 1],
  ['role-prayer', 'Prayer leader', 1],
  ['role-sound', 'Sound', 1],
  ['role-slides', 'Slides', 1],
  ['role-usher', 'Ushers', 2],
];

const PEOPLE: [string, string[]][] = [
  ['Maria Santos', ['role-leader', 'role-vocals']],
  ['Paolo Reyes', ['role-leader', 'role-guitar', 'role-vocals']],
  ['Grace Villanueva', ['role-vocals', 'role-reader']],
  ['Joanna Cruz', ['role-vocals', 'role-prayer']],
  ['Mark Dela Rosa', ['role-keys']],
  ['Bea Mendoza', ['role-keys', 'role-vocals']],
  ['Carlo Bautista', ['role-guitar']],
  ['Nico Aquino', ['role-bass', 'role-guitar']],
  ['Rafael Garcia', ['role-bass']],
  ['Daniel Torres', ['role-drums']],
  ['Miguel Ramos', ['role-drums', 'role-sound']],
  ['Ana Fernandez', ['role-reader', 'role-prayer']],
  ['Ruth Castillo', ['role-reader', 'role-usher']],
  ['Samuel Navarro', ['role-prayer', 'role-reader']],
  ['Josh Pascual', ['role-sound', 'role-slides']],
  ['Ella Domingo', ['role-slides']],
  ['Kevin Lim', ['role-sound']],
  ['Teresa Gonzales', ['role-usher']],
  ['Victor Salazar', ['role-usher']],
  ['Lorna Ocampo', ['role-usher', 'role-prayer']],
  ['Isaac Manalo', ['role-slides', 'role-usher']],
  ['Hannah Tan', ['role-vocals']],
];

const SONGS: [string, string, string[]][] = [
  ['Amazing Grace', 'John Newton', ['Grace', 'Salvation']],
  ['Holy, Holy, Holy', 'Reginald Heber', ['Holiness', 'Trinity']],
  ['Great Is Thy Faithfulness', 'Thomas Chisholm', ['Faithfulness']],
  ['It Is Well with My Soul', 'Horatio Spafford', ['Peace', 'Trust']],
  ['How Great Thou Art', 'Carl Boberg', ['Creation', 'Praise']],
  ['Be Thou My Vision', 'Traditional Irish', ['Devotion']],
  ['Come, Thou Fount of Every Blessing', 'Robert Robinson', ['Grace', 'Devotion']],
  ['When I Survey the Wondrous Cross', 'Isaac Watts', ['Cross', 'Communion']],
  ['Crown Him with Many Crowns', 'Matthew Bridges', ['Kingship', 'Praise']],
  ['A Mighty Fortress Is Our God', 'Martin Luther', ['Refuge', 'Trust']],
  ['Christ the Lord Is Risen Today', 'Charles Wesley', ['Resurrection']],
  ['Rock of Ages', 'Augustus Toplady', ['Salvation', 'Refuge']],
  ['Blessed Assurance', 'Fanny Crosby', ['Assurance']],
  ['And Can It Be', 'Charles Wesley', ['Grace', 'Salvation']],
  ['There Is a Fountain', 'William Cowper', ['Cross', 'Communion']],
  ['Joyful, Joyful, We Adore Thee', 'Henry van Dyke', ['Praise', 'Joy']],
  ['Praise to the Lord, the Almighty', 'Joachim Neander', ['Praise']],
  ['The Church’s One Foundation', 'Samuel Stone', ['Church']],
  ['O Worship the King', 'Robert Grant', ['Praise', 'Kingship']],
  ['Jesus Paid It All', 'Elvina Hall', ['Cross', 'Grace']],
  ['Come Thou Long Expected Jesus', 'Charles Wesley', ['Advent']],
  ['O Come, All Ye Faithful', 'John Francis Wade', ['Christmas']],
  ['Joy to the World', 'Isaac Watts', ['Christmas', 'Joy']],
  ['Doxology', 'Thomas Ken', ['Praise', 'Benediction']],
];

function templateItems(): LiturgyItem[] {
  const t = (kind: LiturgyItem['kind'], title: string, durationMin: number, extra: Partial<LiturgyItem> = {}): LiturgyItem => ({
    id: uid(), kind, title, durationMin, ...extra,
  });
  return [
    t('call_to_worship', 'Call to worship', 3, { scripture: 'Psalm 95:1-7' }),
    t('song', '', 5),
    t('song', '', 5),
    t('prayer', 'Prayer of adoration', 4),
    t('confession', 'Confession and assurance', 4),
    t('song', '', 5),
    t('scripture', 'Scripture reading', 4),
    t('announcements', 'Announcements', 4),
    t('offering', 'Offering', 5),
    t('sermon', 'Sermon', 35),
    t('song', '', 5),
    t('benediction', 'Benediction', 2),
  ];
}

export function buildSeed(today: string = todayISO()): { [K in keyof CollectionMap]: CollectionMap[K][] } {
  const now = new Date().toISOString();
  const ministries: Ministry[] = [
    { id: WORSHIP, slug: 'worship', name: 'Sunday worship', description: 'Main Sunday worship service', defaultStart: '09:00', defaultEnd: '11:00', usesSpecialSundays: true, active: true },
  ];
  const roles: RoleDefinition[] = ROLE_DEFS.map(([id, name, minCount], i) => ({
    id, ministryId: WORSHIP, name, minCount, sortOrder: i, compatibleRoleIds: [], active: true,
  }));
  // A worship leader may also sing; a guitarist may lead.
  roles.find((r) => r.id === 'role-leader')!.compatibleRoleIds = ['role-vocals', 'role-guitar'];

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
        { id: uid(), kind: 'call_to_worship', title: 'Call to worship', durationMin: 3 },
        { id: uid(), kind: 'song', title: '', durationMin: 5 },
        { id: uid(), kind: 'prayer', title: 'Opening prayer', durationMin: 3 },
        { id: uid(), kind: 'sermon', title: 'Sermon', durationMin: 25 },
        { id: uid(), kind: 'song', title: '', durationMin: 5 },
        { id: uid(), kind: 'benediction', title: 'Benediction', durationMin: 2 },
      ],
    },
  ];

  // Past four Sundays published, this coming Sunday drafted, the next one in review.
  const first = nextSunday(today);
  const dates = [-28, -21, -14, -7, 0, 7].map((n) => addDays(first, n));
  const sermons = [
    ['The God who sees', 'Genesis 16:7-14', 'Ptr. Daniel Reyes'],
    ['Bread for the journey', 'John 6:25-35', 'Ptr. Daniel Reyes'],
    ['Faith that waits', 'Habakkuk 2:1-4', 'Ptr. Ruth Santiago'],
    ['Living stones', '1 Peter 2:4-10', 'Ptr. Daniel Reyes'],
    ['Light in the darkness', 'John 1:1-14', 'Ptr. Ruth Santiago'],
    ['', '', ''],
  ];
  const services: Service[] = [];
  const versions: LiturgyVersion[] = [];
  const assignments: Assignment[] = [];
  const songCycle = [...songs];
  let songPtr = 0;

  dates.forEach((date, i) => {
    const info = sundayInfo(date, DEFAULT_SETTINGS);
    const status: Service['status'] = i < 4 ? 'published' : i === 4 ? 'in_review' : 'draft';
    let liturgy = applySundayRules(templateItems(), info, DEFAULT_SETTINGS, uid);
    if (i < 5) {
      liturgy = liturgy.map((it) => {
        if (it.kind !== 'song') return it;
        const s = songCycle[songPtr++ % songCycle.length];
        return { ...it, songId: s.id, title: s.title };
      });
      liturgy = liturgy.map((it) => (it.kind === 'scripture' ? { ...it, scripture: sermons[i][1], leader: '' } : it));
    } else {
      liturgy = [];
    }
    const svc: Service = {
      id: `svc-${date}`,
      ministryId: WORSHIP,
      date,
      startTime: '09:00',
      endTime: '11:00',
      status,
      theme: i < 5 ? sermons[i][0] : '',
      sermon: { title: sermons[i][0], scripture: sermons[i][1], preacher: sermons[i][2], series: i < 5 ? 'Advent of light' : '', notes: '' },
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
      const pool = volunteers.filter((v) => v.roleIds.includes(r.id));
      // On the in-review Sunday leave Slides and one usher open to show gaps.
      const need = si === 4 && (r.id === 'role-slides' || r.id === 'role-usher') ? r.minCount - 1 : r.minCount;
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
    { id: uid(), volunteerId: 'vol-5', date: dates[5], note: 'Out of town' },
    { id: uid(), volunteerId: 'vol-10', date: dates[5], note: 'Family event' },
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
