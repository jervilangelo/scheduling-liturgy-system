import { bootPage, type PageContext } from '../components/shared/boot';
import { h } from '../utils/dom';
import {
  button, checkbox, confirmDialog, emptyState, errorMessage, field, iconButton, input, modal, notice, pageHeader, select, toast, withBusy,
} from '../components/shared/ui';
import { dataMode, list, remove, save } from '../services/api/store';
import { resetLocalData } from '../services/api/backend';
import { CREED_NAMES, creedForMonth } from '../modules/sunday-rules';
import { ITEM_KINDS, moveItem, newItem, totalMinutes } from '../modules/liturgy';
import { DEFAULT_MATRIX, ROLE_LABEL } from '../modules/permissions';
import { downloadBytes } from '../modules/exports/xlsx';
import { formatLong, monthName, sundaysOfMonth, todayISO } from '../utils/dates';
import { uid } from '../utils/id';
import { PERMISSIONS, USER_ROLES, type AppSettings, type CollectionName, type LiturgyItemKind, type LiturgyTemplate, type Ministry, type Profile, type RoleDefinition, type RolePermission, type UserRole } from '../types/domain';

void bootPage({ id: 'settings', title: 'Settings', render: renderPage });

async function renderPage(page: PageContext): Promise<void> {
  const { main, session, settings } = page;
  const [ministries, roles, templates, profiles, matrix] = await Promise.all([
    list('ministries'), list('role_definitions'), list('liturgy_templates'), list('profiles'), list('role_permissions'),
  ]);
  const canSettings = session.can('manage_settings');
  const canUsers = session.can('manage_users');

  const section = (id: string, title: string, desc: string, ...content: (Node | null)[]) =>
    h('section', { class: 'set-section', id, 'aria-labelledby': `${id}-h` },
      h('div', { class: 'set-label' }, h('h2', { id: `${id}-h` }, title), h('p', null, desc)),
      h('div', { class: 'stack' }, ...content),
    );

  const saveSettings = async (patch: Partial<AppSettings>, what: string) => {
    await save('app_settings', { ...settings, ...patch, id: 'global' }, { action: 'update-settings', details: what });
    toast('Settings saved.', 'success');
    await page.refresh();
  };

  /* ---------- General ---------- */
  const churchName = input({ value: settings.churchName, disabled: !canSettings });
  const consec = input({ type: 'number', min: '0', max: '12', value: String(settings.consecutiveWeeksWarning), class: 'input num', disabled: !canSettings });
  const general = section('general', 'General', 'Shown in the sidebar, on published schedules and exports.',
    h('div', { class: 'panel panel-body stack' },
      field('Church name', churchName),
      field('Warn after this many Sundays in a row in one role', consec, '0 turns the warning off.'),
      canSettings ? h('div', null, saveBtn(() => saveSettings({ churchName: churchName.value.trim() || 'ECCM', consecutiveWeeksWarning: Math.max(0, Number(consec.value) || 0) }, 'general'))) : null,
    ),
  );

  /* ---------- Special Sundays ---------- */
  const comm = input({ value: settings.communionLabel, disabled: !canSettings });
  const cpp = input({ value: settings.cppLabel, disabled: !canSettings });
  const anchorMonth = select(Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) })), String(settings.creedAnchorMonth), { disabled: !canSettings });
  const anchorYear = input({ type: 'number', min: '2000', max: '2100', value: String(settings.creedAnchorYear), class: 'input num', disabled: !canSettings });
  const anchorKind = select([{ value: 'nicene', label: CREED_NAMES.nicene }, { value: 'apostles', label: CREED_NAMES.apostles }], settings.creedAnchorKind, { disabled: !canSettings });
  const preview = h('ul', { class: 'stack', style: 'gap:2px;margin:0;padding-left:18px', 'data-testid': 'creed-preview' });
  const drawPreview = () => {
    const s = { creedAnchorYear: Number(anchorYear.value) || 2026, creedAnchorMonth: Number(anchorMonth.value), creedAnchorKind: anchorKind.value as AppSettings['creedAnchorKind'] };
    const t = todayISO();
    preview.replaceChildren(...Array.from({ length: 6 }, (_, i) => {
      const y = Number(t.slice(0, 4)) + Math.floor((Number(t.slice(5, 7)) - 1 + i) / 12);
      const mo = ((Number(t.slice(5, 7)) - 1 + i) % 12) + 1;
      const last = sundaysOfMonth(y, mo).at(-1)!;
      return h('li', null, `${formatLong(last)}: ${CREED_NAMES[creedForMonth(last, s)]}`);
    }));
  };
  [anchorMonth, anchorYear, anchorKind].forEach((el) => el.addEventListener('change', drawPreview));
  drawPreview();
  const specials = section('specials', 'Special Sundays', 'First Sunday: Communion. Second Sunday: CPP. Last Sunday: the creed, alternating monthly. These are added to each plan automatically.',
    h('div', { class: 'panel panel-body stack' },
      h('div', { class: 'form-grid' }, field('First Sunday label', comm), field('Second Sunday label', cpp)),
      h('p', { class: 'field-label' }, 'Creed rotation'),
      h('div', { class: 'form-grid' }, field('Starting month', anchorMonth), field('Year', anchorYear), h('div', { class: 'span-2' }, field('Creed in that month', anchorKind))),
      h('div', null, h('p', { class: 'field-help', style: 'margin-bottom:4px' }, 'Coming last Sundays'), preview),
      canSettings ? h('div', null, saveBtn(() => saveSettings({ communionLabel: comm.value.trim() || 'Communion', cppLabel: cpp.value.trim() || 'CPP', creedAnchorMonth: Number(anchorMonth.value), creedAnchorYear: Number(anchorYear.value) || 2026, creedAnchorKind: anchorKind.value as AppSettings['creedAnchorKind'] }, 'special sundays'))) : null,
    ),
  );

  /* ---------- Ministries ---------- */
  const editMinistry = (m: Ministry | null) => {
    const cur: Ministry = m ? { ...m } : { id: uid(), slug: '', name: '', description: '', defaultStart: '09:00', defaultEnd: '11:00', usesSpecialSundays: false, active: true };
    const md = modal(m ? `Edit ${m.name}` : 'Add ministry');
    const name = input({ value: cur.name });
    const slug = input({ value: cur.slug, pattern: '[a-z0-9-]+' });
    const start = input({ type: 'time', value: cur.defaultStart });
    const end = input({ type: 'time', value: cur.defaultEnd });
    const desc = input({ value: cur.description });
    const sp = checkbox('Apply special Sunday rules (Communion, CPP, creed)', cur.usesSpecialSundays);
    const act = checkbox('Active', cur.active);
    const err = h('div');
    md.body.append(h('div', { class: 'form-grid' }, field('Name', name), field('Short code', slug, 'Lowercase, e.g. kids or pasay-kids.'), field('Usual start', start), field('Usual end', end), h('div', { class: 'span-2' }, field('Description', desc)), sp, act), err);
    const ok = button('Save', { variant: 'primary' });
    ok.addEventListener('click', () => void withBusy(ok, async () => {
      const s = (slug.value.trim() || name.value.trim()).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!name.value.trim()) { err.replaceChildren(notice('Enter a name.', 'negative')); return; }
      if (ministries.some((x) => x.id !== cur.id && x.slug === s)) { err.replaceChildren(notice('Another ministry uses this short code.', 'negative')); return; }
      if (start.value >= end.value) { err.replaceChildren(notice('The end time must be after the start time.', 'negative')); return; }
      await save('ministries', { ...cur, name: name.value.trim(), slug: s, defaultStart: start.value, defaultEnd: end.value, description: desc.value.trim(), usesSpecialSundays: cb(sp), active: cb(act) }, { action: m ? 'update' : 'create', details: name.value.trim() });
      md.close(); await page.refresh();
    }));
    md.footer.append(button('Cancel', { variant: 'ghost', onClick: () => md.close() }), ok);
  };
  const ministriesSec = section('ministries', 'Ministries', 'Every ministry shares one volunteer directory, availability and conflict check, so a person can never be double-booked across ministries.',
    h('div', { class: 'panel' },
      h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Ministry'), h('th', null, 'Usual time'), h('th', { class: 'num' }, 'Roles'), h('th', null, 'Status'), h('th', null, h('span', { class: 'sr-only' }, 'Edit')))),
        h('tbody', null, ministries.map((m) => h('tr', null,
          h('td', null, h('div', { style: 'font-weight:500' }, m.name), h('div', { style: 'font-size:12px;color:var(--muted)' }, m.slug)),
          h('td', { class: 'num' }, `${m.defaultStart}–${m.defaultEnd}`),
          h('td', { class: 'num' }, String(roles.filter((r) => r.ministryId === m.id && r.active).length)),
          h('td', null, m.active ? 'Active' : h('span', { class: 'dash' }, 'Inactive')),
          h('td', { style: 'text-align:right' }, canSettings ? button('Edit', { small: true, variant: 'ghost', onClick: () => editMinistry(m) }) : null),
        ))),
      ),
      canSettings ? h('div', { class: 'panel-body', style: 'border-top:1px solid var(--rule)' }, button('Add ministry', { icon: 'plus', small: true, onClick: () => editMinistry(null) })) : null,
    ),
  );

  /* ---------- Roles ---------- */
  const roleSections = ministries.map((m) => {
    const mine = roles.filter((r) => r.ministryId === m.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const persistOrder = async (ordered: RoleDefinition[]) => {
      await save('role_definitions', ordered.map((r, i) => ({ ...r, sortOrder: i })), { action: 'reorder-roles', details: m.name });
      await page.refresh();
    };
    return h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h3', { class: 'panel-title' }, m.name)),
      mine.length ? h('table', { class: 'table', 'data-testid': `roles-${m.slug}` },
        h('thead', null, h('tr', null, h('th', null, 'Role'), h('th', { class: 'num' }, 'Needed'), h('th', null, 'Can also hold'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', null, mine.map((r, i) => h('tr', { style: r.active ? '' : 'color:var(--muted)' },
          h('td', null, r.name, r.active ? null : ' (inactive)'),
          h('td', { class: 'num' }, String(r.minCount)),
          h('td', null, r.compatibleRoleIds.map((id) => roles.find((x) => x.id === id)?.name).filter(Boolean).join(', ') || h('span', { class: 'dash' }, '—')),
          h('td', { style: 'text-align:right;white-space:nowrap' }, canSettings ? [
            iconButton('up', `Move ${r.name} up`, () => void persistOrder(moveItem(mine, i, i - 1)), i === 0),
            iconButton('down', `Move ${r.name} down`, () => void persistOrder(moveItem(mine, i, i + 1)), i === mine.length - 1),
            button('Edit', { small: true, variant: 'ghost', onClick: () => editRole(m, r) }),
          ] : null),
        ))),
      ) : emptyState('No roles yet.'),
      canSettings ? h('div', { class: 'panel-body', style: 'border-top:1px solid var(--rule)' }, button('Add role', { icon: 'plus', small: true, onClick: () => editRole(m, null) })) : null,
    );
  });
  const editRole = (m: Ministry, r: RoleDefinition | null) => {
    const cur: RoleDefinition = r ? { ...r, compatibleRoleIds: [...r.compatibleRoleIds] } : { id: uid(), ministryId: m.id, name: '', minCount: 1, sortOrder: roles.filter((x) => x.ministryId === m.id).length, compatibleRoleIds: [], active: true };
    const md = modal(r ? `Edit ${r.name}` : `Add a ${m.name} role`);
    const name = input({ value: cur.name });
    const count = input({ type: 'number', min: '0', max: '20', value: String(cur.minCount), class: 'input num' });
    const compat = new Set(cur.compatibleRoleIds);
    const others = roles.filter((x) => x.ministryId === m.id && x.id !== cur.id);
    const act = checkbox('Active', cur.active);
    const err = h('div');
    md.body.append(field('Role name', name), field('People needed each service', count),
      others.length ? h('fieldset', { style: 'border:0;margin:0;padding:0' }, h('legend', { class: 'field-label', style: 'margin-bottom:6px' }, 'The same person may also hold'), h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:4px 12px' }, others.map((o) => checkbox(o.name, compat.has(o.id), (on) => { if (on) compat.add(o.id); else compat.delete(o.id); })))) : null,
      act, err);
    const ok = button('Save', { variant: 'primary' });
    ok.addEventListener('click', () => void withBusy(ok, async () => {
      if (!name.value.trim()) { err.replaceChildren(notice('Enter a role name.', 'negative')); return; }
      await save('role_definitions', { ...cur, name: name.value.trim(), minCount: Math.max(0, Number(count.value) || 0), compatibleRoleIds: [...compat], active: cb(act) }, { action: r ? 'update' : 'create', details: `${m.name}: ${name.value.trim()}` });
      md.close(); await page.refresh();
    }));
    md.footer.append(button('Cancel', { variant: 'ghost', onClick: () => md.close() }), ok);
  };
  const rolesSec = section('roles', 'Ministry roles', 'The roles each service needs, how many people, and which roles one person may combine.', ...roleSections);

  /* ---------- Templates ---------- */
  const editTemplate = (t: LiturgyTemplate | null) => {
    const cur: LiturgyTemplate = t ? structuredClone(t) : { id: uid(), name: '', description: '', items: [] };
    const md = modal(t ? `Edit template: ${t.name}` : 'New template', { wide: true });
    const name = input({ value: cur.name });
    const desc = input({ value: cur.description });
    const rows = h('ol', { class: 'order' });
    const draw = () => {
      rows.replaceChildren(...cur.items.map((it, i) => {
        const k = select(ITEM_KINDS.map((x) => ({ value: x.kind, label: x.label })), it.kind, { 'aria-label': `Element ${i + 1} type` });
        k.addEventListener('change', () => { it.kind = k.value as LiturgyItemKind; });
        const title = input({ value: it.title, 'aria-label': `Element ${i + 1} title`, placeholder: it.kind === 'song' ? 'Chosen when planning' : '' });
        title.addEventListener('input', () => { it.title = title.value; });
        const mins = input({ type: 'number', min: '0', value: String(it.durationMin ?? 0), class: 'input num', 'aria-label': `Element ${i + 1} minutes` });
        mins.addEventListener('input', () => { it.durationMin = Number(mins.value) || 0; });
        return h('li', { class: 'order-item', style: 'grid-template-columns:28px minmax(0,1fr) auto' },
          h('span', { class: 'order-num' }, String(i + 1)),
          h('div', { class: 'order-fields', style: 'grid-template-columns:170px minmax(0,1fr) 76px' }, k, title, mins),
          h('div', { class: 'order-tools' },
            iconButton('up', `Move element ${i + 1} up`, () => { cur.items = moveItem(cur.items, i, i - 1); draw(); }, i === 0),
            iconButton('down', `Move element ${i + 1} down`, () => { cur.items = moveItem(cur.items, i, i + 1); draw(); }, i === cur.items.length - 1),
            iconButton('trash', `Remove element ${i + 1}`, () => { cur.items.splice(i, 1); draw(); }),
          ),
        );
      }));
    };
    draw();
    const kind = select(ITEM_KINDS.map((x) => ({ value: x.kind, label: x.label })), 'song', { 'aria-label': 'Element to add', style: 'width:auto' });
    md.body.append(h('div', { class: 'form-grid' }, field('Name', name), field('Description', desc)), h('div', { class: 'panel' }, rows),
      h('div', { class: 'slots' }, kind, button('Add element', { icon: 'plus', small: true, onClick: () => { cur.items.push(newItem(kind.value as LiturgyItemKind, uid)); draw(); } })),
      h('p', { class: 'field-help' }, 'Communion, CPP and the creed are added on the right Sundays automatically; templates do not need them.'));
    const err = h('div');
    md.body.append(err);
    const ok = button('Save template', { variant: 'primary' });
    ok.addEventListener('click', () => void withBusy(ok, async () => {
      if (!name.value.trim()) { err.replaceChildren(notice('Enter a template name.', 'negative')); return; }
      await save('liturgy_templates', { ...cur, name: name.value.trim(), description: desc.value.trim() }, { action: t ? 'update-template' : 'create-template', details: name.value.trim() });
      md.close(); await page.refresh();
    }));
    md.footer.append(
      t ? button('Delete', { variant: 'ghost', onClick: async () => {
        if (!(await confirmDialog(`Delete "${t.name}"?`, 'Plans already made from it are not affected.', 'Delete', true))) return;
        await remove('liturgy_templates', [t.id], { action: 'delete-template', details: t.name });
        if (settings.defaultTemplateId === t.id) await save('app_settings', { ...settings, defaultTemplateId: null });
        md.close(); await page.refresh();
      } }) : null,
      button('Cancel', { variant: 'ghost', onClick: () => md.close() }), ok);
  };
  const templatesSec = section('templates', 'Liturgy templates', 'Starting orders of worship for planners. The default is suggested first.',
    h('div', { class: 'panel' },
      templates.length ? h('table', { class: 'table', 'data-testid': 'templates' },
        h('thead', null, h('tr', null, h('th', null, 'Template'), h('th', { class: 'num' }, 'Elements'), h('th', { class: 'num' }, 'Minutes'), h('th', null, 'Default'), h('th', null, h('span', { class: 'sr-only' }, 'Edit')))),
        h('tbody', null, templates.map((t) => h('tr', null,
          h('td', null, h('div', { style: 'font-weight:500' }, t.name), t.description ? h('div', { style: 'font-size:12px;color:var(--muted)' }, t.description) : null),
          h('td', { class: 'num' }, String(t.items.length)),
          h('td', { class: 'num' }, String(totalMinutes(t.items))),
          h('td', null, settings.defaultTemplateId === t.id ? 'Default' : canSettings ? button('Make default', { small: true, variant: 'ghost', onClick: () => void saveSettings({ defaultTemplateId: t.id }, `default template ${t.name}`) }) : h('span', { class: 'dash' }, '—')),
          h('td', { style: 'text-align:right' }, canSettings ? button('Edit', { small: true, variant: 'ghost', onClick: () => editTemplate(t) }) : null),
        ))),
      ) : emptyState('No templates yet.'),
      canSettings ? h('div', { class: 'panel-body', style: 'border-top:1px solid var(--rule)' }, button('New template', { icon: 'plus', small: true, onClick: () => editTemplate(null) })) : null,
    ),
  );

  /* ---------- Google Sheets ---------- */
  const sid = input({ value: settings.sheetSpreadsheetId, disabled: !canSettings, placeholder: 'From the sheet URL: /spreadsheets/d/<ID>/edit' });
  const sname = input({ value: settings.sheetName, disabled: !canSettings });
  const hTitle = input({ value: settings.sheetTitleHeader, disabled: !canSettings });
  const hLast = input({ value: settings.sheetLastSungHeader, disabled: !canSettings });
  const hTheme = input({ value: settings.sheetThemeHeader, disabled: !canSettings });
  const hArtist = input({ value: settings.sheetArtistHeader, disabled: !canSettings });
  const sheets = section('sheets', 'Google Sheets SongList', 'The existing SongList sheet stays the source of songs. Only the Last Sung cells of existing rows are ever written.',
    h('div', { class: 'panel panel-body stack' },
      dataMode === 'local' ? notice('Demo mode: live sync needs Supabase and the songlist-sync Edge Function (see docs/SETUP.md). Paste import works without it.', 'info') : null,
      field('Spreadsheet ID', sid, 'Paste the full sheet link or just the ID.'),
      field('Tab name', sname),
      h('div', { class: 'form-grid' }, field('Title column header', hTitle), field('Last Sung column header', hLast), field('Theme column header', hTheme), field('Artist column header', hArtist)),
      canSettings ? h('div', null, saveBtn(() => {
        const idMatch = sid.value.match(/\/d\/([a-zA-Z0-9-_]+)/);
        return saveSettings({ sheetSpreadsheetId: (idMatch ? idMatch[1] : sid.value).trim(), sheetName: sname.value.trim() || 'SongList', sheetTitleHeader: hTitle.value.trim() || 'Title', sheetLastSungHeader: hLast.value.trim() || 'Last Sung', sheetThemeHeader: hTheme.value.trim(), sheetArtistHeader: hArtist.value.trim() }, 'google sheets');
      })) : null,
    ),
  );

  /* ---------- Users ---------- */
  const usersSec = canUsers ? section('users', 'Users and roles', dataMode === 'local' ? 'Demo accounts. In production, people sign in with Supabase Auth and an administrator assigns their role here.' : 'People invited through Supabase Auth appear here as viewers. Assign each person a role.',
    h('div', { class: 'panel' }, h('table', { class: 'table', 'data-testid': 'users' },
      h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Email'), h('th', null, 'Role'))),
      h('tbody', null, profiles.sort((a, b) => a.email.localeCompare(b.email)).map((p) => {
        const sel = select(USER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })), p.role, { 'aria-label': `Role for ${p.email}`, style: 'width:auto', disabled: p.id === session.profile.id });
        sel.addEventListener('change', async () => {
          try {
            await save('profiles', { ...p, role: sel.value as UserRole }, { action: 'change-role', details: `${p.email}: ${p.role} → ${sel.value}` });
            toast(`${p.displayName} is now ${ROLE_LABEL[sel.value as UserRole]}.`, 'success');
          } catch (e) { toast(errorMessage(e), 'error'); sel.value = p.role; }
        });
        return h('tr', null, h('td', null, p.displayName), h('td', null, p.email), h('td', null, sel, p.id === session.profile.id ? h('span', { style: 'font-size:12px;color:var(--muted);margin-left:8px' }, 'You') : null));
      })),
    )),
    dataMode === 'local' ? h('div', null, button('Add demo user', { small: true, icon: 'plus', onClick: async () => {
      const md = modal('Add demo user');
      const n = input(); const e = input({ type: 'email' }); const r = select(USER_ROLES.map((x) => ({ value: x, label: ROLE_LABEL[x] })), 'viewer');
      md.body.append(field('Name', n), field('Email', e), field('Role', r));
      md.footer.append(button('Add', { variant: 'primary', onClick: async () => {
        if (!n.value.trim() || !e.value.includes('@')) { toast('Enter a name and an email.', 'error'); return; }
        const p: Profile = { id: uid(), displayName: n.value.trim(), email: e.value.trim(), role: r.value as UserRole };
        await save('profiles', p, { action: 'create-user', details: p.email }); md.close(); await page.refresh();
      } }));
    } })) : null,
  ) : null;

  /* ---------- Permissions matrix ---------- */
  const permSec = canUsers ? (() => {
    const set = new Set(matrix.map((m) => m.id));
    const tbl = h('table', { class: 'table matrix-table', 'data-testid': 'permissions' },
      h('thead', null, h('tr', null, h('th', null, 'Permission'), USER_ROLES.map((r) => h('th', null, ROLE_LABEL[r])))),
      h('tbody', null, PERMISSIONS.map((p) => h('tr', null, h('td', null, p.label), USER_ROLES.map((r) => {
        const id = `${r}:${p.id}`;
        const locked = r === 'admin' && (p.id === 'manage_users' || p.id === 'manage_settings' || p.id === 'view');
        const box = h('input', { type: 'checkbox', class: 'checkbox', checked: set.has(id) || locked, disabled: locked, 'aria-label': `${ROLE_LABEL[r]}: ${p.label}` });
        box.addEventListener('change', () => { if (box.checked) set.add(id); else set.delete(id); });
        return h('td', null, box);
      })))),
    );
    const ok = button('Save permissions', { variant: 'primary' });
    ok.addEventListener('click', () => void withBusy(ok, async () => {
      const rows: RolePermission[] = [...set].map((id) => { const [role, permission] = id.split(':'); return { id, role: role as UserRole, permission: permission as RolePermission['permission'] }; });
      const drop = matrix.filter((m) => !set.has(m.id)).map((m) => m.id);
      await remove('role_permissions', drop);
      await save('role_permissions', rows, { action: 'update-permissions', details: `${rows.length} grants` });
      toast('Permissions saved.', 'success');
      await page.refresh();
    }));
    const reset = button('Restore defaults', { variant: 'ghost', onClick: async () => {
      if (!(await confirmDialog('Restore default permissions?', 'Every role gets its standard permissions back.', 'Restore'))) return;
      await remove('role_permissions', matrix.map((m) => m.id));
      await save('role_permissions', (Object.keys(DEFAULT_MATRIX) as UserRole[]).flatMap((role) => DEFAULT_MATRIX[role].map((permission) => ({ id: `${role}:${permission}`, role, permission }))), { action: 'reset-permissions' });
      await page.refresh();
    } });
    return section('permissions', 'Access permissions', 'What each role can do. Enforced in the app and, with Supabase, by row-level security in the database.',
      h('div', { class: 'panel' }, h('div', { class: 'table-wrap' }, tbl), h('div', { class: 'slots panel-body', style: 'border-top:1px solid var(--rule)' }, ok, reset)));
  })() : null;

  /* ---------- Data ---------- */
  const collections: CollectionName[] = ['ministries', 'role_definitions', 'volunteers', 'availability', 'services', 'assignments', 'songs', 'liturgy_templates', 'liturgy_versions', 'app_settings', 'role_permissions', 'profiles', 'audit_log'];
  const exportJson = async () => {
    const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), mode: dataMode };
    for (const c of collections) out[c] = await list(c);
    downloadBytes(new TextEncoder().encode(JSON.stringify(out, null, 2)), `eccm-backup-${todayISO()}.json`, 'application/json');
  };
  const importJson = () => {
    const f = h('input', { type: 'file', accept: 'application/json,.json' });
    f.addEventListener('change', async () => {
      const file = f.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text()) as Record<string, unknown[]>;
        const present = collections.filter((c) => Array.isArray(data[c]));
        if (!present.length) throw new Error('This file is not an ECCM backup.');
        if (!(await confirmDialog('Import this backup?', `Records in ${present.length} collections are added or replaced by ID. Nothing is deleted.`, 'Import'))) return;
        for (const c of present) await save(c, data[c] as never);
        toast('Backup imported.', 'success');
        await page.refresh();
      } catch (e) { toast(errorMessage(e), 'error'); }
    });
    f.click();
  };
  const dataSec = canSettings ? section('data', 'Data', dataMode === 'local' ? 'Demo data lives in this browser. Export a backup before clearing site data.' : 'Data is stored in Supabase. Backups are a convenience; use Supabase backups for recovery.',
    h('div', { class: 'panel panel-body slots' },
      button('Download backup (JSON)', { icon: 'download', onClick: () => void exportJson() }),
      button('Import backup', { icon: 'upload', onClick: importJson }),
      dataMode === 'local' ? button('Reset demo data', { variant: 'ghost', onClick: async () => {
        if (!(await confirmDialog('Reset all demo data?', 'Every change made in this browser is lost and the sample data is restored.', 'Reset', true))) return;
        resetLocalData(); location.reload();
      } }) : null,
    ),
  ) : null;

  main.replaceChildren(
    pageHeader('Settings', canSettings ? null : 'You can view settings. Changing them needs the administrator role.'),
    h('nav', { class: 'slots no-print', 'aria-label': 'Settings sections', style: 'margin-bottom:8px' },
      [['general', 'General'], ['specials', 'Special Sundays'], ['ministries', 'Ministries'], ['roles', 'Roles'], ['templates', 'Templates'], ['sheets', 'Google Sheets'], ...(canUsers ? [['users', 'Users'], ['permissions', 'Permissions']] : []), ...(canSettings ? [['data', 'Data']] : [])]
        .map(([id, label]) => h('a', { class: 'btn btn-ghost btn-sm', href: `#${id}` }, label))),
    ...[general, specials, ministriesSec, rolesSec, templatesSec, sheets, usersSec, permSec, dataSec].filter((x): x is HTMLElement => !!x),
  );
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

function saveBtn(fn: () => Promise<void>): HTMLButtonElement {
  const b = button('Save', { variant: 'primary' });
  b.addEventListener('click', () => void withBusy(b, async () => { try { await fn(); } catch (e) { toast(errorMessage(e), 'error'); } }));
  return b;
}

function cb(label: HTMLLabelElement): boolean {
  return (label.querySelector('input') as HTMLInputElement).checked;
}
