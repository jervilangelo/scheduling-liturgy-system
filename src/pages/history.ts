import { bootPage, type PageContext } from '../components/shared/boot';
import { debounce, h, param, setParam } from '../utils/dom';
import { button, emptyState, input, modal, pageHeader, panel, statusPill } from '../components/shared/ui';
import { icon } from '../components/shared/icons';
import { list, loadSchedulingContext } from '../services/api/store';
import { diffLines, itemLine } from '../modules/liturgy';
import { staffing } from '../modules/conflict-detection';
import { downloadXlsx } from '../modules/exports/xlsx';
import { formatDateTime, formatLong, todayISO } from '../utils/dates';
import type { LiturgyVersion, Song } from '../types/domain';

void bootPage({ id: 'history', title: 'History', render: renderPage });

type Tab = 'schedules' | 'revisions' | 'audit';
const TABS: { id: Tab; label: string }[] = [
  { id: 'schedules', label: 'Past schedules' },
  { id: 'revisions', label: 'Liturgy revisions' },
  { id: 'audit', label: 'Audit log' },
];

async function renderPage(page: PageContext): Promise<void> {
  const { main } = page;
  const ctx = await loadSchedulingContext();
  const [versions, auditLog, songs] = await Promise.all([list('liturgy_versions'), list('audit_log'), list('songs')]);
  const songById = new Map(songs.map((s) => [s.id, s]));
  const serviceById = new Map(ctx.services.map((s) => [s.id, s]));
  const today = todayISO();

  let tab: Tab = (TABS.find((t) => t.id === param('tab'))?.id) ?? 'schedules';
  let filter = '';
  const body = h('div');

  const tabBar = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'History' });
  const drawTabs = () => {
    tabBar.replaceChildren(...TABS.map((t) => h('button', {
      type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(t.id === tab), id: `tab-${t.id}`, 'aria-controls': 'tab-panel',
      onclick: () => { tab = t.id; filter = ''; setParam('tab', tab === 'schedules' ? null : tab); drawTabs(); draw(); },
    }, t.label)));
  };

  const schedules = () => {
    const past = ctx.services.filter((s) => s.date < today).sort((a, b) => b.date.localeCompare(a.date));
    const term = filter.toLowerCase();
    const rows = past.filter((s) => !term || `${s.date} ${s.theme} ${s.sermon.title} ${s.sermon.preacher}`.toLowerCase().includes(term));
    if (!rows.length) return emptyState(past.length ? 'Nothing matches.' : 'No past services yet.');
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table', 'data-testid': 'past-schedules' },
      h('thead', null, h('tr', null, h('th', null, 'Sunday'), h('th', null, 'Sermon'), h('th', null, 'Status'), h('th', { class: 'num' }, 'Team'), h('th', { class: 'num' }, 'Revisions'), h('th', null, h('span', { class: 'sr-only' }, 'Open')))),
      h('tbody', null, rows.map((s) => {
        const st = staffing(ctx, s);
        const n = versions.filter((v) => v.serviceId === s.id).length;
        return h('tr', null,
          h('td', null, formatLong(s.date)),
          h('td', null, s.sermon.title || h('span', { class: 'dash' }, '—'), s.sermon.preacher ? h('div', { style: 'font-size:12px;color:var(--muted)' }, s.sermon.preacher) : null),
          h('td', null, statusPill(s.status)),
          h('td', { class: 'num' }, `${st.filled}/${st.needed}`),
          h('td', { class: 'num' }, n ? String(n) : h('span', { class: 'dash' }, '0')),
          h('td', { style: 'text-align:right;white-space:nowrap' },
            s.status === 'published' ? h('a', { class: 'btn btn-ghost btn-sm', href: `published.html?date=${s.date}` }, 'View') : null,
            h('a', { class: 'btn btn-ghost btn-sm', href: `liturgy.html?date=${s.date}` }, 'Liturgy'),
            h('a', { class: 'btn btn-ghost btn-sm', href: `scheduling.html?date=${s.date}` }, 'Team'),
          ),
        );
      })),
    ));
  };

  const revisions = () => {
    const term = filter.toLowerCase();
    const rows = [...versions]
      .map((v) => ({ v, s: serviceById.get(v.serviceId) }))
      .filter((x) => !term || `${x.s?.date} ${x.v.note} ${x.v.savedBy}`.toLowerCase().includes(term))
      .sort((a, b) => b.v.savedAt.localeCompare(a.v.savedAt));
    if (!rows.length) return emptyState('No liturgy revisions yet.');
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table', 'data-testid': 'revisions' },
      h('thead', null, h('tr', null, h('th', null, 'Saved'), h('th', null, 'Sunday'), h('th', { class: 'num' }, 'Version'), h('th', null, 'By'), h('th', null, 'Note'), h('th', null, h('span', { class: 'sr-only' }, 'Compare')))),
      h('tbody', null, rows.slice(0, 200).map(({ v, s }) => {
        const prev = versions.filter((x) => x.serviceId === v.serviceId && x.version < v.version).sort((a, b) => b.version - a.version)[0];
        return h('tr', null,
          h('td', null, formatDateTime(v.savedAt)),
          h('td', null, s ? h('a', { href: `liturgy.html?date=${s.date}` }, formatLong(s.date)) : h('span', { class: 'dash' }, 'Deleted service')),
          h('td', { class: 'num' }, String(v.version)),
          h('td', null, v.savedBy),
          h('td', null, v.note || h('span', { class: 'dash' }, '—')),
          h('td', { style: 'text-align:right' }, prev ? button('Changes', { small: true, variant: 'ghost', onClick: () => showDiff(prev, v, songById) }) : h('span', { class: 'dash', style: 'font-size:12px' }, 'First version')),
        );
      })),
    ));
  };

  const audit = () => {
    const term = filter.toLowerCase();
    const rows = [...auditLog].filter((a) => !term || `${a.actor} ${a.action} ${a.entity} ${a.details}`.toLowerCase().includes(term)).sort((a, b) => b.at.localeCompare(a.at));
    if (!rows.length) return emptyState('No audit entries match.');
    return h('div', { class: 'stack', style: 'gap:0' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'table', 'data-testid': 'audit' },
        h('thead', null, h('tr', null, h('th', null, 'When'), h('th', null, 'Who'), h('th', null, 'Action'), h('th', null, 'Record'), h('th', null, 'Details'))),
        h('tbody', null, rows.slice(0, 300).map((a) => h('tr', null,
          h('td', { style: 'white-space:nowrap' }, formatDateTime(a.at)), h('td', null, a.actor), h('td', null, a.action), h('td', null, a.entity.replace(/_/g, ' ')), h('td', null, a.details || h('span', { class: 'dash' }, '—')),
        ))),
      )),
      rows.length > 300 ? h('p', { class: 'panel-body', style: 'color:var(--muted)' }, `Showing the latest 300 of ${rows.length}. Export for the full log.`) : null,
    );
  };

  const search = input({ type: 'search', placeholder: 'Filter', 'aria-label': 'Filter history' });
  search.addEventListener('input', debounce(() => { filter = search.value; draw(); }, 120));
  const exportBtn = button('Export audit log', { icon: 'download', onClick: () => downloadXlsx([{
    name: 'Audit log', widths: [20, 28, 18, 18, 60],
    rows: [['When', 'Who', 'Action', 'Record', 'Details'], ...[...auditLog].sort((a, b) => b.at.localeCompare(a.at)).map((a) => [a.at, a.actor, a.action, a.entity, a.details])],
  }], `eccm-audit-${today}.xlsx`) });

  const draw = () => {
    search.value = filter;
    body.replaceChildren(panel(null,
      h('div', { class: 'slots panel-body', style: 'border-bottom:1px solid var(--rule)' }, h('div', { class: 'search', style: 'flex:1;min-width:200px' }, icon('search'), search), tab === 'audit' ? exportBtn : null),
      h('div', { id: 'tab-panel', role: 'tabpanel', 'aria-labelledby': `tab-${tab}` }, tab === 'schedules' ? schedules() : tab === 'revisions' ? revisions() : audit()),
    ));
  };

  main.replaceChildren(pageHeader('History', 'Past schedules, every saved revision of a liturgy, and who changed what.'), tabBar, body);
  drawTabs();
  draw();
}

function showDiff(a: LiturgyVersion, b: LiturgyVersion, songs: Map<string, Song>) {
  const m = modal(`Changes in version ${b.version}`, { wide: true });
  m.body.append(h('ul', { class: 'diff' }, diffLines(a.items.map((i) => itemLine(i, songs)), b.items.map((i) => itemLine(i, songs))).map((d) => h('li', { class: `d-${d.type}` }, `${d.type === 'added' ? '+ ' : d.type === 'removed' ? '− ' : '  '}${d.text}`))));
}
