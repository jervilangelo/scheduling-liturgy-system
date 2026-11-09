import { bootPage, type PageContext } from '../components/shared/boot';
import { debounce, h, param, setParam } from '../utils/dom';
import {
  avatar, button, checkbox, confirmDialog, emptyState, errorMessage, field, input, modal, pageHeader, panel, pill, select, statusPill,
  textarea, toast, withBusy,
} from '../components/shared/ui';
import { icon } from '../components/shared/icons';
import { list, loadSchedulingContext, remove, save } from '../services/api/store';
import { addDays, formatLong, formatShort, isValidISODate, todayISO } from '../utils/dates';
import { uid } from '../utils/id';
import { downloadXlsx } from '../modules/exports/xlsx';
import type { Availability, Volunteer } from '../types/domain';

void bootPage({ id: 'volunteers', title: 'Volunteers', render: renderPage });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function renderPage(page: PageContext): Promise<void> {
  const { main, session } = page;
  const ctx = await loadSchedulingContext();
  const canEdit = session.can('manage_volunteers');
  const today = todayISO();
  const serviceById = new Map(ctx.services.map((s) => [s.id, s]));
  const roleById = new Map(ctx.roles.map((r) => [r.id, r]));
  const ministryById = new Map(ctx.ministries.map((m) => [m.id, m]));

  let q = '';
  let roleFilter = '';
  let showInactive = false;

  const historyOf = (v: Volunteer) => ctx.assignments
    .filter((a) => a.volunteerId === v.id)
    .map((a) => ({ a, s: serviceById.get(a.serviceId) }))
    .filter((x) => !!x.s)
    .sort((x, y) => y.s!.date.localeCompare(x.s!.date));

  const tableHost = h('div');
  const draw = () => {
    const term = q.trim().toLowerCase();
    const rows = ctx.volunteers
      .filter((v) => showInactive || v.active)
      .filter((v) => !roleFilter || v.roleIds.includes(roleFilter))
      .filter((v) => !term || `${v.name} ${v.email}`.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) {
      tableHost.replaceChildren(emptyState(ctx.volunteers.length ? 'Nobody matches these filters.' : 'No volunteers yet.', canEdit ? button('Add a volunteer', { variant: 'primary', onClick: () => void edit(null) }) : undefined));
      return;
    }
    tableHost.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'table', 'data-testid': 'volunteer-table' },
      h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Roles'), h('th', null, 'Ministries'), h('th', { class: 'num' }, 'Served, 90 days'), h('th', null, 'Next serving'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
      h('tbody', null, rows.map((v) => {
        const hist = historyOf(v);
        const recent = hist.filter((x) => x.s!.date <= today && x.s!.date >= addDays(today, -90)).length;
        const nextUp = [...hist].reverse().find((x) => x.s!.date >= today);
        return h('tr', null,
          h('td', null, h('div', { class: 'slots', style: 'flex-wrap:nowrap' }, avatar(v.name, v.id), h('div', null, h('div', { style: 'font-weight:500' }, v.name, !v.active ? h('span', { class: 'pill pill-neutral', style: 'margin-left:6px' }, 'Inactive') : null), h('div', { style: 'font-size:12px;color:var(--muted)' }, v.email || '—')))),
          h('td', null, v.roleIds.length ? v.roleIds.map((id) => roleById.get(id)?.name).filter(Boolean).join(', ') : h('span', { class: 'dash' }, 'None')),
          h('td', null, v.ministryIds.map((id) => ministryById.get(id)?.name).filter(Boolean).join(', ') || h('span', { class: 'dash' }, '—')),
          h('td', { class: 'num' }, recent ? String(recent) : h('span', { class: 'dash' }, '0')),
          h('td', null, nextUp ? `${formatShort(nextUp.s!.date)} · ${roleById.get(nextUp.a.roleId)?.name ?? ''}` : h('span', { class: 'dash' }, '—')),
          h('td', { style: 'text-align:right;white-space:nowrap' }, button('Details', { small: true, variant: 'ghost', onClick: () => void details(v) })),
        );
      })),
    )));
  };

  /* ---------- Edit ---------- */
  const edit = async (v: Volunteer | null) => {
    const isNew = !v;
    const cur: Volunteer = v ? structuredClone(v) : { id: uid(), name: '', email: '', phone: '', ministryIds: ctx.ministries.filter((m) => m.active).slice(0, 1).map((m) => m.id), roleIds: [], maxPerMonth: 3, active: true, notes: '' };
    const m = modal(isNew ? 'Add volunteer' : `Edit ${v!.name}`, { wide: true });
    const name = input({ value: cur.name, required: true, autocomplete: 'off' });
    const nameErr = h('p', { class: 'field-error', hidden: true }, 'Enter a name.');
    const email = input({ type: 'email', value: cur.email });
    const emailErr = h('p', { class: 'field-error', hidden: true }, 'Enter a valid email or leave it blank.');
    const phone = input({ type: 'tel', value: cur.phone });
    const max = input({ type: 'number', min: '0', max: '5', value: String(cur.maxPerMonth), class: 'input num' });
    const notes = textarea({ rows: '2' }, cur.notes);
    const ministries = new Set(cur.ministryIds);
    const roles = new Set(cur.roleIds);
    const roleBox = h('div', { class: 'stack', style: 'gap:12px' });
    const drawRoles = () => {
      roleBox.replaceChildren(...ctx.ministries.filter((mi) => ministries.has(mi.id)).map((mi) =>
        h('fieldset', { style: 'border:0;padding:0;margin:0' },
          h('legend', { class: 'field-label', style: 'margin-bottom:6px' }, `${mi.name} roles`),
          h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px 12px' },
            ctx.roles.filter((r) => r.ministryId === mi.id && r.active).sort((a, b) => a.sortOrder - b.sortOrder).map((r) => checkbox(r.name, roles.has(r.id), (on) => { if (on) roles.add(r.id); else roles.delete(r.id); }))),
        )));
      if (!ministries.size) roleBox.append(h('p', { class: 'dash' }, 'Choose a ministry to set role eligibility.'));
    };
    const ministryBox = h('fieldset', { style: 'border:0;padding:0;margin:0' }, h('legend', { class: 'field-label', style: 'margin-bottom:6px' }, 'Ministries'),
      h('div', { class: 'slots' }, ctx.ministries.map((mi) => checkbox(mi.name, ministries.has(mi.id), (on) => { if (on) ministries.add(mi.id); else ministries.delete(mi.id); drawRoles(); }))));
    const active = checkbox('Active (can be scheduled)', cur.active);
    drawRoles();
    m.body.append(h('div', { class: 'form-grid' },
      h('div', null, field('Full name', name), nameErr), h('div', null, field('Email', email), emailErr), field('Phone', phone),
      field('Most services per month', max, '0 means no limit. Going over shows a warning.'),
      h('div', { class: 'span-2' }, ministryBox), h('div', { class: 'span-2' }, roleBox), h('div', { class: 'span-2' }, field('Notes', notes)), active,
    ));
    const saveBtn = button(isNew ? 'Add volunteer' : 'Save changes', { variant: 'primary' });
    saveBtn.addEventListener('click', () => void withBusy(saveBtn, async () => {
      const okName = !!name.value.trim();
      const okEmail = !email.value.trim() || EMAIL_RE.test(email.value.trim());
      nameErr.hidden = okName; name.setAttribute('aria-invalid', String(!okName));
      emailErr.hidden = okEmail; email.setAttribute('aria-invalid', String(!okEmail));
      if (!okName) { name.focus(); return; }
      if (!okEmail) { email.focus(); return; }
      const out: Volunteer = {
        ...cur, name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim(), maxPerMonth: Math.max(0, Number(max.value) || 0),
        notes: notes.value, ministryIds: [...ministries], roleIds: [...roles].filter((r) => ministries.has(roleById.get(r)?.ministryId ?? '')),
        active: (active.querySelector('input') as HTMLInputElement).checked,
      };
      try {
        await save('volunteers', out, { action: isNew ? 'create' : 'update', details: out.name });
        toast(isNew ? `${out.name} added.` : 'Saved.', 'success');
        m.close();
        await page.refresh();
      } catch (e) { toast(errorMessage(e), 'error'); }
    }));
    m.footer.append(
      !isNew ? button('Delete', { variant: 'ghost', onClick: async () => {
        const future = historyOf(cur).filter((x) => x.s!.date >= today);
        if (!(await confirmDialog(`Delete ${cur.name}?`, `${future.length ? `Their ${future.length} upcoming assignments are removed too. ` : ''}Past schedules keep the record of who served. Consider marking them inactive instead.`, 'Delete', true))) return;
        await remove('assignments', future.map((x) => x.a.id));
        await remove('availability', ctx.availability.filter((a) => a.volunteerId === cur.id).map((a) => a.id));
        await remove('volunteers', [cur.id], { action: 'delete', details: cur.name });
        m.close();
        await page.refresh();
      } }) : null,
      button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
      saveBtn,
    );
    name.focus();
  };

  /* ---------- Details: availability + history ---------- */
  const details = async (v: Volunteer) => {
    setParam('id', v.id);
    const m = modal(v.name, { wide: true, onClose: () => setParam('id', null) });
    const avail = (await list('availability')).filter((a) => a.volunteerId === v.id).sort((a, b) => a.date.localeCompare(b.date));
    const hist = historyOf(v);

    const availList = h('ul', { class: 'conflict-list', 'data-testid': 'availability' });
    const drawAvail = () => {
      const upcoming = avail.filter((a) => a.date >= today);
      availList.replaceChildren(...(upcoming.length ? upcoming.map((a) => h('li', null,
        h('div', { style: 'flex:1' }, h('div', null, formatLong(a.date)), a.note ? h('div', { style: 'font-size:12px;color:var(--muted)' }, a.note) : null),
        canEdit ? button('Remove', { small: true, variant: 'ghost', onClick: async () => {
          await remove('availability', [a.id], { action: 'availability-removed', details: `${v.name} ${a.date}` });
          avail.splice(avail.indexOf(a), 1);
          drawAvail();
        } }) : null,
      )) : [h('li', { class: 'dash' }, 'Available for every upcoming date.')]));
    };
    drawAvail();
    const d = input({ type: 'date', min: today, 'aria-label': 'Unavailable date' });
    const note = input({ placeholder: 'Reason (optional)', 'aria-label': 'Reason' });
    const repeat = select([{ value: '1', label: 'This date only' }, { value: '4', label: 'Four weeks from this date' }, { value: '8', label: 'Eight weeks from this date' }], '1', { 'aria-label': 'Repeat', style: 'width:auto' });
    const addBtn = button('Mark unavailable', { small: true });
    addBtn.addEventListener('click', () => void withBusy(addBtn, async () => {
      if (!isValidISODate(d.value)) { toast('Choose a date.', 'error'); d.focus(); return; }
      const n = Number(repeat.value);
      const rows: Availability[] = Array.from({ length: n }, (_, i) => addDays(d.value, i * 7)).filter((x) => !avail.some((a) => a.date === x)).map((x) => ({ id: uid(), volunteerId: v.id, date: x, note: note.value.trim() }));
      await save('availability', rows, { action: 'availability-added', details: `${v.name}: ${rows.map((r) => r.date).join(', ')}` });
      avail.push(...rows);
      avail.sort((a, b) => a.date.localeCompare(b.date));
      d.value = ''; note.value = '';
      drawAvail();
      const clash = hist.filter((x) => rows.some((r) => r.date === x.s!.date));
      if (clash.length) toast(`${v.name} is already scheduled on ${clash.map((x) => formatShort(x.s!.date)).join(', ')}. Check Scheduling.`, 'error');
    }));

    m.body.append(
      h('dl', { class: 'dl' },
        h('dt', null, 'Email'), h('dd', null, v.email || '—'), h('dt', null, 'Phone'), h('dd', null, v.phone || '—'),
        h('dt', null, 'Roles'), h('dd', null, v.roleIds.map((id) => roleById.get(id)?.name).filter(Boolean).join(', ') || '—'),
        h('dt', null, 'Monthly limit'), h('dd', null, v.maxPerMonth ? `${v.maxPerMonth} services` : 'No limit'),
        v.notes ? [h('dt', null, 'Notes'), h('dd', null, v.notes)] : null,
      ),
      h('h3', { class: 'panel-title' }, 'Availability'),
      availList,
      canEdit ? h('div', { class: 'slots' }, d, repeat, note, addBtn) : null,
      h('h3', { class: 'panel-title' }, `Assignment history (${hist.length})`),
      hist.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table', 'data-testid': 'history' },
        h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Role'), h('th', null, 'Ministry'), h('th', null, 'Status'))),
        h('tbody', null, hist.slice(0, 40).map((x) => h('tr', null,
          h('td', null, h('a', { href: `scheduling.html?date=${x.s!.date}` }, formatLong(x.s!.date))),
          h('td', null, roleById.get(x.a.roleId)?.name ?? '—', x.a.overridden ? pill('Override', 'neutral') : null),
          h('td', null, ministryById.get(x.s!.ministryId)?.name ?? '—'),
          h('td', null, statusPill(x.s!.status)),
        ))),
      )) : h('p', { class: 'dash' }, 'Has not served yet.'),
    );
    m.footer.append(canEdit ? button('Edit details', { onClick: () => { m.close(); void edit(v); } }) : null, button('Close', { variant: 'ghost', onClick: () => m.close() }));
  };

  /* ---------- Toolbar ---------- */
  const search = input({ type: 'search', placeholder: 'Search by name or email', 'aria-label': 'Search volunteers' });
  search.addEventListener('input', debounce(() => { q = search.value; draw(); }, 120));
  const roleSel = select([{ value: '', label: 'All roles' }, ...ctx.roles.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ value: r.id, label: r.name }))], '', { 'aria-label': 'Filter by role', style: 'width:auto' });
  roleSel.addEventListener('change', () => { roleFilter = roleSel.value; draw(); });
  const inactive = checkbox('Show inactive', false, (on) => { showInactive = on; draw(); });

  const exportXlsx = () => downloadXlsx([{
    name: 'Volunteers',
    widths: [26, 30, 16, 40, 26, 10, 8],
    rows: [['Name', 'Email', 'Phone', 'Roles', 'Ministries', 'Max / month', 'Active'],
      ...ctx.volunteers.sort((a, b) => a.name.localeCompare(b.name)).map((v) => [v.name, v.email, v.phone, v.roleIds.map((id) => roleById.get(id)?.name).filter(Boolean).join(', '), v.ministryIds.map((id) => ministryById.get(id)?.name).join(', '), v.maxPerMonth, v.active ? 'Yes' : 'No'])],
  }], `eccm-volunteers-${today}.xlsx`);

  const active = ctx.volunteers.filter((v) => v.active).length;
  main.replaceChildren(
    pageHeader('Volunteers', `${active} active of ${ctx.volunteers.length} in one directory shared by every ministry.`, [
      button('Export to Excel', { icon: 'download', onClick: exportXlsx }),
      canEdit ? button('Add volunteer', { variant: 'primary', icon: 'plus', onClick: () => void edit(null) }) : h('span'),
    ]),
    panel(null,
      h('div', { class: 'slots panel-body', style: 'border-bottom:1px solid var(--rule)' }, h('div', { class: 'search', style: 'flex:1;min-width:220px' }, icon('search'), search), roleSel, inactive),
      tableHost,
    ),
  );
  draw();

  const openId = param('id');
  const openV = openId ? ctx.volunteers.find((v) => v.id === openId) : undefined;
  if (openV) void details(openV);
}
