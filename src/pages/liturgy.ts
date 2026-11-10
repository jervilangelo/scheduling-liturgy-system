import { bootPage, type PageContext } from '../components/shared/boot';
import { append, copyText, debounce, h, param, setParam } from '../utils/dom';
import {
  button, confirmDialog, emptyState, errorMessage, field, iconButton, input, modal, notice, pageHeader, panel, select, toast, withBusy,
} from '../components/shared/ui';
import { icon } from '../components/shared/icons';
import {
  BIBLE_BOOKS, DEFAULT_TEAM_ROLES, defaultTemplateItems, diffLines, formatLine, inferKind, isBullet, liturgyToText, matchSong,
  monthDay, moveItem, normalizeItems, parseLiturgyText,
} from '../modules/liturgy';
import { applySundayRules, checkLiturgy, CREED_ANCHOR, CREED_NAMES, describeSunday, sundayInfo } from '../modules/sunday-rules';
import { allThemes, searchSongs } from '../modules/song-library';
import { blankPlan, listPlans, savePlan, versionsOf } from '../services/plans';
import { cachedSongList, fetchSongList, isStale, SPREADSHEET_URL, type SongList } from '../services/songlist';
import { addDays, daysBetween, formatDateTime, formatLong, formatShort, isValidISODate, nextSunday, todayISO } from '../utils/dates';
import { uid } from '../utils/id';
import type { CreedKind, LiturgyItem, LiturgyItemKind, PlanVersion, Song, TeamLine } from '../types/domain';

let dirty = false;
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

/** The SongList is shared by every render of the page; refreshed from the spreadsheet when stale. */
let songList: SongList = cachedSongList();
let songListError = '';
let refreshing: Promise<void> | null = null;

const PASSAGE_KINDS: LiturgyItemKind[] = ['call_to_worship', 'scripture', 'sermon'];

async function renderPage(page: PageContext): Promise<void> {
  const { main } = page;
  const songs = songList.songs;
  const songById = new Map(songs.map((s) => [s.id, s]));
  const plans = listPlans();

  const rawDate = param('date');
  const date = rawDate && isValidISODate(rawDate) ? rawDate : nextSunday(todayISO());
  setParam('date', date);

  const plan = plans.find((p) => p.date === date) ?? blankPlan(date);

  // Working copy
  let items: LiturgyItem[] = normalizeItems(plan.liturgy.map((i) => ({ ...i })), songById);
  const sermon = { ...plan.sermon };
  let theme = plan.theme;
  let team: TeamLine[] = plan.team.map((t) => ({ ...t }));
  let creedOverride: CreedKind | null = plan.creedOverride;
  let mode: 'list' | 'text' = 'list';
  let lastFocus = -1;
  dirty = false;

  // Songs planned on nearby Sundays, for repeat hints
  const plannedNear = new Map<string, string>();
  for (const p of plans) {
    if (p.date === date || Math.abs(daysBetween(p.date, date)) > 28) continue;
    for (const it of p.liturgy) if (it.songId) plannedNear.set(it.songId, p.date);
  }

  const info = () => sundayInfo(date, CREED_ANCHOR, creedOverride);

  /* ---------- Dirty state ---------- */
  const dirtyNote = h('span', { class: 'save-note', 'aria-live': 'polite' }, plan.version ? `Saved · version ${plan.version}` : 'Not saved yet');
  const saveBtn = button('Save', { variant: 'primary', disabled: true });
  saveBtn.dataset.testid = 'save-liturgy';
  const markDirty = () => { dirty = true; saveBtn.disabled = false; dirtyNote.textContent = 'Unsaved changes'; refreshIssues(); };

  /* ---------- Special-Sunday notice ---------- */
  const issuesBox = h('div');
  const refreshIssues = () => {
    const issues = checkLiturgy(items, info());
    issuesBox.replaceChildren();
    if (!issues.length || !items.length) return;
    issuesBox.append(notice(h('div', { class: 'slots', style: 'justify-content:space-between;width:100%' },
      h('div', null, ...issues.map((i) => h('p', null, i.message))),
      button('Add it', { small: true, onClick: () => { items = applySundayRules(items, info(), uid); markDirty(); draw(); } }),
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
    if (!song) return h('span', { class: 'line-meta' }, 'Not in the SongList');
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
  const sizeAll = () => docBody.querySelectorAll<HTMLInputElement>('input.line-label').forEach(sizeTo);
  void document.fonts?.ready.then(sizeAll);

  const focusLine = (idx: number, where: 'start' | 'end' = 'start') => {
    const row = lines.children[idx] as HTMLElement | undefined;
    const inputs = row ? [...row.querySelectorAll<HTMLInputElement>('input.line-input')] : [];
    const el = where === 'start' ? inputs[0] : inputs[inputs.length - 1];
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  };

  const insertAfter = (idx: number, bullet: boolean, detail = '') => {
    const song = detail ? matchSong(detail, songs) : undefined;
    items.splice(idx + 1, 0, { id: uid(), kind: bullet ? 'song' : 'custom', title: '', detail, songId: song?.id ?? null });
    markDirty();
    drawLines();
    focusLine(idx + 1, 'end');
  };

  const row = (it: LiturgyItem, idx: number): HTMLElement => {
    const bullet = isBullet(it);
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
        detailEl.placeholder = placeholderFor(it);
        markDirty();
      });
    }
    const detailEl = h('input', {
      class: 'line-input line-detail',
      value: it.detail ?? '',
      placeholder: placeholderFor(it),
      list: it.kind === 'song' ? 'song-titles' : PASSAGE_KINDS.includes(it.kind) ? 'bible-books' : undefined,
      'aria-label': bullet ? `Line ${idx + 1} song` : `Line ${idx + 1} ${it.title || 'detail'}`,
    });
    const meta = h('span', { class: 'line-meta-wrap' }, songHint(it));
    detailEl.addEventListener('input', () => {
      it.detail = detailEl.value;
      if (it.kind === 'song') it.songId = matchSong(detailEl.value, songs)?.id ?? null;
      li.classList.toggle('has-detail', !!detailEl.value.trim());
      meta.replaceChildren(...[songHint(it)].filter((x): x is HTMLElement => !!x));
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
    for (const el of [labelEl, detailEl]) {
      el?.addEventListener('keydown', onKey);
      el?.addEventListener('focus', () => { lastFocus = idx; });
    }

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
    requestAnimationFrame(sizeAll);
    refreshIssues();
  };

  /* ---------- Team lines (foot of the plan) ---------- */
  const teamBlock = () => {
    const box = h('div', { class: 'doc-team', 'data-testid': 'team-lines' });
    const drawTeam = () => {
      box.replaceChildren(
        ...team.map((t, i) => {
          const role = h('input', { class: 'line-input line-label', value: t.role, placeholder: 'Role', 'aria-label': `Team role ${i + 1}` });
          const names = h('input', { class: 'line-input line-detail', value: t.names, placeholder: 'Name', 'aria-label': t.role || `Team line ${i + 1}` });
          role.addEventListener('input', () => { t.role = role.value; sizeTo(role); markDirty(); });
          names.addEventListener('input', () => { t.names = names.value; markDirty(); });
          requestAnimationFrame(() => sizeTo(role));
          return h('div', { class: 'doc-line has-detail' },
            role, h('span', { class: 'line-sep', 'aria-hidden': 'true' }, ':'), names,
            h('span', { class: 'line-tools' }, iconButton('trash', `Remove ${t.role || 'team line'}`, () => { team.splice(i, 1); markDirty(); drawTeam(); })),
          );
        }),
        h('div', { class: 'doc-add no-print' }, button('Team line', { icon: 'plus', small: true, variant: 'ghost', onClick: () => { team.push({ role: '', names: '' }); markDirty(); drawTeam(); } })),
      );
    };
    drawTeam();
    return box;
  };

  /* ---------- Text view: the exact text the church shares ---------- */
  const textArea = h('textarea', { class: 'doc-text', 'aria-label': 'Order of worship as text', spellcheck: 'false' });
  textArea.addEventListener('input', () => {
    const roleNames = [...new Set([...DEFAULT_TEAM_ROLES, ...team.map((t) => t.role)])];
    const r = parseLiturgyText(textArea.value, songs, roleNames, uid);
    items = r.items;
    team = r.skipped.map((line) => {
      const at = line.indexOf(':');
      return { role: line.slice(0, at).trim(), names: line.slice(at + 1).trim() };
    });
    markDirty();
  });

  const draw = () => {
    if (!items.length && mode === 'list') {
      docBody.replaceChildren(h('h2', { class: 'doc-date' }, monthDay(date)), starter(), teamBlock());
      return;
    }
    if (mode === 'text') {
      textArea.value = liturgyToText(date, items, songById, team);
      docBody.replaceChildren(
        h('p', { class: 'field-help', style: 'margin-bottom:8px' }, 'One element per line. Start a song with a dash. Write “Label: detail”, for example “Call to Worship: Psalm 89:5”. Team lines go at the end.'),
        textArea,
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
  const startFrom = (base: LiturgyItem[]) => {
    items = applySundayRules(base, info(), uid);
    if (!items.length) items = [{ id: uid(), kind: 'custom', title: '', detail: '' }];
    markDirty();
    draw();
    focusLine(0);
  };
  const starter = () => h('div', { class: 'stack', style: 'padding:8px 0 16px 30px' },
    h('p', null, 'Start this Sunday’s order of worship.'),
    h('div', { class: 'slots' },
      button('Use the ECCM order', { variant: 'primary', onClick: () => startFrom(defaultTemplateItems(uid)) }),
      button('Type or paste it', { variant: 'secondary', onClick: () => { mode = 'text'; setModeButtons(); draw(); } }),
      button('Blank', { variant: 'ghost', onClick: () => startFrom([]) }),
    ),
  );

  /* ---------- Mode switch and copy ---------- */
  const listBtn = h('button', { type: 'button', onclick: () => { mode = 'list'; setModeButtons(); draw(); } }, 'List');
  const textBtn = h('button', { type: 'button', onclick: () => { mode = 'text'; setModeButtons(); draw(); } }, 'Text');
  const setModeButtons = () => { listBtn.setAttribute('aria-pressed', String(mode === 'list')); textBtn.setAttribute('aria-pressed', String(mode === 'text')); };
  setModeButtons();
  const copyBtn = button('Copy', { icon: 'copy', small: true, variant: 'ghost', onClick: async () => {
    const ok = await copyText(liturgyToText(date, items, songById, team));
    toast(ok ? 'Copied in the church’s format.' : 'Copy failed.');
  } });

  /* ---------- Save ---------- */
  const versionNote = input({ placeholder: 'What changed? (optional)', 'aria-label': 'Version note', class: 'input', style: 'width:min(260px,100%)' });
  const doSave = async () => {
    const cleaned = items.filter((i) => i.title.trim() || (i.detail ?? '').trim());
    const saved = savePlan({ ...plan, liturgy: cleaned, sermon, theme, team: team.filter((t) => t.role.trim()), creedOverride }, versionNote.value.trim());
    dirty = false;
    toast(`Saved version ${saved.version}.`, 'success');
    await page.refresh();
  };
  saveBtn.addEventListener('click', () => void withBusy(saveBtn, async () => { try { await doSave(); } catch (e) { toast(errorMessage(e), 'error'); } }));
  document.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!saveBtn.disabled) saveBtn.click(); }
  };

  /* ---------- Sermon panel ---------- */
  const sTitle = input({ value: sermon.title });
  const sPreacher = input({ value: sermon.preacher });
  const sTheme = input({ value: theme });
  sTitle.addEventListener('input', () => { sermon.title = sTitle.value; markDirty(); });
  sPreacher.addEventListener('input', () => { sermon.preacher = sPreacher.value; markDirty(); });
  sTheme.addEventListener('input', () => { theme = sTheme.value; markDirty(); });

  let creedCtl: HTMLElement | null = null;
  if (info().isLast) {
    const sel = select([
      { value: '', label: `This month’s: ${CREED_NAMES[sundayInfo(date, CREED_ANCHOR).creed!]}` },
      { value: 'nicene', label: CREED_NAMES.nicene },
      { value: 'apostles', label: CREED_NAMES.apostles },
    ], creedOverride ?? '', { 'data-testid': 'creed-select' });
    sel.addEventListener('change', () => {
      creedOverride = (sel.value || null) as CreedKind | null;
      if (items.length) items = applySundayRules(items, info(), uid);
      markDirty();
      draw();
      tags.replaceChildren(...specialPills());
    });
    creedCtl = field('Creed', sel, 'The last Sunday alternates monthly between the Nicene and Apostles’ Creeds.');
  }
  const sermonPanel = panel('Sermon', h('div', { class: 'panel-body stack' }, field('Title', sTitle), field('Preacher', sPreacher), field('Theme', sTheme), creedCtl));

  /* ---------- Songs panel (from the SongList spreadsheet) ---------- */
  const addSong = (s: Song) => {
    if (mode !== 'list') { mode = 'list'; setModeButtons(); draw(); }
    const cur = items[lastFocus];
    if (cur && cur.kind === 'song' && !(cur.detail ?? '').trim()) {
      cur.detail = s.title; cur.songId = s.id; markDirty(); drawLines(); focusLine(lastFocus, 'end');
    } else {
      insertAfter(lastFocus >= 0 && lastFocus < items.length ? lastFocus : items.length - 1, true, s.title);
    }
    toast(`Added “${s.title}”.`);
  };

  const songSearch = input({ type: 'search', placeholder: 'Title, writer or theme', 'aria-label': 'Search the SongList' });
  const themeSel = select([{ value: '', label: 'All themes' }, ...allThemes(songs).map((t) => ({ value: t, label: t }))], '', { 'aria-label': 'Filter by theme' });
  const results = h('ul', { class: 'conflict-list', 'data-testid': 'song-results' });
  const drawResults = () => {
    const q = songSearch.value.trim();
    if (!q && !themeSel.value) { results.replaceChildren(); return; }
    const found = searchSongs(songs, q, themeSel.value).slice(0, 12);
    results.replaceChildren(...(found.length ? found.map((s) => {
      const gap = s.lastSung ? daysBetween(s.lastSung, date) : null;
      return h('li', null,
        h('div', { style: 'flex:1;min-width:0' },
          s.lyricsLink ? h('a', { href: s.lyricsLink, target: '_blank', rel: 'noopener' }, s.title) : h('span', null, s.title),
          h('div', { class: `song-sub${gap !== null && gap >= 0 && gap < 28 ? ' is-warn' : ''}` },
            s.lastSung ? `Last sung ${formatShort(s.lastSung)} ${s.lastSung.slice(0, 4)}` : 'Not sung yet',
            s.themes.length ? ` · ${s.themes.slice(0, 3).join(', ')}` : ''),
        ),
        iconButton('plus', `Add ${s.title}`, () => addSong(s)),
      );
    }) : [h('li', { class: 'dash' }, 'No songs match.')]));
  };
  songSearch.addEventListener('input', debounce(drawResults, 120));
  themeSel.addEventListener('change', drawResults);

  const sourceNote = h('p', { class: 'field-help', 'data-testid': 'songlist-status' },
    `${songs.length} songs from the `, h('a', { href: SPREADSHEET_URL, target: '_blank', rel: 'noopener' }, 'SongList spreadsheet'),
    songList.source === 'snapshot' ? ` (saved copy from ${formatShort(songList.fetchedAt.slice(0, 10))})` : ` · read ${formatDateTime(songList.fetchedAt)}`,
  );
  const refreshBtn = button('Refresh', { icon: 'refresh', small: true, variant: 'ghost' });
  refreshBtn.addEventListener('click', () => void withBusy(refreshBtn, async () => {
    await refreshSongs(true);
    if (!songListError) { if (dirty) toast('SongList refreshed. Save, then reload to see updated hints.'); else await page.refresh(); }
  }));
  const songsPanel = h('section', { class: 'panel', 'aria-label': 'Songs' },
    h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Songs'), h('div', { class: 'panel-actions' }, refreshBtn)),
    h('div', { class: 'panel-body stack', style: 'gap:10px' },
      sourceNote,
      songListError ? notice(`Could not read the spreadsheet: ${songListError}`, 'warning') : null,
      h('div', { class: 'search' }, icon('search'), songSearch),
      themeSel,
    ),
    results,
  );

  /* ---------- Versions ---------- */
  const versions = versionsOf(plan.id);
  const versionsPanel = panel('Earlier versions', versions.length
    ? h('ul', { class: 'conflict-list', 'data-testid': 'versions' }, versions.slice(0, 8).map((v, i) =>
      h('li', null,
        h('div', { style: 'flex:1;min-width:0' },
          h('div', null, `Version ${v.version}${i === 0 ? ' (current)' : ''}`),
          h('div', { class: 'song-sub' }, `${formatDateTime(v.savedAt)}${v.note ? ` · ${v.note}` : ''}`),
        ),
        i > 0 ? button('Compare', { small: true, variant: 'ghost', onClick: () => compare(v, versions[0], songById) }) : null,
        i > 0 ? button('Restore', { small: true, variant: 'ghost', onClick: async () => {
          if (!(await confirmDialog(`Restore version ${v.version}?`, 'Its lines replace the current ones. Press Save to keep them.', 'Restore'))) return;
          items = normalizeItems(v.items.map((x) => ({ ...x })), songById);
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

  const specialPills = () => describeSunday(info()).map((l) => h('span', { class: 'pill pill-info' }, l));
  const tags = h('span', { class: 'pills', 'data-testid': 'special-tags' }, ...specialPills());

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
        h('div', { class: 'slots' }, h('span', { 'data-testid': 'service-date', style: 'font-weight:500' }, formatLong(date)), tags),
      ),
      issuesBox,
      h('div', { class: 'grid grid-gap xl:grid-cols-[minmax(0,1fr)_340px] items-start' },
        h('section', { class: 'panel', 'aria-label': 'Order of worship' },
          h('div', { class: 'panel-head' },
            h('h2', { class: 'panel-title' }, 'Order of worship'),
            h('div', { class: 'panel-actions' }, h('div', { class: 'segmented', role: 'group', 'aria-label': 'Edit as' }, listBtn, textBtn), copyBtn),
          ),
          docBody,
          h('div', { class: 'doc-foot no-print' }, dirtyNote, versionNote, saveBtn),
        ),
        h('div', { class: 'stack' }, songsPanel, sermonPanel, versionsPanel),
      ),
    ),
  );
  draw();

  if (isStale(songList) && !refreshing) {
    void refreshSongs(false).then(() => { if (!dirty && !songListError) void page.refresh(); });
  }
}

/** Reads the SongList from the spreadsheet. Failures keep the cached list. */
async function refreshSongs(loud: boolean): Promise<void> {
  refreshing ??= (async () => {
    try {
      songList = await fetchSongList();
      songListError = '';
      if (loud) toast(`${songList.songs.length} songs read from the SongList.`, 'success');
    } catch (e) {
      songListError = errorMessage(e);
      if (loud) toast(songListError, 'error');
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function placeholderFor(it: LiturgyItem): string {
  if (it.slot === 'cpp_song') return 'Added song';
  if (it.kind === 'song') return 'Song title';
  if (PASSAGE_KINDS.includes(it.kind)) return 'Passage, e.g. Romans 5';
  return 'Add detail';
}

function compare(older: PlanVersion, current: PlanVersion, songs: Map<string, Song>) {
  const m = modal(`Version ${older.version} compared with version ${current.version}`, { wide: true });
  const a = normalizeItems(older.items, songs).map((i) => formatLine(i, songs));
  const b = normalizeItems(current.items, songs).map((i) => formatLine(i, songs));
  m.body.append(
    h('p', { style: 'color:var(--muted)' }, 'Removed lines are struck through; added lines are highlighted.'),
    h('ul', { class: 'diff' }, diffLines(a, b).map((d) => h('li', { class: `d-${d.type}` }, d.text))),
  );
}

// Last, so every module-level constant above is initialised before the first render.
void bootPage({ title: 'Liturgy planning', render: renderPage });
