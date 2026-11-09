import { bootPage, type PageContext } from '../components/shared/boot';
import { debounce, h } from '../utils/dom';
import {
  button, confirmDialog, emptyState, errorMessage, field, input, modal, notice, pageHeader, panel, panelWithActions, select, statusPill,
  textarea, toast, withBusy,
} from '../components/shared/ui';
import { icon } from '../components/shared/icons';
import { list, remove, save } from '../services/api/store';
import { pullSongList, pushLastSung, sheetsAvailable } from '../services/api/sheets';
import { allThemes, computeLastSungUpdates, mapSheetRows, mergeSheetSongs, parseDelimited, searchSongs, songUsage } from '../modules/song-library';
import { daysBetween, formatLong, formatShort, parseLooseDate, todayISO } from '../utils/dates';
import { uid } from '../utils/id';
import { downloadBytes } from '../modules/exports/xlsx';
import type { Song } from '../types/domain';

void bootPage({ id: 'songs', title: 'Song library', render: renderPage });

type Sort = 'title' | 'last' | 'uses';

async function renderPage(page: PageContext): Promise<void> {
  const { main, session, settings } = page;
  const [songs, services] = await Promise.all([list('songs'), list('services')]);
  const canEdit = session.can('manage_songs');
  const today = todayISO();
  const usage = songUsage(services);
  const usesOf = (id: string) => usage.filter((u) => u.songId === id);

  let q = '';
  let theme = '';
  let sort: Sort = 'title';

  const tableHost = h('div');
  const draw = () => {
    const found = searchSongs(songs, q, theme);
    found.sort((a, b) => {
      if (sort === 'last') return (b.lastSung ?? '').localeCompare(a.lastSung ?? '') || a.title.localeCompare(b.title);
      if (sort === 'uses') return usesOf(b.id).length - usesOf(a.id).length || a.title.localeCompare(b.title);
      return a.title.localeCompare(b.title);
    });
    if (!found.length) { tableHost.replaceChildren(emptyState(songs.length ? 'No songs match.' : 'The library is empty. Import the SongList sheet or add songs.')); return; }
    tableHost.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'table', 'data-testid': 'song-table' },
      h('thead', null, h('tr', null, h('th', null, 'Title'), h('th', null, 'Themes'), h('th', null, 'Last sung'), h('th', { class: 'num' }, 'Times planned'), h('th', null, 'Next planned'), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
      h('tbody', null, found.map((s) => {
        const uses = usesOf(s.id);
        const next = [...uses].reverse().find((u) => u.date > today);
        const gap = s.lastSung ? daysBetween(s.lastSung, today) : null;
        return h('tr', null,
          h('td', null, h('div', { style: 'font-weight:500' }, s.title), s.artist ? h('div', { style: 'font-size:12px;color:var(--muted)' }, s.artist) : null),
          h('td', null, s.themes.length ? s.themes.join(', ') : h('span', { class: 'dash' }, '—')),
          h('td', { class: 'num', style: 'text-align:left' }, s.lastSung ? `${formatShort(s.lastSung)} ${s.lastSung.slice(0, 4)}` : h('span', { class: 'dash' }, 'Never'), gap !== null && gap >= 0 ? h('div', { style: 'font-size:12px;color:var(--muted)' }, `${gap} days ago`) : null),
          h('td', { class: 'num' }, uses.length ? String(uses.length) : h('span', { class: 'dash' }, '0')),
          h('td', null, next ? h('a', { href: `liturgy.html?date=${next.date}` }, formatShort(next.date)) : h('span', { class: 'dash' }, '—')),
          h('td', { style: 'text-align:right;white-space:nowrap' }, button('Details', { small: true, variant: 'ghost', onClick: () => details(s) })),
        );
      })),
    )));
  };

  const details = (s: Song) => {
    const m = modal(s.title, { wide: true });
    const uses = usesOf(s.id);
    m.body.append(
      h('dl', { class: 'dl' },
        h('dt', null, 'Artist'), h('dd', null, s.artist || '—'),
        h('dt', null, 'Themes'), h('dd', null, s.themes.join(', ') || '—'),
        h('dt', null, 'Key'), h('dd', null, s.songKey || '—'),
        h('dt', null, 'Last sung'), h('dd', null, s.lastSung ? formatLong(s.lastSung) : 'Never'),
        h('dt', null, 'Sheet row'), h('dd', null, s.sheetRow ? `SongList row ${s.sheetRow}` : 'Not linked to the sheet'),
      ),
      h('h3', { class: 'panel-title' }, `Usage history (${uses.length})`),
      uses.length ? h('table', { class: 'table', 'data-testid': 'usage' },
        h('thead', null, h('tr', null, h('th', null, 'Sunday'), h('th', null, 'Status'))),
        h('tbody', null, uses.map((u) => h('tr', null, h('td', null, h('a', { href: `liturgy.html?date=${u.date}` }, formatLong(u.date))), h('td', null, statusPill(u.status))))),
      ) : h('p', { class: 'dash' }, 'Not planned in any service yet.'),
    );
    m.footer.append(
      canEdit ? button('Delete', { variant: 'ghost', onClick: async () => {
        if (!(await confirmDialog(`Delete "${s.title}"?`, uses.length ? `It is planned in ${uses.length} services; those slots will show no song. The SongList sheet is not changed.` : 'The SongList sheet is not changed.', 'Delete', true))) return;
        await remove('songs', [s.id], { action: 'delete', details: s.title });
        m.close(); await page.refresh();
      } }) : null,
      canEdit ? button('Edit', { onClick: () => { m.close(); edit(s); } }) : null,
      button('Close', { variant: 'ghost', onClick: () => m.close() }),
    );
  };

  const edit = (s: Song | null) => {
    const cur: Song = s ? { ...s } : { id: uid(), title: '', artist: '', themes: [], songKey: '', lastSung: null, sheetRow: null, notes: '' };
    const m = modal(s ? `Edit ${s.title}` : 'Add song');
    const title = input({ value: cur.title, required: true });
    const err = h('p', { class: 'field-error', hidden: true }, 'Enter a title.');
    const artist = input({ value: cur.artist });
    const themes = input({ value: cur.themes.join(', '), list: 'theme-list' });
    const key = input({ value: cur.songKey });
    const last = input({ type: 'date', value: cur.lastSung ?? '' });
    m.body.append(
      h('datalist', { id: 'theme-list' }, allThemes(songs).map((t) => h('option', { value: t }))),
      h('div', null, field('Title', title), err), field('Artist or author', artist), field('Themes', themes, 'Separate with commas.'), field('Key', key), field('Last sung', last),
    );
    const ok = button(s ? 'Save' : 'Add song', { variant: 'primary' });
    ok.addEventListener('click', () => void withBusy(ok, async () => {
      if (!title.value.trim()) { err.hidden = false; title.setAttribute('aria-invalid', 'true'); title.focus(); return; }
      const dup = songs.find((x) => x.id !== cur.id && x.title.trim().toLowerCase() === title.value.trim().toLowerCase());
      if (dup && !(await confirmDialog('A song with this title exists', `"${dup.title}" is already in the library. Save anyway?`, 'Save anyway'))) return;
      const out: Song = { ...cur, title: title.value.trim(), artist: artist.value.trim(), themes: themes.value.split(',').map((t) => t.trim()).filter(Boolean), songKey: key.value.trim(), lastSung: last.value || null };
      try { await save('songs', out, { action: s ? 'update' : 'create', details: out.title }); m.close(); toast('Saved.', 'success'); await page.refresh(); } catch (e) { toast(errorMessage(e), 'error'); }
    }));
    m.footer.append(button('Cancel', { variant: 'ghost', onClick: () => m.close() }), ok);
    title.focus();
  };

  /* ---------- Sheet sync ---------- */
  const pendingLastSung = computeLastSungUpdates(songs, services, today);

  const applyLastSung = button(`Apply Last Sung from published services${pendingLastSung.length ? ` (${pendingLastSung.length})` : ''}`, { disabled: !canEdit || !pendingLastSung.length });
  applyLastSung.addEventListener('click', () => void withBusy(applyLastSung, async () => {
    await save('songs', pendingLastSung.map((u) => ({ ...u.song, lastSung: u.lastSung })), { action: 'last-sung', details: `${pendingLastSung.length} songs` });
    if (sheetsAvailable) {
      try {
        const n = await pushLastSung(pendingLastSung.filter((u) => u.song.sheetRow).map((u) => ({ sheetRow: u.song.sheetRow!, title: u.song.title, lastSung: u.lastSung })));
        toast(`Last Sung updated for ${n} songs in the SongList sheet.`, 'success');
      } catch (e) { toast(`Saved here; the sheet could not be updated: ${errorMessage(e)}`, 'error'); }
    } else toast(`Last Sung updated for ${pendingLastSung.length} songs.`, 'success');
    await page.refresh();
  }));

  const importFromSheet = button('Import from SongList', { icon: 'download', disabled: !canEdit || !sheetsAvailable });
  importFromSheet.addEventListener('click', () => void withBusy(importFromSheet, async () => {
    try {
      const rows = await pullSongList();
      const r = mergeSheetSongs(songs, rows, uid);
      await save('songs', r.upserts, { action: 'sheet-import', details: `${r.added} added, ${r.updated} updated` });
      toast(`SongList imported: ${r.added} added, ${r.updated} updated.`, 'success');
      await page.refresh();
    } catch (e) { toast(`Import failed: ${errorMessage(e)}`, 'error'); }
  }));

  const pushAll = button('Send all Last Sung dates to the sheet', { icon: 'upload', disabled: !canEdit || !sheetsAvailable });
  pushAll.addEventListener('click', () => void withBusy(pushAll, async () => {
    const rows = songs.filter((s) => s.sheetRow && s.lastSung).map((s) => ({ sheetRow: s.sheetRow!, title: s.title, lastSung: s.lastSung! }));
    if (!(await confirmDialog('Update the SongList sheet?', `Only the "${settings.sheetLastSungHeader}" cell of ${rows.length} existing rows is written. No rows, columns or formatting change.`, 'Update sheet'))) return;
    try { const n = await pushLastSung(rows); toast(`Updated ${n} cells.`, 'success'); } catch (e) { toast(errorMessage(e), 'error'); }
  }));

  const pasteImport = () => {
    const m = modal('Import SongList rows', { wide: true });
    const ta = textarea({ rows: '10', placeholder: `${settings.sheetTitleHeader}\t${settings.sheetArtistHeader}\t${settings.sheetThemeHeader}\t${settings.sheetLastSungHeader}\n…`, 'aria-label': 'Pasted rows' });
    const preview = h('div');
    m.body.append(
      h('p', null, `Select the whole SongList sheet (including the header row), copy and paste it here. Columns are matched by header name: "${settings.sheetTitleHeader}", "${settings.sheetLastSungHeader}", "${settings.sheetThemeHeader}" and "${settings.sheetArtistHeader}". Row numbers are kept so later updates go to the right rows.`),
      ta, preview,
    );
    const go = button('Import', { variant: 'primary' });
    go.addEventListener('click', () => void withBusy(go, async () => {
      try {
        const rows = mapSheetRows(parseDelimited(ta.value), { title: settings.sheetTitleHeader, lastSung: settings.sheetLastSungHeader, theme: settings.sheetThemeHeader, artist: settings.sheetArtistHeader }, parseLooseDate);
        if (!rows.length) { preview.replaceChildren(notice('No song rows were found under the header row.', 'warning')); return; }
        const r = mergeSheetSongs(songs, rows, uid);
        await save('songs', r.upserts, { action: 'sheet-import', details: `paste: ${r.added} added, ${r.updated} updated` });
        toast(`${r.added} added, ${r.updated} updated.`, 'success');
        m.close(); await page.refresh();
      } catch (e) { preview.replaceChildren(notice(errorMessage(e), 'negative')); }
    }));
    m.footer.append(button('Cancel', { variant: 'ghost', onClick: () => m.close() }), go);
    ta.focus();
  };

  const exportLastSung = () => {
    const lines = [['Sheet row', settings.sheetTitleHeader, settings.sheetLastSungHeader].join(','), ...songs.filter((s) => s.lastSung).sort((a, b) => (a.sheetRow ?? 1e9) - (b.sheetRow ?? 1e9)).map((s) => [s.sheetRow ?? '', `"${s.title.replace(/"/g, '""')}"`, s.lastSung].join(','))];
    downloadBytes(new TextEncoder().encode(lines.join('\r\n')), `last-sung-${today}.csv`, 'text/csv');
  };

  const sheetPanel = panelWithActions('SongList sheet', [], h('div', { class: 'panel-body stack' },
    sheetsAvailable
      ? (settings.sheetSpreadsheetId
        ? h('p', null, `Linked to sheet tab "${settings.sheetName}". Only the "${settings.sheetLastSungHeader}" column is ever written; the sheet’s rows, columns and formatting are never changed.`)
        : notice(h('span', null, 'Set the spreadsheet ID in ', h('a', { href: 'settings.html#sheets' }, 'Settings'), ' and the Edge Function secrets (see docs/SETUP.md) to sync.'), 'warning'))
      : notice('Demo mode: direct sheet sync needs Supabase. You can paste the sheet in and download Last Sung dates to paste back.', 'info'),
    pendingLastSung.length ? h('p', null, `${pendingLastSung.length} songs were sung in published services after their recorded Last Sung date.`) : h('p', { style: 'color:var(--muted)' }, 'Last Sung dates match the published services.'),
    h('div', { class: 'slots' },
      applyLastSung,
      sheetsAvailable ? importFromSheet : button('Paste SongList rows', { icon: 'upload', disabled: !canEdit, onClick: pasteImport }),
      sheetsAvailable ? pushAll : button('Download Last Sung (CSV)', { icon: 'download', onClick: exportLastSung }),
    ),
  ));

  /* ---------- Toolbar ---------- */
  const search = input({ type: 'search', placeholder: 'Search by title, artist or theme', 'aria-label': 'Search songs' });
  search.addEventListener('input', debounce(() => { q = search.value; draw(); }, 120));
  const themeSel = select([{ value: '', label: 'All themes' }, ...allThemes(songs).map((t) => ({ value: t, label: t }))], '', { 'aria-label': 'Filter by theme', style: 'width:auto' });
  themeSel.addEventListener('change', () => { theme = themeSel.value; draw(); });
  const sortSel = select([{ value: 'title', label: 'Sort by title' }, { value: 'last', label: 'Most recently sung' }, { value: 'uses', label: 'Most planned' }], sort, { 'aria-label': 'Sort', style: 'width:auto' });
  sortSel.addEventListener('change', () => { sort = sortSel.value as Sort; draw(); });

  main.replaceChildren(
    pageHeader('Song library', `${songs.length} songs from the SongList sheet and planned services.`, [
      canEdit ? button('Add song', { variant: 'primary', icon: 'plus', onClick: () => edit(null) }) : h('span'),
    ]),
    h('div', { class: 'grid grid-gap xl:grid-cols-[minmax(0,1fr)_340px] items-start' },
      panel(null, h('div', { class: 'slots panel-body', style: 'border-bottom:1px solid var(--rule)' }, h('div', { class: 'search', style: 'flex:1;min-width:220px' }, icon('search'), search), themeSel, sortSel), tableHost),
      sheetPanel,
    ),
  );
  draw();
}
