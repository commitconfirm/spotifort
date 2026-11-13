// The two result lists ("Playing Treefort", "Recommended for you") and their designed empty, loading and error states.

import { formatCount, groupByBand, reasonText } from '../app/state.js';
import { h, clear } from './dom.js';
import { artistRow } from './rows.js';

function box(title, ...children) {
  return h('div', { className: 'zine-box results-state' }, h('h2', { text: title }), ...children);
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   status: 'empty'|'loading'|'error'|'ready',
 *   error?: string, onRetry?: () => void, onBrowseGenres?: () => void,
 *   lineup?: object, service?: string, expanded?: Set<string>,
 *   results?: { matches: object[], recommendations: object[], noData: object[] }, relative?: boolean,
 *   similarityLoading?: boolean,
 * }} vm
 */
export function renderResults(container, vm) {
  clear(container);
  if (vm.status === 'loading') {
    container.append(box('Loading the lineup…', h('p', { className: 'muted', text: 'One moment.' })));
    return;
  }
  if (vm.status === 'error') {
    container.append(
      box(
        'Something went wrong',
        h('p', { text: vm.error || "We couldn't load the festival data." }),
        h('p', {}, h('button', { className: 'btn btn-primary', text: 'Try again', attrs: { type: 'button' }, on: { click: () => vm.onRetry?.() } }))
      )
    );
    return;
  }
  if (vm.status === 'empty') {
    container.append(
      box(
        'Your Treefort picks will show up here',
        h('p', { text: 'Add an artist you like above. We will list anyone you already like who is playing, and recommend other acts on the lineup that sound like them.' }),
        h('p', { className: 'muted', text: 'Nothing is sent anywhere: the matching happens in your browser.' })
      )
    );
    return;
  }

  const { lineup, service, expanded, results } = vm;
  const { matches, recommendations, noData } = results;

  if (noData.length) {
    container.append(
      h(
        'ul',
        { className: 'no-data-list' },
        ...noData.map((e) => h('li', { text: `Nothing at Treefort this year is close to ${e.name} in our data.` }))
      )
    );
  }

  if (!matches.length && !recommendations.length) {
    container.append(
      box(
        vm.similarityLoading ? 'Finding your matches…' : 'No Treefort matches yet',
        vm.similarityLoading
          ? h('p', { className: 'muted', text: 'Loading similar-artist data.' })
          : h('p', { text: 'None of your artists are on the lineup, and nobody playing is close enough to recommend. Try adding a few more artists, or browse by genre.' }),
        vm.similarityLoading ? null : h('p', {}, h('button', { className: 'btn', text: 'Browse by genre', attrs: { type: 'button' }, on: { click: () => vm.onBrowseGenres?.() } }))
      )
    );
    return;
  }

  // Playing Treefort
  const playing = h('section', { className: 'zine-box result-list', attrs: { 'aria-labelledby': 'playing-heading' } });
  playing.append(h('h2', { attrs: { id: 'playing-heading' } }, 'Playing Treefort ', h('span', { className: 'count', text: `(${formatCount(matches.length)})` })));
  if (matches.length) {
    if (matches.some((m) => !m.confirmed)) {
      playing.append(h('p', { className: 'list-note', text: '“unconfirmed” means we matched by name, or our link to the festival act is not verified. Check before you go.' }));
    }
    playing.append(
      h(
        'ul',
        { className: 'artist-list' },
        ...matches.map((m) => artistRow({ artist: lineup.byN(m.n), lineup, service, idBase: `play-${m.n}`, unconfirmed: !m.confirmed, expanded }))
      )
    );
  } else {
    playing.append(h('p', { className: 'empty-state', text: 'None of your artists are on the lineup yet. The recommendations are the next best thing.' }));
  }

  // Recommended for you
  const rec = h('section', { className: 'zine-box result-list', attrs: { 'aria-labelledby': 'rec-heading' } });
  rec.append(h('h2', { attrs: { id: 'rec-heading' } }, 'Recommended for you ', h('span', { className: 'count', text: `(${formatCount(recommendations.length)})` })));
  if (vm.similarityLoading) rec.append(h('p', { className: 'list-note', text: 'Loading more similar-artist data…' }));
  if (recommendations.length) {
    if (vm.relative) rec.append(h('p', { className: 'list-note', text: 'With a library this big, matches are grouped by rank.' }));
    for (const group of groupByBand(recommendations, { relative: vm.relative })) {
      const headingId = `band-${group.band}`;
      rec.append(
        h('h3', { className: 'band-heading', attrs: { id: headingId }, text: group.label }),
        h(
          'ul',
          { className: 'artist-list', attrs: { 'aria-labelledby': headingId } },
          ...group.items.map((r) => artistRow({ artist: lineup.byN(r.n), lineup, service, idBase: `rec-${r.n}`, reason: reasonText(r), expanded }))
        )
      );
    }
  } else if (!vm.similarityLoading) {
    rec.append(
      h('p', { className: 'empty-state', text: 'Nobody else on the lineup is close to your artists yet.' }),
      h('p', {}, h('button', { className: 'link-button', text: 'Browse by genre ›', attrs: { type: 'button' }, on: { click: () => vm.onBrowseGenres?.() } }))
    );
  }

  container.append(h('div', { className: 'results-grid' }, playing, rec));
}
