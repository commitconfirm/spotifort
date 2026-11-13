// Genre picker: the most common lineup tags as toggle chips, and the lineup artists that carry them.

import { recommendByTags } from '../core/recommend.js';
import { joinNames } from '../app/state.js';
import { h, clear } from './dom.js';
import { artistRow } from './rows.js';

export const GENRE_CHIP_COUNT = 24;

/**
 * @param {{ tagsEl: HTMLElement, resultsEl: HTMLElement, lineup: object, tags: { tag: string }[], selected: Set<string>,
 *   service: string, expanded: Set<string>, onChange: () => void }} options
 */
export function renderGenrePanel({ tagsEl, resultsEl, lineup, tags, selected, service, expanded, onChange }) {
  clear(tagsEl);
  for (const { tag } of tags.slice(0, GENRE_CHIP_COUNT)) {
    const pressed = selected.has(tag);
    tagsEl.append(
      h(
        'li',
        {},
        h('button', {
          className: 'chip chip--toggle',
          text: tag,
          attrs: { type: 'button', 'aria-pressed': String(pressed) },
          on: {
            click: (e) => {
              if (selected.has(tag)) selected.delete(tag);
              else selected.add(tag);
              e.currentTarget.setAttribute('aria-pressed', String(selected.has(tag)));
              onChange(); // re-renders the results only, so focus stays on this chip
            },
          },
        })
      )
    );
  }
  renderGenreResults({ resultsEl, lineup, selected, service, expanded });
}

/** Only the results (used after a tag toggles, so focus stays on the chip). */
export function renderGenreResults({ resultsEl, lineup, selected, service, expanded }) {
  clear(resultsEl);
  if (!selected.size) {
    resultsEl.append(h('p', { className: 'muted', text: 'Choose a genre to see who is playing.' }));
    return;
  }
  const results = recommendByTags([...selected], lineup);
  if (!results.length) {
    resultsEl.append(h('p', { className: 'empty-state', text: 'Nobody on the lineup carries those tags.' }));
    return;
  }
  resultsEl.append(
    h('h4', { className: 'band-heading', text: `Genre matches (${results.length})` }),
    h(
      'ul',
      { className: 'artist-list' },
      ...results.map((r) =>
        artistRow({ artist: lineup.byN(r.n), lineup, service, idBase: `genre-${r.n}`, reason: `tagged ${joinNames(r.matched)}`, expanded })
      )
    )
  );
}
