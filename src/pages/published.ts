import { bootPage, type PageContext } from '../components/shared/boot';
import { copyText, h, param, setParam } from '../utils/dom';
import { button, emptyState, pageHeader, select, statusPill, toast } from '../components/shared/ui';
import { specialTags } from '../components/shared/service-helpers';
import { workflowBar } from '../components/shared/workflow-bar';
import { list, loadSchedulingContext } from '../services/api/store';
import { serviceAsText, servicesAsText, scheduleWorkbook, type ScheduleData } from '../modules/exports/schedule';
import { downloadXlsx } from '../modules/exports/xlsx';
import { isBullet, itemLine, monthDay, normalizeItems } from '../modules/liturgy';
import { formatDateTime, formatLong, todayISO } from '../utils/dates';
import type { Service } from '../types/domain';

void bootPage({ id: 'published', title: 'Published', render: renderPage });

type Range = 'upcoming' | 'past' | 'all';

async function renderPage(page: PageContext): Promise<void> {
  const { main, settings, session } = page;
  const ctx = await loadSchedulingContext();
  const songs = await list('songs');
  const data: ScheduleData = { services: ctx.services, assignments: ctx.assignments, roles: ctx.roles, volunteers: ctx.volunteers, songs, settings };
  const today = todayISO();
  const ministryById = new Map(ctx.ministries.map((m) => [m.id, m]));
  const songById = new Map(songs.map((s) => [s.id, s]));
  const volById = new Map(ctx.volunteers.map((v) => [v.id, v.name]));

  let range: Range = (param('range') as Range) || 'upcoming';
  let includeApproved = param('approved') === '1';
  const focus = param('date');

  const host = h('div', { class: 'stack' });

  const visible = (): Service[] => ctx.services
    .filter((s) => s.status === 'published' || (includeApproved && s.status === 'approved'))
    .filter((s) => (focus ? s.date === focus : range === 'upcoming' ? s.date >= today : range === 'past' ? s.date < today : true))
    .sort((a, b) => (range === 'past' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));

  const doc = (s: Service): HTMLElement => {
    const m = ministryById.get(s.ministryId);
    const roles = ctx.roles.filter((r) => r.ministryId === s.ministryId && r.active).sort((a, b) => a.sortOrder - b.sortOrder);
    return h('article', { class: 'sheet-doc print-break', 'data-testid': 'published-service', 'aria-labelledby': `t-${s.id}` },
      h('div', { class: 'slots', style: 'justify-content:space-between;align-items:flex-start' },
        h('div', { class: 'stack', style: 'gap:6px' },
          h('h2', { id: `t-${s.id}` }, formatLong(s.date)),
          h('p', { style: 'color:var(--muted)' }, `${m?.name ?? 'Service'} · ${s.startTime}–${s.endTime}${s.publishedAt ? ` · published ${formatDateTime(s.publishedAt)}` : ''}`),
          specialTags(s.date, settings, m, s.creedOverride),
        ),
        h('div', { class: 'slots no-print' },
          button('Copy as text', { icon: 'copy', small: true, onClick: async () => { toast((await copyText(serviceAsText(data, s))) ? 'Copied to the clipboard.' : 'Copy failed.', 'info'); } }),
          button('Excel', { icon: 'download', small: true, onClick: () => downloadXlsx(scheduleWorkbook(data, [s]), `eccm-${s.date}.xlsx`) }),
          workflowBar(s, session, () => void page.refresh()),
        ),
      ),
      h('div', { class: 'sheet-cols', style: 'margin-top:12px' },
        h('section', null,
          (s.theme || s.sermon.title) ? h('div', null,
            h('h3', null, 'Sermon'),
            h('p', null, [s.sermon.title, s.sermon.scripture].filter(Boolean).join(' — ') || '—'),
            s.sermon.preacher ? h('p', { style: 'color:var(--muted)' }, s.sermon.preacher) : null,
          ) : null,
          h('h3', null, 'Order of worship'),
          h('p', { style: 'font-weight:500;font-size:15px' }, monthDay(s.date)),
          s.liturgy.length ? h('ul', { class: 'doc-static', style: 'margin-left:0' }, normalizeItems(s.liturgy, songById).map((i) =>
            h('li', { class: isBullet(i) ? 'is-bullet' : '' }, isBullet(i) ? `– ${itemLine(i, songById).slice(2)}` : itemLine(i, songById)),
          )) : h('p', { class: 'dash' }, 'No order of worship.'),
        ),
        h('section', null,
          h('h3', null, 'Ministry team'),
          h('table', { class: 'table' }, h('tbody', null, roles.map((r) => {
            const names = ctx.assignments.filter((a) => a.serviceId === s.id && a.roleId === r.id).map((a) => volById.get(a.volunteerId) ?? 'Removed volunteer');
            return h('tr', null, h('td', { style: 'padding-left:0;color:var(--muted)' }, r.name), h('td', { style: 'padding-right:0' }, names.length ? names.join(', ') : h('span', { class: 'dash' }, '—')));
          }))),
        ),
      ),
    );
  };

  const draw = () => {
    setParam('range', range === 'upcoming' ? null : range);
    setParam('approved', includeApproved ? '1' : null);
    const list = visible();
    host.replaceChildren(...(list.length ? list.map(doc) : [h('div', { class: 'panel' }, emptyState(focus ? 'This Sunday has not been published yet.' : range === 'upcoming' ? 'No upcoming services are published yet.' : 'No published services in this range.', h('a', { class: 'btn btn-secondary', href: 'calendar.html' }, 'Open the calendar')))]));
    copyAll.disabled = !list.length; printBtn.disabled = !list.length; xlsxBtn.disabled = !list.length;
  };

  const copyAll = button('Copy all as text', { icon: 'copy', onClick: async () => { toast((await copyText(servicesAsText(data, visible()))) ? 'Copied to the clipboard.' : 'Copy failed.'); } });
  const printBtn = button('Print or save PDF', { icon: 'print', onClick: () => window.print() });
  const xlsxBtn = button('Export to Excel', { icon: 'download', variant: 'primary', onClick: () => downloadXlsx(scheduleWorkbook(data, visible()), `eccm-schedule-${today}.xlsx`) });

  const rangeSel = select([{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }, { value: 'all', label: 'All' }], range, { 'aria-label': 'Range', style: 'width:auto' });
  rangeSel.addEventListener('change', () => { range = rangeSel.value as Range; draw(); });
  const appr = h('label', { class: 'check-row' }, h('input', { type: 'checkbox', class: 'checkbox', checked: includeApproved, onchange: (e: Event) => { includeApproved = (e.target as HTMLInputElement).checked; draw(); } }), h('span', null, 'Include approved, not yet published'));

  main.replaceChildren(
    pageHeader(focus ? `Published · ${formatLong(focus)}` : 'Published schedules', 'Read-only plans for the congregation and the teams who serve.', [copyAll, printBtn, xlsxBtn]),
    h('div', { class: 'slots no-print', style: 'margin-bottom:12px' },
      focus ? h('a', { class: 'btn btn-ghost btn-sm', href: 'published.html' }, 'Show all') : rangeSel,
      focus ? null : appr,
      h('span', { style: 'color:var(--muted)' }, 'Statuses:'), statusPill('published'), includeApproved ? statusPill('approved') : null,
    ),
    host,
  );
  draw();
}
