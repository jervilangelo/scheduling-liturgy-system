import { bootPage } from '../components/shared/boot';
import { h, param, setParam } from '../utils/dom';
import { iconButton, pageHeader, panel, statusPill } from '../components/shared/ui';
import { primaryMinistry, specialTags } from '../components/shared/service-helpers';
import { loadSchedulingContext } from '../services/api/store';
import { addDays, daysInMonth, formatLong, isSunday, monthName, startOfWeek, todayISO, weekdayShort, isValidISODate } from '../utils/dates';
import { staffing } from '../modules/conflict-detection';
import { STATUS_LABEL } from '../modules/publishing';
import type { Service, ServiceStatus } from '../types/domain';

type View = 'month' | 'week';

void bootPage({
  id: 'calendar',
  title: 'Calendar',
  render: async ({ main, settings }) => {
    const ctx = await loadSchedulingContext();
    const worship = primaryMinistry(ctx.ministries);
    const ministryById = new Map(ctx.ministries.map((m) => [m.id, m]));
    const today = todayISO();

    let view: View = param('view') === 'week' ? 'week' : 'month';
    let anchor = param('d') && isValidISODate(param('d')!) ? param('d')! : today;
    let statusFilter: ServiceStatus | 'all' = 'all';

    const body = h('div');

    const servicesOn = (d: string) => ctx.services.filter((s) => s.date === d && (statusFilter === 'all' || s.status === statusFilter));

    const chip = (s: Service | null, date: string) => {
      const m = s ? ministryById.get(s.ministryId) : worship;
      const st = staffing(ctx, s ?? ({ id: '-', ministryId: worship.id } as Service));
      return h('a', {
        class: `svc-chip st-${s?.status ?? 'none'}`,
        href: `liturgy.html?date=${date}${s && s.ministryId !== worship.id ? `&ministry=${s.ministryId}` : ''}`,
        'aria-label': `${m?.name ?? 'Service'} ${formatLong(date)}: ${s ? STATUS_LABEL[s.status] : 'not started'}`,
      },
        h('span', { style: 'font-weight:500' }, s ? STATUS_LABEL[s.status] : 'Not started'),
        specialTags(date, settings, m, s?.creedOverride ?? null),
        s?.sermon.title ? h('span', { style: 'color:var(--muted)' }, s.sermon.title) : null,
        s ? h('span', { style: 'color:var(--muted)' }, `${st.filled}/${st.needed} roles`) : null,
      );
    };

    const renderMonth = () => {
      const y = Number(anchor.slice(0, 4));
      const mo = Number(anchor.slice(5, 7));
      const first = `${anchor.slice(0, 7)}-01`;
      const gridStart = startOfWeek(first);
      const last = `${anchor.slice(0, 7)}-${String(daysInMonth(y, mo)).padStart(2, '0')}`;
      const gridEnd = addDays(startOfWeek(last), 6);
      const cells: HTMLElement[] = [];
      for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
        const out = d.slice(0, 7) !== anchor.slice(0, 7);
        const list = servicesOn(d);
        const items: HTMLElement[] = list.map((s) => chip(s, d));
        if (isSunday(d) && !list.some((s) => s.ministryId === worship.id) && statusFilter === 'all' && !out) items.push(chip(null, d));
        cells.push(h('div', {
          class: `month-cell${out ? ' is-out' : ''}${isSunday(d) ? ' is-sunday' : ''}${d === today ? ' is-today' : ''}`,
          'data-date': d,
        }, h('span', { class: 'month-date' }, isSunday(d) && !out ? formatLongNoYear(d) : String(Number(d.slice(8)))), ...items));
      }
      return panel(`${monthName(mo)} ${y}`,
        h('div', { class: 'month', role: 'grid', 'aria-label': `${monthName(mo)} ${y}` },
          [0, 1, 2, 3, 4, 5, 6].map((i) => h('div', { class: 'month-dow', role: 'columnheader' }, weekdayShort(i))),
          ...cells,
        ),
      );
    };

    const renderWeek = () => {
      const start = startOfWeek(anchor);
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      const vol = new Map(ctx.volunteers.map((v) => [v.id, v.name]));
      return panel(`Week of ${formatLong(start)}`,
        h('div', { 'data-testid': 'week-view' }, days.map((d) => {
          const list = servicesOn(d);
          const showEmptySunday = isSunday(d) && !list.some((s) => s.ministryId === worship.id) && statusFilter === 'all';
          if (!list.length && !showEmptySunday) {
            return h('div', { class: 'roster-row' }, h('div', { class: 'roster-role' }, formatLong(d)), h('div', { class: 'dash', style: 'padding-top:6px' }, 'No services'));
          }
          return h('div', { class: 'roster-row' },
            h('div', { class: 'roster-role', style: `font-weight:500${d === today ? ';color:var(--data)' : ''}` }, formatLong(d), specialTags(d, settings, worship)),
            h('div', { class: 'stack', style: 'gap:8px' },
              showEmptySunday ? h('div', { class: 'slots' }, statusPill('none'), h('a', { class: 'btn btn-ghost btn-sm', href: `liturgy.html?date=${d}` }, 'Start the plan')) : null,
              ...list.map((s) => {
                const roles = ctx.roles.filter((r) => r.ministryId === s.ministryId && r.active).sort((a, b) => a.sortOrder - b.sortOrder);
                return h('div', { class: 'stack', style: 'gap:6px' },
                  h('div', { class: 'slots' },
                    h('span', { style: 'font-weight:500' }, `${ministryById.get(s.ministryId)?.name ?? 'Service'} · ${s.startTime}–${s.endTime}`),
                    statusPill(s.status),
                    h('a', { class: 'btn btn-ghost btn-sm', href: `liturgy.html?date=${d}` }, 'Liturgy'),
                    h('a', { class: 'btn btn-ghost btn-sm', href: `scheduling.html?date=${d}` }, 'Team'),
                  ),
                  s.sermon.title ? h('p', null, `${s.sermon.title}${s.sermon.scripture ? ` — ${s.sermon.scripture}` : ''}${s.sermon.preacher ? ` · ${s.sermon.preacher}` : ''}`) : null,
                  h('p', { style: 'color:var(--muted);font-size:13px' }, roles.map((r) => {
                    const names = ctx.assignments.filter((a) => a.serviceId === s.id && a.roleId === r.id).map((a) => vol.get(a.volunteerId)).filter(Boolean);
                    return `${r.name}: ${names.length ? names.join(', ') : '—'}`;
                  }).join(' · ')),
                );
              }),
            ),
          );
        })),
      );
    };

    const toolbar = () => {
      const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'View' },
        (['month', 'week'] as View[]).map((v) => h('button', { type: 'button', 'aria-pressed': String(view === v), onclick: () => { view = v; draw(); } }, v === 'month' ? 'Month' : 'Week')),
      );
      const step = (dir: number) => {
        if (view === 'week') anchor = addDays(anchor, 7 * dir);
        else {
          const y = Number(anchor.slice(0, 4));
          const m = Number(anchor.slice(5, 7)) + dir;
          const yy = m < 1 ? y - 1 : m > 12 ? y + 1 : y;
          const mm = ((m + 11) % 12) + 1;
          anchor = `${yy}-${String(mm).padStart(2, '0')}-01`;
        }
        draw();
      };
      const filter = h('select', { class: 'input select', style: 'width:auto', 'aria-label': 'Filter by status', onchange: (e: Event) => { statusFilter = (e.target as HTMLSelectElement).value as typeof statusFilter; draw(); } },
        h('option', { value: 'all', selected: statusFilter === 'all' }, 'All statuses'),
        (['draft', 'in_review', 'approved', 'published'] as ServiceStatus[]).map((s) => h('option', { value: s, selected: statusFilter === s }, STATUS_LABEL[s])),
      );
      return h('div', { class: 'slots', style: 'margin-bottom:12px' },
        iconButton('left', view === 'week' ? 'Previous week' : 'Previous month', () => step(-1)),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { anchor = today; draw(); } }, 'Today'),
        iconButton('right', view === 'week' ? 'Next week' : 'Next month', () => step(1)),
        seg,
        filter,
      );
    };

    const draw = () => {
      setParam('view', view);
      setParam('d', anchor);
      body.replaceChildren(toolbar(), view === 'month' ? renderMonth() : renderWeek());
    };

    main.replaceChildren(
      pageHeader('Calendar', 'Every Sunday with its special observance and how far its plan has come.', [
        h('a', { class: 'btn btn-secondary', href: 'published.html' }, 'Published schedules'),
      ]),
      body,
    );
    draw();
  },
});

function formatLongNoYear(d: string): string {
  return formatLong(d).replace(/ \d{4}$/, '');
}
