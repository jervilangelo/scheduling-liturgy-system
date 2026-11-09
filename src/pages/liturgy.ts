import { bootPage, type PageContext } from '../components/shared/boot';
import { h, param, setParam } from '../utils/dom';
import {
  button, confirmDialog, emptyState, errorMessage, field, iconButton, input, modal, notice, pageHeader, panel, panelWithActions,
  promptDialog, select, textarea, toast, withBusy,
} from '../components/shared/ui';
import { icon } from '../components/shared/icons';
import { ensureService, primaryMinistry, serviceOn, specialTags } from '../components/shared/service-helpers';
import { workflowBar } from '../components/shared/workflow-bar';
import { pickSong } from '../components/liturgy/song-picker';
import { list, save, loadSchedulingContext } from '../services/api/store';
import {
  BIBLE_BOOKS, diffLines, fromTemplate, isPlausibleScripture, ITEM_KINDS, itemLine, kindLabel, moveItem, newItem, totalMinutes,
} from '../modules/liturgy';
import { applySundayRules, checkLiturgy, CREED_NAMES, sundayInfo } from '../modules/sunday-rules';
import { isLocked } from '../modules/publishing';
import { hasBlockingConflicts, serviceConflicts } from '../modules/conflict-detection';
import { rulesFor } from '../modules/volunteer-scheduling/ministry-rules';
import { addDays, formatDateTime, formatLong, isValidISODate, nextSunday, todayISO, toMinutes } from '../utils/dates';
import { uid } from '../utils/id';
import type { CreedKind, LiturgyItem, LiturgyItemKind, LiturgyTemplate, LiturgyVersion, Service, Song } from '../types/domain';

let dirty = false;
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); } });

void bootPage({ id: 'liturgy', title: 'Liturgy planning', render: renderPage });

async function renderPage(page: PageContext): Promise<void> {
  const { main, settings, session } = page;
  const ctx = await loadSchedulingContext();
  const [songs, templates, allVersions] = await Promise.all([list('songs'), list('liturgy_templates'), list('liturgy_versions')]);
  const songById = new Map(songs.map((s) => [s.id, s]));

  const ministryParam = param('ministry');
  const ministry = ctx.ministries.find((m) => m.id === ministryParam) ?? primaryMinistry(ctx.ministries);
  const rawDate = param('date');
  const date = rawDate && isValidISODate(rawDate) ? rawDate : nextSunday(todayISO());
  setParam('date', date);

  let service = serviceOn(ctx.services, ministry.id, date);
  const info = sundayInfo(date, settings, service?.creedOverride ?? null);
  const rules = rulesFor(ministry);
  const readOnly = !session.can('edit_liturgy') || (service ? isLocked(service.status) : false);

  // Working copy
  let items: LiturgyItem[] = service ? service.liturgy.map((i) => ({ ...i })) : [];
  let sermon = service ? { ...service.sermon } : { title: '', preacher: '', scripture: '', series: '', notes: '' };
  let theme = service?.theme ?? '';
  let creedOverride: CreedKind | null = service?.creedOverride ?? null;
  dirty = false;

  // Songs planned on other dates (for repeat warnings)
  const planned = new Map<string, string>();
  for (const s of ctx.services) if (s.date !== date) for (const it of s.liturgy) if (it.songId && Math.abs(Date.parse(s.date) - Date.parse(date)) < 28 * 864e5) planned.set(it.songId, s.date);

  const volunteerNames = h('datalist', { id: 'volunteer-names' }, ctx.volunteers.filter((v) => v.active).map((v) => h('option', { value: v.name })));
  const books = h('datalist', { id: 'bible-books' }, BIBLE_BOOKS.map((b) => h('option', { value: `${b} ` })));

  const markDirty = () => { dirty = true; saveBtn.disabled = readOnly; dirtyNote.textContent = 'Unsaved changes'; };

  /* ---------- Builder ---------- */
  const orderList = h('ol', { class: 'order', 'aria-label': 'Order of worship', 'data-testid': 'order' });
  const issuesBox = h('div');
  const totalsEl = h('span', { class: 'num', style: 'color:var(--muted)' });

  const requiredKinds = new Set<LiturgyItemKind>(rules.specialSundays ? info.specials : []);

  const refreshMeta = () => {
    const mins = totalMinutes(items);
    const start = service?.startTime ?? ministry.defaultStart;
    const end = toMinutes(start) + mins;
    totalsEl.textContent = `${items.length} elements · ${mins} min · ends about ${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
    const issues = rules.specialSundays ? checkLiturgy(items, sundayInfo(date, settings, creedOverride), settings) : [];
    issuesBox.replaceChildren();
    if (issues.length) {
      issuesBox.append(notice(h('div', { class: 'stack', style: 'gap:6px' },
        ...issues.map((i) => h('p', null, i.message)),
        readOnly ? null : h('div', null, button('Add required elements', { small: true, onClick: () => { items = applySundayRules(items, sundayInfo(date, settings, creedOverride), settings, uid); markDirty(); drawItems(); } })),
      ), 'warning'));
    }
  };

  let dragFrom = -1;
  const drawItems = () => {
    orderList.replaceChildren();
    if (!items.length) {
      orderList.append(h('li', null, emptyState(readOnly ? 'No order of worship has been planned for this Sunday.' : 'No elements yet. Start from a template or add elements below.')));
    }
    items.forEach((it, idx) => orderList.append(itemRow(it, idx)));
    refreshMeta();
  };

  const itemRow = (it: LiturgyItem, idx: number): HTMLElement => {
    const kindSel = select(ITEM_KINDS.map((k) => ({ value: k.kind, label: k.label })), it.kind, { 'aria-label': `Element ${idx + 1} type`, disabled: readOnly });
    kindSel.addEventListener('change', () => { it.kind = kindSel.value as LiturgyItemKind; if (it.kind !== 'song') it.songId = null; if (!it.title) it.title = kindLabel(it.kind); markDirty(); drawItems(); });

    let titleCtl: HTMLElement;
    if (it.kind === 'song') {
      const song = it.songId ? songById.get(it.songId) : undefined;
      const chooser = h('button', { type: 'button', class: 'input song-choice', disabled: readOnly, 'aria-label': `Element ${idx + 1} song: ${song?.title ?? 'none chosen'}` },
        icon('songs'), h('span', { style: song ? '' : 'color:var(--muted)' }, song?.title ?? 'Choose a song'));
      chooser.addEventListener('click', async () => {
        const s = await pickSong(songs, date, planned);
        if (s) { it.songId = s.id; it.title = s.title; markDirty(); drawItems(); }
      });
      titleCtl = chooser;
    } else {
      const t = input({ value: it.title, 'aria-label': `Element ${idx + 1} title`, disabled: readOnly });
      t.addEventListener('input', () => { it.title = t.value; markDirty(); });
      t.addEventListener('change', refreshMeta);
      titleCtl = t;
    }
    const leader = input({ value: it.leader ?? '', placeholder: 'Leader', list: 'volunteer-names', 'aria-label': `Element ${idx + 1} leader`, disabled: readOnly });
    leader.addEventListener('input', () => { it.leader = leader.value; markDirty(); });
    const mins = input({ type: 'number', min: '0', max: '180', value: String(it.durationMin ?? 0), 'aria-label': `Element ${idx + 1} minutes`, class: 'input num', disabled: readOnly });
    mins.addEventListener('input', () => { it.durationMin = Math.max(0, Number(mins.value) || 0); markDirty(); refreshMeta(); });

    const showScripture = ['scripture', 'call_to_worship', 'sermon', 'prayer', 'confession', 'benediction', 'custom'].includes(it.kind);
    const scr = input({ value: it.scripture ?? '', placeholder: 'Scripture, e.g. John 3:16-21', list: 'bible-books', 'aria-label': `Element ${idx + 1} Scripture`, disabled: readOnly });
    const scrErr = h('p', { class: 'field-error', hidden: true }, 'Use a reference like "Psalm 23" or "John 3:16-21".');
    scr.addEventListener('input', () => { it.scripture = scr.value; markDirty(); });
    scr.addEventListener('blur', () => { const ok = isPlausibleScripture(scr.value); scr.setAttribute('aria-invalid', String(!ok)); scrErr.hidden = ok; });
    const notes = input({ value: it.notes ?? '', placeholder: 'Notes for the team', 'aria-label': `Element ${idx + 1} notes`, disabled: readOnly });
    notes.addEventListener('input', () => { it.notes = notes.value; markDirty(); });

    const move = (to: number) => { items = moveItem(items, idx, to); markDirty(); drawItems(); (orderList.children[to]?.querySelector(to < idx ? '[data-move="up"]' : '[data-move="down"]') as HTMLElement | null)?.focus(); };
    const up = iconButton('up', `Move element ${idx + 1} up`, () => move(idx - 1), readOnly || idx === 0); up.dataset.move = 'up';
    const down = iconButton('down', `Move element ${idx + 1} down`, () => move(idx + 1), readOnly || idx === items.length - 1); down.dataset.move = 'down';
    const del = iconButton('trash', `Remove element ${idx + 1}`, () => { items.splice(idx, 1); markDirty(); drawItems(); }, readOnly);

    const handle = h('span', { class: 'drag-handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip'));
    const li = h('li', { class: `order-item${requiredKinds.has(it.kind as never) ? ' is-required' : ''}`, draggable: readOnly ? undefined : 'true', 'data-kind': it.kind },
      handle,
      h('span', { class: 'order-num' }, String(idx + 1)),
      h('div', { class: 'stack', style: 'gap:8px;min-width:0' },
        h('div', { class: 'order-fields' }, kindSel, titleCtl, mins),
        h('div', { class: 'order-extra' }, leader, showScripture ? h('div', null, scr, scrErr) : notes, showScripture ? notes : h('span')),
      ),
      h('div', { class: 'order-tools' }, up, down, del),
    );
    if (!readOnly) {
      li.addEventListener('dragstart', (e) => { dragFrom = idx; li.classList.add('is-dragging'); e.dataTransfer?.setData('text/plain', String(idx)); });
      li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
      li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drop-before'); });
      li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
      li.addEventListener('drop', (e) => { e.preventDefault(); li.classList.remove('drop-before'); if (dragFrom >= 0 && dragFrom !== idx) { items = moveItem(items, dragFrom, idx); markDirty(); drawItems(); } dragFrom = -1; });
    }
    return li;
  };

  const addKind = select(ITEM_KINDS.map((k) => ({ value: k.kind, label: k.label })), 'song', { 'aria-label': 'Element to add', style: 'width:auto' });
  const addBar = readOnly ? null : h('div', { class: 'slots panel-body', style: 'border-top:1px solid var(--rule)' },
    addKind,
    button('Add element', { icon: 'plus', onClick: () => { items.push(newItem(addKind.value as LiturgyItemKind, uid)); markDirty(); drawItems(); orderList.lastElementChild?.querySelector<HTMLElement>('input,button')?.focus(); } }),
  );

  /* ---------- Save ---------- */
  const dirtyNote = h('span', { style: 'color:var(--muted);font-size:13px', 'aria-live': 'polite' });
  const saveBtn = button('Save draft', { variant: 'primary', disabled: true });
  saveBtn.dataset.testid = 'save-liturgy';
  const doSave = async (note = ''): Promise<void> => {
    const bad = items.find((i) => i.scripture && !isPlausibleScripture(i.scripture));
    if (bad) { toast(`Check the Scripture reference "${bad.scripture}".`, 'error'); return; }
    if (sermon.scripture && !isPlausibleScripture(sermon.scripture)) { toast(`Check the sermon Scripture "${sermon.scripture}".`, 'error'); return; }
    const svc = await ensureService(ctx.services, ministry, date);
    const version = svc.liturgyVersion + 1;
    const updated: Service = { ...svc, liturgy: items, sermon, theme, creedOverride, liturgyVersion: version, updatedAt: new Date().toISOString() };
    await save('services', updated, { action: 'save-liturgy', details: `${date} v${version}${note ? `: ${note}` : ''}` });
    const v: LiturgyVersion = { id: uid(), serviceId: svc.id, version, items, sermon, theme, note, savedBy: session.profile.email, savedAt: updated.updatedAt };
    await save('liturgy_versions', v);
    dirty = false;
    toast(`Saved version ${version}.`, 'success');
    await page.refresh();
  };
  saveBtn.addEventListener('click', () => void withBusy(saveBtn, async () => {
    try { await doSave(versionNote.value.trim()); } catch (e) { toast(errorMessage(e), 'error'); }
  }));
  const versionNote = input({ placeholder: 'What changed? (optional)', 'aria-label': 'Version note', style: 'width:min(280px,100%)', disabled: readOnly });

  /* ---------- Start panel when empty ---------- */
  const startFrom = (t: LiturgyTemplate | null) => {
    const base = t ? fromTemplate(t, uid) : [];
    items = rules.specialSundays ? applySundayRules(base, sundayInfo(date, settings, creedOverride), settings, uid) : base;
    markDirty();
    drawItems();
  };
  const starter = !readOnly && !items.length ? panel('Start this plan',
    h('div', { class: 'panel-body stack' },
      h('p', null, info.specials.length && rules.specialSundays ? 'Required elements for this Sunday are added for you.' : 'Choose a starting point.'),
      h('div', { class: 'slots' },
        ...templates.map((t) => button(t.name, { variant: t.id === settings.defaultTemplateId ? 'primary' : 'secondary', onClick: () => startFrom(t) })),
        button('Blank', { variant: 'ghost', onClick: () => startFrom(null) }),
      ),
    ),
  ) : null;

  /* ---------- Sermon ---------- */
  const sTitle = input({ value: sermon.title, disabled: readOnly });
  const sPreacher = input({ value: sermon.preacher, disabled: readOnly });
  const sScripture = input({ value: sermon.scripture, list: 'bible-books', disabled: readOnly });
  const sSeries = input({ value: sermon.series, disabled: readOnly });
  const sNotes = textarea({ disabled: readOnly, rows: '3' }, sermon.notes);
  const sTheme = input({ value: theme, disabled: readOnly });
  const bind = (el: HTMLInputElement | HTMLTextAreaElement, set: (v: string) => void) => el.addEventListener('input', () => { set(el.value); markDirty(); });
  bind(sTitle, (v) => (sermon.title = v));
  bind(sPreacher, (v) => (sermon.preacher = v));
  bind(sScripture, (v) => (sermon.scripture = v));
  bind(sSeries, (v) => (sermon.series = v));
  bind(sNotes, (v) => (sermon.notes = v));
  bind(sTheme, (v) => (theme = v));

  let creedCtl: HTMLElement | null = null;
  if (rules.specialSundays && info.isLast) {
    const sel = select([
      { value: '', label: `Follow the rotation (${CREED_NAMES[sundayInfo(date, settings).creed!]})` },
      { value: 'nicene', label: CREED_NAMES.nicene },
      { value: 'apostles', label: CREED_NAMES.apostles },
    ], creedOverride ?? '', { disabled: readOnly });
    sel.addEventListener('change', () => {
      creedOverride = (sel.value || null) as CreedKind | null;
      items = applySundayRules(items, sundayInfo(date, settings, creedOverride), settings, uid);
      markDirty();
      drawItems();
    });
    creedCtl = field('Creed this Sunday', sel, 'Last Sundays alternate monthly between the Nicene and Apostles’ Creeds.');
  }

  const sermonPanel = panel('Sermon and theme', h('div', { class: 'panel-body stack' },
    field('Theme', sTheme), field('Sermon title', sTitle), field('Preacher', sPreacher), field('Sermon Scripture', sScripture), field('Series', sSeries), field('Notes', sNotes), creedCtl,
  ));

  /* ---------- Templates ---------- */
  const templatesPanel = panel('Templates', h('div', { class: 'panel-body stack' },
    templates.length ? h('ul', { class: 'stack', style: 'list-style:none;margin:0;padding:0;gap:8px' }, templates.map((t) =>
      h('li', { class: 'slots', style: 'justify-content:space-between' },
        h('span', null, h('span', { style: 'font-weight:500' }, t.name), h('span', { style: 'color:var(--muted);font-size:12px;display:block' }, `${t.items.length} elements · ${totalMinutes(t.items)} min`)),
        readOnly ? null : button('Apply', { small: true, onClick: async () => {
          if (items.length && !(await confirmDialog('Replace the current order?', `The ${items.length} current elements are replaced by "${t.name}". Save afterwards to keep it.`, 'Replace'))) return;
          startFrom(t);
        } }),
      ),
    )) : h('p', { class: 'dash' }, 'No templates yet.'),
    session.can('manage_settings') && items.length ? button('Save current order as template', { variant: 'ghost', small: true, onClick: async () => {
      const name = await promptDialog('Save as template', 'Template name', '', 'Save template');
      if (!name?.trim()) return;
      const t: LiturgyTemplate = { id: uid(), name: name.trim(), description: `From ${formatLong(date)}`, items: items.map((i) => ({ ...i, songId: null, title: i.kind === 'song' ? '' : i.title, leader: '' })) };
      await save('liturgy_templates', t, { action: 'create-template', details: t.name });
      toast('Template saved.', 'success');
      await page.refresh();
    } }) : null,
  ));

  /* ---------- Versions ---------- */
  const versions = service ? allVersions.filter((v) => v.serviceId === service!.id).sort((a, b) => b.version - a.version) : [];
  const versionsPanel = panel('Version history', versions.length
    ? h('ul', { class: 'conflict-list', 'data-testid': 'versions' }, versions.slice(0, 10).map((v, i) =>
      h('li', null,
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { style: 'font-weight:500' }, `Version ${v.version}${i === 0 ? ' (current)' : ''}`),
          h('div', { style: 'font-size:12px;color:var(--muted)' }, `${formatDateTime(v.savedAt)} · ${v.savedBy}${v.note ? ` · ${v.note}` : ''}`),
        ),
        i > 0 ? button('Compare', { small: true, variant: 'ghost', onClick: () => compare(v, versions[0], songById) }) : null,
        i > 0 && !readOnly ? button('Restore', { small: true, variant: 'ghost', onClick: async () => {
          if (!(await confirmDialog(`Restore version ${v.version}?`, 'The builder is filled with that version. Save to make it the current version; nothing is lost.', 'Restore'))) return;
          items = v.items.map((x) => ({ ...x })); sermon = { ...v.sermon }; theme = v.theme; markDirty(); drawItems();
          sTitle.value = sermon.title; sPreacher.value = sermon.preacher; sScripture.value = sermon.scripture; sSeries.value = sermon.series; sNotes.value = sermon.notes; sTheme.value = theme;
        } }) : null,
      ),
    ))
    : emptyState('Saved versions appear here.'));

  /* ---------- Header ---------- */
  const dateInput = input({ type: 'date', value: date, 'aria-label': 'Service date', style: 'width:auto' });
  const go = async (d: string) => {
    if (dirty && !(await confirmDialog('Leave without saving?', 'Your unsaved changes to this Sunday will be lost.', 'Leave', true))) { dateInput.value = date; return; }
    dirty = false;
    setParam('date', d);
    await page.refresh();
  };
  dateInput.addEventListener('change', () => { if (isValidISODate(dateInput.value)) void go(dateInput.value); });

  const precheck = () => {
    const w: string[] = [];
    if (dirty) w.push('There are unsaved changes; they are not included until saved.');
    const issues = rules.specialSundays ? checkLiturgy(items, sundayInfo(date, settings, creedOverride), settings) : [];
    w.push(...issues.map((i) => i.message));
    const emptySongs = items.filter((i) => i.kind === 'song' && !i.songId).length;
    if (emptySongs) w.push(`${emptySongs} song ${emptySongs === 1 ? 'slot has' : 'slots have'} no song chosen.`);
    if (!items.length) w.push('The order of worship is empty.');
    if (service && hasBlockingConflicts(serviceConflicts(ctx, service.id))) w.push('The ministry team has blocking conflicts (see Scheduling).');
    return w;
  };

  main.replaceChildren(
    volunteerNames, books,
    pageHeader('Liturgy planning', null, [
      iconButton('left', 'Previous Sunday', () => void go(addDays(nextSunday(date), -7))),
      dateInput,
      iconButton('right', 'Next Sunday', () => void go(nextSunday(date, false))),
      h('a', { class: 'btn btn-secondary', href: `scheduling.html?date=${date}` }, 'Ministry team'),
    ]),
    h('div', { class: 'stack' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' },
        h('div', { class: 'stack', style: 'gap:4px' },
          h('h2', { class: 'panel-title', 'data-testid': 'service-date' }, `${formatLong(date)} · ${ministry.name}`),
          specialTags(date, settings, ministry, creedOverride),
        ),
        workflowBar(service, session, () => { dirty = false; void page.refresh(); }, precheck, async () => {
          if (!dirty) return true;
          toast('Save your changes first.', 'error');
          return false;
        }),
      )),
      readOnly && service && isLocked(service.status) ? notice('This service is published and read-only. Unpublish it to make changes.', 'info') : null,
      readOnly && !session.can('edit_liturgy') ? notice('You can view this plan. Editing needs the planner role.', 'info') : null,
      issuesBox,
      starter,
      h('div', { class: 'grid grid-gap xl:grid-cols-[minmax(0,1fr)_340px] items-start' },
        panelWithActions('Order of worship', [totalsEl], orderList, addBar,
          readOnly ? null : h('div', { class: 'slots panel-body', style: 'border-top:1px solid var(--rule);justify-content:flex-end' }, dirtyNote, versionNote, saveBtn),
        ),
        h('div', { class: 'stack' }, sermonPanel, templatesPanel, versionsPanel),
      ),
    ),
  );
  drawItems();
}

function compare(older: LiturgyVersion, current: LiturgyVersion, songs: Map<string, Song>) {
  const m = modal(`Version ${older.version} compared with version ${current.version}`, { wide: true });
  const a = older.items.map((i) => itemLine(i, songs));
  const b = current.items.map((i) => itemLine(i, songs));
  if (older.sermon.title !== current.sermon.title) { a.push(`Sermon title: ${older.sermon.title}`); b.push(`Sermon title: ${current.sermon.title}`); }
  m.body.append(
    h('p', { style: 'color:var(--muted)' }, 'Removed lines are struck through; added lines are highlighted.'),
    h('ul', { class: 'diff' }, diffLines(a, b).map((d) => h('li', { class: `d-${d.type}` }, `${d.type === 'added' ? '+ ' : d.type === 'removed' ? '− ' : '  '}${d.text}`))),
  );
}
