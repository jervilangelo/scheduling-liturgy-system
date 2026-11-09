import type { Song } from '../../types/domain';
import { h } from '../../utils/dom';
import { allThemes, searchSongs } from '../../modules/song-library';
import { daysBetween, formatShort } from '../../utils/dates';
import { button, emptyState, modal, select } from '../shared/ui';
import { icon } from '../shared/icons';

/** Modal song search by title or theme; resolves with the chosen song. */
export function pickSong(songs: Song[], serviceDate: string, recentlyPlanned: Map<string, string>): Promise<Song | null> {
  return new Promise((resolve) => {
    let chosen: Song | null = null;
    const m = modal('Choose a song', { wide: true, onClose: () => resolve(chosen) });
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Search title, artist or theme', 'aria-label': 'Search songs' });
    const theme = select([{ value: '', label: 'All themes' }, ...allThemes(songs).map((t) => ({ value: t, label: t }))], '', { 'aria-label': 'Theme', style: 'width:auto' });
    const results = h('div', { class: 'table-wrap', style: 'max-height:55vh;overflow:auto' });
    const draw = () => {
      const found = searchSongs(songs, q.value, theme.value).sort((a, b) => a.title.localeCompare(b.title));
      if (!found.length) { results.replaceChildren(emptyState('No songs match. Add it in the song library first.', h('a', { class: 'btn btn-secondary', href: 'songs.html' }, 'Open song library'))); return; }
      results.replaceChildren(h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Title'), h('th', null, 'Themes'), h('th', null, 'Last sung'), h('th', null, h('span', { class: 'sr-only' }, 'Choose')))),
        h('tbody', null, found.map((s) => {
          const planned = recentlyPlanned.get(s.id);
          const gap = s.lastSung ? daysBetween(s.lastSung, serviceDate) : null;
          const recent = gap !== null && gap >= 0 && gap < 28;
          return h('tr', null,
            h('td', null, h('div', { style: 'font-weight:500' }, s.title), s.artist ? h('div', { style: 'font-size:12px;color:var(--muted)' }, s.artist) : null),
            h('td', null, s.themes.length ? s.themes.join(', ') : h('span', { class: 'dash' }, '—')),
            h('td', { class: 'num', style: 'text-align:left' },
              s.lastSung ? h('span', { style: recent ? 'color:var(--warning)' : '' }, `${formatShort(s.lastSung)}${recent ? ` (${gap} days before)` : ''}`) : h('span', { class: 'dash' }, 'Never'),
              planned ? h('div', { style: 'font-size:12px;color:var(--muted)' }, `Also planned ${formatShort(planned)}`) : null,
            ),
            h('td', { style: 'text-align:right' }, button('Choose', { small: true, onClick: () => { chosen = s; m.close(); } })),
          );
        })),
      ));
    };
    q.addEventListener('input', draw);
    theme.addEventListener('change', draw);
    m.body.append(h('div', { class: 'slots' }, h('div', { class: 'search', style: 'flex:1;min-width:200px' }, icon('search'), q), theme), results);
    draw();
    q.focus();
  });
}
