import { bootPage, type PageContext } from '../components/shared/boot';
import { append, copyText, h, param, setParam } from '../utils/dom';
import {
  button, confirmDialog, emptyState, errorMessage, field, iconButton, input, modal, notice, pageHeader, panel, promptDialog, select, toast, withBusy,
} from '../components/shared/ui';
import { icon } from '../components/shared/icons';
import { ensureService, primaryMinistry, serviceOn, specialTags } from '../components/shared/service-helpers';
import { workflowBar } from '../components/shared/workflow-bar';
import { list, loadSchedulingContext, save } from '../services/api/store';
import {
  BIBLE_BOOKS, diffLines, formatLine, fromTemplate, inferKind, isBullet, itemDetail, liturgyToText, matchSong, monthDay, moveItem,
  normalizeItems, parseLiturgyText,
} from '../modules/liturgy';
import { applySundayRules, checkLiturgy, CREED_NAMES, sundayInfo } from '../modules/sunday-rules';
import { isLocked } from '../modules/publishing';
import { hasBlockingConflicts, serviceConflicts } from '../modules/conflict-detection';
import { rulesFor } from '../modules/volunteer-scheduling/ministry-rules';
import { addDays, daysBetween, formatDateTime, formatLong, formatShort, isValidISODate, nextSunday, todayISO } from '../utils/dates';
import { uid } from '../utils/id';
import type { CreedKind, LiturgyItem, LiturgyItemKind, LiturgyTemplate, LiturgyVersion, Service, Song } from '../types/domain';

let dirty = false;
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

void bootPage({ id: 'liturgy', title: 'Liturgy planning', render: renderPage });

const PASSAGE_KINDS: LiturgyItemKind[] = ['call_to_worship', 'scripture', 'sermon'];

async function renderPage(page: PageContext): Promise<void> {
  const { main, settings, session } = page;
  const ctx = await loadSchedulingContext();
  const [songs, templates, allVersions] = await Promise.all([list('songs'), list('liturgy_templates'), list('liturgy_versions')]);
  const songById = new Map(songs.map((s) => [s.id, s]));

  const ministry = ctx.ministries.find((m) => m.id === param('ministry')) ?? primaryMinistry(ctx.ministries);
  const rawDate = param('date');
  const date = rawDate && isValidISODate(rawDate) ? rawDate : nextSunday(todayISO());
  setParam('date', date);

  const service = serviceOn(ctx.services, ministry.id, date);
  const rules = rulesFor(ministry);
  const readOnly = !session.can('edit_liturgy') || (service ? isLocked(service.status) : false);

  // Working copy
  let items: LiturgyItem[] = normalizeItems(service ? service.liturgy.map((i) => ({ ...i })) : [], songById);
  let sermon = service ? { ...service.sermon } : { title: '', preacher: '', scripture: '', series: '', notes: '' };
  let theme = service?.theme ?? '';
  let creedOverride: CreedKind | null = service?.creedOverride ?? null;
  let mode: 'list' | 'text' = 'list';
  dirty = false;

  // Team lines, as at the foot of the church's plan
  const roles = ctx.roles.filter((r) => r.ministryId === ministry.id && r.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const volName = new Map(ctx.volunteers.map((v) => [v.id, v.name]));
  const team = roles.map((r) => ({
    role: r.name,
    names: service ? ctx.assignments.filter((a) => a.serviceId === service.id && a.roleId === r.id).map((a) => volName.get(a.volunteerId) ?? '') .filter(Boolean) : [],
  }));
  const roleNames = [...ctx.roles.map((r) => r.name), 'Service Leader', 'Scripture Reader', 'Music'];

  // Songs planned on nearby Sundays, for repeat hints
  const plannedNear = new Map<string, string>();
  for (const s of ctx.services) {
    if (s.date === date || Math.abs(daysBetween(s.date, date)) > 28) continue;
    for (const it of s.liturgy) if (it.songId) plannedNear.set(it.songId, s.date);
  }

  const info = () => sundayInfo(date, settings, creedOverride);
  const required = () => new Set<LiturgyItemKind>(rules.specialSundays ? info().specials : []);

  /* ---------- Dirty state and save ---------- */
  const dirtyNote = h('span', { class: 'save-note', 'aria-live': 'polite' }, service?.liturgyVersion ? `Saved · version ${service.liturgyVersion}` : 'Not saved yet');
  const saveBtn = button('Save', { variant: 'primary', disabled: true });
  saveBtn.dataset.testid = 'save-liturgy';
  const markDirty = () => { dirty = true; saveBtn.disabled = readOnly; dirtyNote.textContent = 'Unsaved changes'; refreshIssues(); };

  /* ---------- Required-element notice ---------- */
  const issuesBox = h('div');
  const refreshIssues = () => {
    const issues = rules.specialSundays ? checkLiturgy(items, info(), settings) : [];
    issuesBox.replaceChildren();
    if (!issues.length || !items.length) return;
    issuesBox.append(notice(h('div', { class: 'slots', style: 'justify-content:space-between;width:100%' },
      h('div', null, ...issues.map((i) => h('p', null, i.message))),
      readOnly ? null : button('Add it', { small: true, onClick: () => { items = applySundayRules(items, info(), settings, uid); markDirty(); draw(); } }),
    ), 'warning'));
  };

  /* ---------- The document ---------- */
  const docBody = h('div', { class: 'doc' });
  const lines = h('ol', { class: 'doc-lines', 'aria-label': 'Order of worship', 'data-testid': 'order' });

  const songHint = (it: LiturgyItem): HTMLElement | null => {
    if (it.kind !== 'song') return null;
    const detail = (it.detail ?? '').trim();
    if (!detail) return null;
    const song = it.songId ? songById.get(it.songId) : undefined;
    if (!song) return h('span', { class: 'line-meta' }, 'Not in song library');
    const near = plannedNear.get(song.id);
    if (near) return h('span', { class: 'line-meta is-warn' }, `Also planned ${formatShort(near)}`);
    if (song.lastSung) {
      const gap = daysBetween(song.lastSung, date);
      if (gap >= 0 && gap < 28) return h('span', { class: 'line-meta is-warn' }, `Sung ${Math.max(1, Math.round(gap / 7))} wk ago`);
      return h('span', { class: 'line-meta' }, `Last sung ${formatShort(song.lastSung)}`);
    }
    return h('span', { class: 'line-meta' }, 'Not sung yet');
  };

  // Size a label input to its text so the colon sits right after it, as on paper.
  const measure = document.createElement('canvas').getContext('2d');
  const sizeTo = (el: HTMLInputElement) => {
    if (!measure) { el.size = Math.max(4, el.value.length || el.placeholder.length); return; }
    measure.font = getComputedStyle(el).font || '15px Geist, sans-serif';
    el.style.width = `${Math.ceil(measure.measureText(el.value || el.placeholder).width) + 8}px`;
  };
  void document.fonts?.ready.then(() => lines.querySelectorAll<HTMLInputElement>('input.line-label').forEach(sizeTo));

  const focusLine = (idx: number, where: 'start' | 'end' = 'start') => {
    const row = lines.children[idx] as HTMLElement | undefined;
    const inputs = row ? [...row.querySelectorAll<HTMLInputElement>('input.line-input')] : [];
    const el = where === 'start' ? inputs[0] : inputs[inputs.length - 1];
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  };

  const insertAfter = (idx: number, bullet: boolean) => {
    items.splice(idx + 1, 0, { id: uid(), kind: bullet ? 'song' : 'custom', title: '', detail: '' });
    markDirty();
    drawLines();
    focusLine(idx + 1);
  };

  const row = (it: LiturgyItem, idx: number): HTMLElement => {
    const bullet = isBullet(it);
    const req = required().has(it.kind);
    const li = h('li', {
      class: `doc-line${bullet ? ' is-bullet' : ''}${(it.detail ?? '').trim() ? ' has-detail' : ''}`,
      'data-kind': it.kind,
      draggable: 'true',
    });

    let labelEl: HTMLInputElement | null = null;
    if (!bullet) {
      labelEl = h('input', { class: 'line-input line-label', value: it.title, placeholder: 'Element', 'aria-label': `Line ${idx + 1}` });
      sizeTo(labelEl);
      labelEl.addEventListener('input', () => {
        it.title = labelEl!.value;
        it.kind = inferKind(it.title, false);
        it.songId = it.kind === 'song' ? matchSong(it.detail ?? '', songs)?.id ?? null : null;
        sizeTo(labelEl!);
        detailEl.placeholder = placeholderFor(it.kind);
        markDirty();
      });
    }
    const isSongish = it.kind === 'song';
    const detailEl = h('input', {
      class: 'line-input line-detail',
      value: it.detail ?? '',
      placeholder: placeholderFor(it.kind),
      list: isSongish ? 'song-titles' : PASSAGE_KINDS.includes(it.kind) ? 'bible-books' : undefined,
      'aria-label': bullet ? `Line ${idx + 1} song` : `Line ${idx + 1} ${it.title || 'detail'}`,
    });
    const meta = h('span', { class: 'line-meta-wrap' }, req ? h('span', { class: 'pill pill-info' }, 'Required today') : null, songHint(it));
    detailEl.addEventListener('input', () => {
      it.detail = detailEl.value;
      if (it.kind === 'song') it.songId = matchSong(detailEl.value, songs)?.id ?? null;
      li.classList.toggle('has-detail', !!detailEl.value.trim());
      meta.replaceChildren(...[req ? h('span', { class: 'pill pill-info' }, 'Required today') : null, songHint(it)].filter((x): x is HTMLElement => !!x));
      markDirty();
    });

    const onKey = (e: KeyboardEvent) => {
      const empty = !(labelEl?.value ?? '').trim() && !detailEl.value.trim();
      if (e.key === 'Enter') { e.preventDefault(); insertAfter(idx, bullet); }
      else if (e.key === 'Backspace' && empty && items.length > 1) { e.preventDefault(); items.splice(idx, 1); markDirty(); drawLines(); focusLine(Math.max(0, idx - 1), 'end'); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const to = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
        if (to < 0 || to >= items.length) return;
        items = moveItem(items, idx, to); markDirty(); drawLines(); focusLine(to);
      }
    };
    labelEl?.addEventListener('keydown', onKey);
    detailEl.addEventListener('keydown', onKey);

    const move = (to: number) => { items = moveItem(items, idx, to); markDirty(); drawLines(); };
    append(li, [
      h('span', { class: 'line-handle', 'aria-hidden': 'true', title: 'Drag to reorder' }, icon('grip')),
      bullet ? h('span', { class: 'line-bullet', 'aria-hidden': 'true' }, '–') : null,
      labelEl,
      bullet ? null : h('span', { class: 'line-sep', 'aria-hidden': 'true' }, ':'),
      detailEl,
      meta,
      h('span', { class: 'line-tools' },
        iconButton('up', `Move line ${idx + 1} up`, () => move(idx - 1), idx === 0),
        iconButton('down', `Move line ${idx + 1} down`, () => move(idx + 1), idx === items.length - 1),
        iconButton('trash', `Remove line ${idx + 1}`, () => { items.splice(idx, 1); markDirty(); drawLines(); }),
      ),
    ]);

    li.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/plain', String(idx)); li.classList.add('is-dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('drop-before'); });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drop-before');
      const from = Number(e.dataTransfer?.getData('text/plain'));
      if (Number.isInteger(from) && from !== idx) { items = moveItem(items, from, idx); markDirty(); drawLines(); }
    });
    return li;
  };

  const drawLines = () => {
    lines.replaceChildren(...items.map(row));
    // Inputs must be in the document before their font can be measured.
    requestAnimationFrame(() => lines.querySelectorAll<HTMLInputElement>('input.line-label').forEach(sizeTo));
    refreshIssues();
  };

  const staticDoc = () => h('div', null,
    h('ul', { class: 'doc-static', 'data-testid': 'order' }, items.map((it) =>
      h('li', { class: isBullet(it) ? 'is-bullet' : '' }, isBullet(it) ? `– ${itemDetail(it, songById)}` : formatLine(it, songById)),
    )),
  );

  const teamBlock = () => h('div', { class: 'doc-team', 'data-testid': 'team-lines' },
    team.map((t) => h('p', null, h('span', { class: 'doc-team-role' }, `${t.role}:`), ' ', t.names.length ? t.names.join(', ') : h('span', { class: 'dash' }, '—'))),
    h('a', { class: 'btn btn-ghost btn-sm no-print', href: `scheduling.html?date=${date}`, style: 'margin-left:-10px' }, 'Edit team'),
  );

  const textArea = h('textarea', { class: 'doc-text', 'aria-label': 'Order of worship as text', spellcheck: 'false' });
  const textNote = h('p', { class: 'field-help' });
  textArea.addEventListener('input', () => {
    const r = parseLiturgyText(textArea.value, songs, roleNames, uid);
    items = r.items;
    textNote.textContent = r.skipped.length ? `Team lines (${r.skipped.map((s) => s.split(':')[0]).join(', ')}) are set in the Team section, not here.` : '';
    markDirty();
  });

  const draw = () => {
    if (readOnly) {
      docBody.replaceChildren(h('h2', { class: 'doc-date' }, monthDay(date)), items.length ? staticDoc() : emptyState('No order of worship has been planned for this Sunday.'), teamBlock());
      return;
    }
    if (!items.length && mode === 'list') {
      docBody.replaceChildren(h('h2', { class: 'doc-date' }, monthDay(date)), starter(), teamBlock());
      return;
    }
    if (mode === 'text') {
      textArea.value = [monthDay(date), ...items.map((i) => formatLine(i, songById))].join('\n');
      docBody.replaceChildren(
        h('p', { class: 'field-help', style: 'margin-bottom:8px' }, 'One element per line. Start a song with a dash. Write “Label: detail”, for example “Call to Worship: Psalm 89:5”.'),
        textArea, textNote,
      );
      textArea.focus();
      return;
    }
    drawLines();
    docBody.replaceChildren(
      h('h2', { class: 'doc-date' }, monthDay(date)),
      lines,
      h('div', { class: 'doc-add no-print' },
        button('Song', { icon: 'plus', small: true, variant: 'ghost', onClick: () => insertAfter(items.length - 1, true) }),
        button('Line', { icon: 'plus', small: true, variant: 'ghost', onClick: () => insertAfter(items.length - 1, false) }),
        h('span', { class: 'field-help' }, 'Enter adds a line below · Alt+↑↓ moves it'),
      ),
      teamBlock(),
    );
  };

  /* ---------- Starting a plan ---------- */
  const startFrom = (t: LiturgyTemplate | null) => {
    const base = t ? normalizeItems(fromTemplate(t, uid), songById) : [];
    items = rules.specialSundays ? applySundayRules(base, info(), settings, uid) : base;
    if (!items.length) items = [{ id: uid(), kind: 'custom', title: '', detail: '' }];
    markDirty();
    draw();
    focusLine(0);
  };
  const starter = () => h('div', { class: 'stack', style: 'padding:8px 0 16px 30px' },
    h('p', null, 'Start this Sunday’s order of worship.'),
    h('div', { class: 'slots' },
      ...templates.map((t) => button(`Use “${t.name}”`, { variant: t.id === settings.defaultTemplateId ? 'primary' : 'secondary', onClick: () => startFrom(t) })),
      button('Type or paste it', { variant: 'secondary', onClick: () => { mode = 'text'; setModeButtons(); items = []; draw(); } }),
      button('Blank', { variant: 'ghost', onClick: () => startFrom(null) }),
    ),
  );

  /* ---------- Mode switch and copy ---------- */
  const listBtn = h('button', { type: 'button', onclick: () => { mode = 'list'; setModeButtons(); draw(); } }, 'List');
  const textBtn = h('button', { type: 'button', onclick: () => { mode = 'text'; setModeButtons(); draw(); } }, 'Text');
  const setModeButtons = () => { listBtn.setAttribute('aria-pressed', String(mode === 'list')); textBtn.setAttribute('aria-pressed', String(mode === 'text')); };
  setModeButtons();
  const copyBtn = button('Copy', { icon: 'copy', small: true, variant: 'ghost', onClick: async () => {
    const ok = await copyText(liturgyToText(date, items, songById, team));
    toast(ok ? 'Copied in your church’s format.' : 'Copy failed.');
  } });

  /* ---------- Save ---------- */
  const versionNote = input({ placeholder: 'What changed? (optional)', 'aria-label': 'Version note', class: 'input', style: 'width:min(260px,100%)' });
  const doSave = async () => {
    const cleaned = items.filter((i) => i.title.trim() || (i.detail ?? '').trim());
    const sermonLine = cleaned.find((i) => i.kind === 'sermon');
    const svc = await ensureService(ctx.services, ministry, date);
    const version = svc.liturgyVersion + 1;
    const sermonOut = { ...sermon, scripture: sermonLine?.detail?.trim() || sermon.scripture };
    const updated: Service = { ...svc, liturgy: cleaned, sermon: sermonOut, theme, creedOverride, liturgyVersion: version, updatedAt: new Date().toISOString() };
    await save('services', updated, { action: 'save-liturgy', details: `${date} v${version}${versionNote.value.trim() ? `: ${versionNote.value.trim()}` : ''}` });
    const v: LiturgyVersion = { id: uid(), serviceId: svc.id, version, items: cleaned, sermon: sermonOut, theme, note: versionNote.value.trim(), savedBy: session.profile.email, savedAt: updated.updatedAt };
    await save('liturgy_versions', v);
    dirty = false;
    toast(`Saved version ${version}.`, 'success');
    await page.refresh();
  };
  saveBtn.addEventListener('click', () => void withBusy(saveBtn, async () => { try { await doSave(); } catch (e) { toast(errorMessage(e), 'error'); } }));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !readOnly) { e.preventDefault(); if (!saveBtn.disabled) saveBtn.click(); }
  });

  /* ---------- Side panels ---------- */
  const sTitle = input({ value: sermon.title, disabled: readOnly });
  const sPreacher = input({ value: sermon.preacher, disabled: readOnly });
  const sTheme = input({ value: theme, disabled: readOnly });
  sTitle.addEventListener('input', () => { sermon.title = sTitle.value; markDirty(); });
  sPreacher.addEventListener('input', () => { sermon.preacher = sPreacher.value; markDirty(); });
  sTheme.addEventListener('input', () => { theme = sTheme.value; markDirty(); });

  let creedCtl: HTMLElement | null = null;
  if (rules.specialSundays && info().isLast) {
    const sel = select([
      { value: '', label: `This month’s: ${CREED_NAMES[sundayInfo(date, settings).creed!]}` },
      { value: 'nicene', label: CREED_NAMES.nicene },
      { value: 'apostles', label: CREED_NAMES.apostles },
    ], creedOverride ?? '', { disabled: readOnly });
    sel.addEventListener('change', () => {
      creedOverride = (sel.value || null) as CreedKind | null;
      items = applySundayRules(items, info(), settings, uid);
      markDirty();
      draw();
    });
    creedCtl = field('Creed', sel);
  }
  const sermonPanel = panel('Sermon', h('div', { class: 'panel-body stack' }, field('Title', sTitle), field('Preacher', sPreacher), field('Theme', sTheme), creedCtl));

  const templatesPanel = panel('Templates', h('div', { class: 'panel-body stack', style: 'gap:10px' },
    ...templates.map((t) => h('div', { class: 'slots', style: 'justify-content:space-between' },
      h('span', null, t.name, h('span', { style: 'color:var(--muted);font-size:12px;margin-left:6px' }, `${t.items.length} lines`)),
      readOnly ? null : button('Use', { small: true, variant: 'ghost', onClick: async () => {
        if (items.length && !(await confirmDialog('Replace this order of worship?', `The current ${items.length} lines are replaced by “${t.name}”. Nothing is saved until you press Save.`, 'Replace'))) return;
        mode = 'list'; setModeButtons(); startFrom(t);
      } }),
    )),
    session.can('manage_settings') && items.length ? button('Save this order as a template', { variant: 'ghost', small: true, onClick: async () => {
      const name = await promptDialog('Save as template', 'Template name', '', 'Save template');
      if (!name?.trim()) return;
      const t: LiturgyTemplate = { id: uid(), name: name.trim(), description: `From ${formatLong(date)}`, items: items.map((i) => ({ ...i, id: uid(), detail: '', songId: null })) };
      await save('liturgy_templates', t, { action: 'create-template', details: t.name });
      toast('Template saved.', 'success');
      await page.refresh();
    } }) : null,
  ));

  const versions = service ? allVersions.filter((v) => v.serviceId === service.id).sort((a, b) => b.version - a.version) : [];
  const versionsPanel = panel('Earlier versions', versions.length
    ? h('ul', { class: 'conflict-list', 'data-testid': 'versions' }, versions.slice(0, 8).map((v, i) =>
      h('li', null,
        h('div', { style: 'flex:1;min-width:0' },
          h('div', null, `Version ${v.version}${i === 0 ? ' (current)' : ''}`),
          h('div', { style: 'font-size:12px;color:var(--muted)' }, `${formatDateTime(v.savedAt)}${v.note ? ` · ${v.note}` : ''}`),
        ),
        i > 0 ? button('Compare', { small: true, variant: 'ghost', onClick: () => compare(v, versions[0], songById) }) : null,
        i > 0 && !readOnly ? button('Restore', { small: true, variant: 'ghost', onClick: async () => {
          if (!(await confirmDialog(`Restore version ${v.version}?`, 'Its lines replace the current ones. Press Save to keep them; nothing is lost.', 'Restore'))) return;
          items = normalizeItems(v.items.map((x) => ({ ...x })), songById); sermon = { ...v.sermon }; theme = v.theme;
          sTitle.value = sermon.title; sPreacher.value = sermon.preacher; sTheme.value = theme;
          mode = 'list'; setModeButtons(); markDirty(); draw();
        } }) : null,
      ),
    ))
    : emptyState('Each save keeps a version here.'));

  /* ---------- Header ---------- */
  const dateInput = input({ type: 'date', value: date, 'aria-label': 'Sunday', style: 'width:auto' });
  const go = async (d: string) => {
    if (dirty && !(await confirmDialog('Leave without saving?', 'Your unsaved changes to this Sunday will be lost.', 'Leave', true))) { dateInput.value = date; return; }
    dirty = false;
    setParam('date', d);
    await page.refresh();
  };
  dateInput.addEventListener('change', () => { if (isValidISODate(dateInput.value)) void go(dateInput.value); });

  const precheck = () => {
    const w: string[] = [];
    if (dirty) w.push('There are unsaved changes; save first so they are included.');
    if (rules.specialSundays) w.push(...checkLiturgy(items, info(), settings).map((i) => i.message));
    const emptySongs = items.filter((i) => i.kind === 'song' && !(i.detail ?? '').trim()).length;
    if (emptySongs) w.push(`${emptySongs} song ${emptySongs === 1 ? 'line has' : 'lines have'} no song yet.`);
    if (!items.length) w.push('The order of worship is empty.');
    if (service && hasBlockingConflicts(serviceConflicts(ctx, service.id))) w.push('The team has scheduling conflicts (see Scheduling).');
    return w;
  };

  main.replaceChildren(
    h('datalist', { id: 'song-titles' }, songs.map((s) => h('option', { value: s.title }, s.themes.join(', ')))),
    h('datalist', { id: 'bible-books' }, BIBLE_BOOKS.map((b) => h('option', { value: `${b} ` }))),
    pageHeader('Liturgy planning', null, [
      iconButton('left', 'Previous Sunday', () => void go(addDays(nextSunday(date), -7))),
      dateInput,
      iconButton('right', 'Next Sunday', () => void go(nextSunday(date, false))),
    ]),
    h('div', { class: 'stack' },
      h('div', { class: 'svc-bar' },
        h('div', { class: 'slots' },
          h('span', { 'data-testid': 'service-date', style: 'font-weight:500' }, `${formatLong(date)} · ${ministry.name}`),
          specialTags(date, settings, ministry, creedOverride),
        ),
        workflowBar(service, session, () => { dirty = false; void page.refresh(); }, precheck, async () => {
          if (!dirty) return true;
          toast('Save your changes first.', 'error');
          return false;
        }),
      ),
      service && isLocked(service.status) ? notice('Published and read-only. Unpublish it to make changes.', 'info') : null,
      !session.can('edit_liturgy') ? notice('You can view this plan. Editing needs the planner role.', 'info') : null,
      issuesBox,
      h('div', { class: 'grid grid-gap xl:grid-cols-[minmax(0,1fr)_320px] items-start' },
        h('section', { class: 'panel', 'aria-label': 'Order of worship' },
          h('div', { class: 'panel-head' },
            h('h2', { class: 'panel-title' }, 'Order of worship'),
            h('div', { class: 'panel-actions' },
              readOnly ? null : h('div', { class: 'segmented', role: 'group', 'aria-label': 'Edit as' }, listBtn, textBtn),
              copyBtn,
            ),
          ),
          docBody,
          readOnly ? null : h('div', { class: 'doc-foot no-print' }, dirtyNote, versionNote, saveBtn),
        ),
        h('div', { class: 'stack' }, sermonPanel, templatesPanel, versionsPanel),
      ),
    ),
  );
  draw();
}

function placeholderFor(kind: LiturgyItemKind): string {
  if (kind === 'song') return 'Song title';
  if (PASSAGE_KINDS.includes(kind)) return 'Passage, e.g. Romans 5';
  return 'Add detail';
}

function compare(older: LiturgyVersion, current: LiturgyVersion, songs: Map<string, Song>) {
  const m = modal(`Version ${older.version} compared with version ${current.version}`, { wide: true });
  const a = normalizeItems(older.items, songs).map((i) => formatLine(i, songs));
  const b = normalizeItems(current.items, songs).map((i) => formatLine(i, songs));
  m.body.append(
    h('p', { style: 'color:var(--muted)' }, 'Removed lines are struck through; added lines are highlighted.'),
    h('ul', { class: 'diff' }, diffLines(a, b).map((d) => h('li', { class: `d-${d.type}` }, d.text))),
  );
}
