import { bootPage } from '../components/shared/boot';
import { h } from '../utils/dom';
import { emptyState, pageHeader, panel, panelWithActions, statusPill } from '../components/shared/ui';
import { primaryMinistry, serviceOn, specialTags } from '../components/shared/service-helpers';
import { list, loadSchedulingContext } from '../services/api/store';
import { openConflicts, serviceConflicts, type Conflict } from '../modules/conflict-detection';
import { formatLong, formatShort, todayISO, upcomingSundays } from '../utils/dates';
import { STATUS_LABEL } from '../modules/publishing';
import { describeSunday, sundayInfo } from '../modules/sunday-rules';
import type { Service } from '../types/domain';

const WEEKS = 6;

void bootPage({
  id: 'dashboard',
  title: 'Dashboard',
  render: async ({ main, settings, session }) => {
    const ctx = await loadSchedulingContext();
    const songs = await list('songs');
    const songById = new Map(songs.map((s) => [s.id, s]));
    const ministry = primaryMinistry(ctx.ministries);
    const roles = ctx.roles.filter((r) => r.ministryId === ministry.id && r.active).sort((a, b) => a.sortOrder - b.sortOrder);
    const today = todayISO();
    const dates = upcomingSundays(today, WEEKS);
    const svc = (d: string) => serviceOn(ctx.services, ministry.id, d);

    // Per-Sunday staffing and conflicts
    const rows = dates.map((date) => {
      const s = svc(date);
      const conflicts = s ? openConflicts(serviceConflicts(ctx, s.id)).filter((c) => c.code !== 'understaffed') : [];
      let needed = 0;
      let filled = 0;
      for (const r of roles) {
        const n = s ? ctx.assignments.filter((a) => a.serviceId === s.id && a.roleId === r.id).length : 0;
        needed += r.minCount;
        filled += Math.min(n, r.minCount);
      }
      return { date, s, conflicts, needed, filled };
    });

    const next = rows[0];
    const openRoles = rows.reduce((n, r) => n + (r.needed - r.filled), 0);
    const allConflicts = rows.flatMap((r) => r.conflicts.map((c) => ({ c, date: r.date })));
    const review = ctx.services.filter((s) => s.status === 'in_review' && s.date >= today);
    const nextSpecial = describeSunday(sundayInfo(next.date, settings, next.s?.creedOverride ?? null), settings);

    main.replaceChildren(
      pageHeader('Dashboard', `Next Sunday is ${formatLong(next.date)}${nextSpecial.length ? ` · ${nextSpecial.join(', ')}` : ''}.`, [
        h('a', { class: 'btn btn-primary', href: `liturgy.html?date=${next.date}` }, 'Plan next Sunday'),
        h('a', { class: 'btn btn-secondary', href: `scheduling.html?date=${next.date}` }, 'Schedule the team'),
      ]),
      h('div', { class: 'stack' },
        kpiStrip([
          { label: 'Next Sunday', value: next.s ? STATUS_LABEL[next.s.status] : 'Not started', note: `${next.filled} of ${next.needed} roles filled`, zero: !next.s },
          { label: `Open roles, next ${WEEKS} Sundays`, value: String(openRoles), note: `${rows.filter((r) => r.needed > r.filled).length} Sundays short`, zero: openRoles === 0 },
          { label: 'Scheduling conflicts', value: String(allConflicts.length), note: `${allConflicts.filter((x) => x.c.severity === 'error').length} blocking`, zero: allConflicts.length === 0 },
          { label: 'Awaiting review', value: String(review.length), note: review.length ? `Earliest ${formatShort(review.map((s) => s.date).sort()[0])}` : 'Nothing waiting', zero: review.length === 0 },
        ]),
        coverMatrix(dates, roles, ctx.assignments, svc, today),
        h('div', { class: 'grid grid-gap lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' },
          upcomingPanel(rows, settings, ministry, songById),
          warningsPanel(allConflicts, ctx.volunteers.length, session.can('edit_schedule')),
        ),
      ),
    );
  },
});

function kpiStrip(items: { label: string; value: string; note: string; zero: boolean }[]): HTMLElement {
  return h('section', { class: 'kpis', 'aria-label': 'Summary' }, items.map((k) =>
    h('div', { class: 'kpi' },
      h('p', { class: 'kpi-label' }, k.label),
      h('p', { class: `kpi-value${k.zero ? ' is-zero' : ''}` }, k.value),
      h('p', { class: 'kpi-note' }, k.note),
    ),
  ));
}

/** Signature element: roles × upcoming Sundays, filled against each role's minimum. */
function coverMatrix(
  dates: string[],
  roles: { id: string; name: string; minCount: number }[],
  assignments: { serviceId: string; roleId: string }[],
  svc: (d: string) => Service | undefined,
  today: string,
): HTMLElement {
  const head = h('tr', null, h('th', { scope: 'col' }, 'Role'), dates.map((d) => h('th', { scope: 'col', class: d === dates[0] && d >= today ? 'is-today' : '' }, formatShort(d))));
  const body = roles.map((r) => h('tr', null,
    h('th', { scope: 'row', style: 'text-align:left;padding-left:20px;font-weight:400;color:var(--text);font-size:14px' }, r.name, h('span', { class: 'cover-rule' }, `needs ${r.minCount}`)),
    dates.map((d) => {
      const s = svc(d);
      const n = s ? assignments.filter((a) => a.serviceId === s.id && a.roleId === r.id).length : 0;
      const short = r.minCount - n;
      const cls = short <= 0 ? 'cell-full' : n > 0 ? 'cell-short1' : '';
      const label = `${r.name} on ${formatShort(d)}: ${n} of ${r.minCount}`;
      return h('td', null, h('a', { class: `cell ${cls}`, href: `scheduling.html?date=${d}`, 'aria-label': label, title: label }, short <= 0 ? `${n}/${r.minCount}` : n === 0 ? h('span', { class: 'dash' }, `0/${r.minCount}`) : `${n}/${r.minCount}`));
    }),
  ));
  return panelWithActions('Team cover', [h('a', { class: 'btn btn-ghost btn-sm', href: 'scheduling.html' }, 'Open scheduling')],
    h('div', { class: 'table-wrap' }, h('table', { class: 'cover', 'data-testid': 'cover-matrix' }, h('thead', null, head), h('tbody', null, body))),
    h('p', { class: 'panel-body', style: 'padding-top:4px;color:var(--muted);font-size:12px' }, 'Blue cells are fully staffed. Each cell opens that Sunday in scheduling.'),
  );
}

function upcomingPanel(
  rows: { date: string; s: Service | undefined; needed: number; filled: number; conflicts: Conflict[] }[],
  settings: Parameters<typeof specialTags>[1],
  ministry: Parameters<typeof specialTags>[2],
  songs: Map<string, { title: string }>,
): HTMLElement {
  const tbl = h('table', { class: 'table' },
    h('thead', null, h('tr', null, h('th', null, 'Sunday'), h('th', null, 'Plan'), h('th', null, 'Status'), h('th', { class: 'num' }, 'Missing'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
    h('tbody', null, rows.map((r) => {
      const songCount = r.s?.liturgy.filter((i) => i.kind === 'song' && i.songId && songs.has(i.songId)).length ?? 0;
      const missing = r.needed - r.filled;
      return h('tr', null,
        h('td', null, h('div', { style: 'font-weight:500' }, formatLong(r.date)), specialTags(r.date, settings, ministry, r.s?.creedOverride ?? null)),
        h('td', null,
          r.s?.sermon.title ? h('div', null, r.s.sermon.title) : h('div', { class: 'dash' }, 'No sermon yet'),
          h('div', { class: 'muted', style: 'font-size:12px' }, r.s?.liturgy.length ? `${r.s.liturgy.length} elements · ${songCount} songs` : 'Order of worship not started'),
        ),
        h('td', null, statusPill(r.s?.status ?? 'none')),
        h('td', { class: 'num' }, missing ? String(missing) : h('span', { class: 'dash' }, '0')),
        h('td', { style: 'white-space:nowrap;text-align:right' },
          h('a', { class: 'btn btn-ghost btn-sm', href: `liturgy.html?date=${r.date}` }, 'Liturgy'),
          h('a', { class: 'btn btn-ghost btn-sm', href: `scheduling.html?date=${r.date}` }, 'Team'),
        ),
      );
    })),
  );
  return panel('Upcoming Sundays', h('div', { class: 'table-wrap' }, tbl));
}

function warningsPanel(items: { c: Conflict; date: string }[], volunteerCount: number, canEdit: boolean): HTMLElement {
  if (!volunteerCount) return panel('Scheduling warnings', emptyState('No volunteers yet. Add people in the volunteer directory to start scheduling.', h('a', { class: 'btn btn-secondary', href: 'volunteers.html' }, 'Add volunteers')));
  if (!items.length) return panel('Scheduling warnings', emptyState('No conflicts in the next six Sundays.'));
  const sorted = [...items].sort((a, b) => (a.c.severity === b.c.severity ? a.date.localeCompare(b.date) : a.c.severity === 'error' ? -1 : 1));
  return panel('Scheduling warnings',
    h('ul', { class: 'conflict-list', 'data-testid': 'dashboard-warnings' }, sorted.slice(0, 8).map(({ c, date }) =>
      h('li', null,
        h('span', { class: `sev sev-${c.severity}`, 'aria-hidden': 'true' }),
        h('div', { style: 'flex:1;min-width:0' },
          h('div', null, c.message),
          h('div', { class: 'muted', style: 'font-size:12px;color:var(--muted)' }, `${formatShort(date)} · ${c.severity === 'error' ? 'Blocking' : 'Warning'}`),
        ),
        canEdit ? h('a', { class: 'btn btn-ghost btn-sm', href: `scheduling.html?date=${date}` }, 'Resolve') : null,
      ),
    )),
    sorted.length > 8 ? h('p', { class: 'panel-body', style: 'color:var(--muted)' }, `${sorted.length - 8} more in scheduling.`) : null,
  );
}
