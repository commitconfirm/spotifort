// The "Make a Spotify playlist" panel: rendering only. All wording comes from src/app/state.js (playlistIntro,
// playlistOutcome, playlistFailure ...); src/main.js decides when each part shows. Every name from Spotify or the
// lineup goes in through textContent (h), and links only through externalLink.

import { listenFor, PLAYLIST_VISIBILITY_NOTE } from '../app/state.js';
import { h, clear, externalLink } from './dom.js';

/**
 * The panel before anything is made.
 * @param {{ summary: HTMLElement, notes: HTMLElement, details: HTMLElement, button: HTMLButtonElement }} els
 * @param {{ status: 'none'|'ready', summary: string, notes: string[], buttonText: string }} intro from playlistIntro
 */
export function renderPlaylistIntro(els, intro) {
  els.summary.textContent = intro.summary;
  clear(els.notes);
  for (const note of intro.notes) els.notes.append(h('li', { text: note }));
  els.notes.hidden = intro.notes.length === 0; // an empty list is not announced as "list, 0 items"
  els.details.hidden = intro.status === 'none';
  els.button.textContent = intro.buttonText;
}

/**
 * The visible progress line (not a live region: the page's announcer speaks phase changes).
 * @param {HTMLElement} container
 * @param {string} text
 * @param {{ done?: number, total?: number }} [progress] adds a bar when it has both numbers
 */
export function renderPlaylistProgress(container, text, progress) {
  container.hidden = false;
  clear(container);
  container.append(h('p', { text }));
  if (Number.isFinite(progress?.done) && Number.isFinite(progress?.total) && progress.total > 0) {
    container.append(h('progress', { attrs: { max: progress.total, value: Math.min(progress.done, progress.total), 'aria-hidden': 'true' } }));
  }
}

/** One left-out artist: the name and its usual listen or search link for the chosen service, as in rows.js. */
function leftOutItem({ n, name }, lineup, service) {
  const artist = lineup?.byN?.(n);
  const li = h('li', { className: 'playlist-left-out-item' }, h('span', { className: 'playlist-left-out-name', text: artist?.name ?? name }));
  if (!artist) return li;
  const { primary } = listenFor(artist, service);
  if (primary) {
    li.append(
      ' ',
      externalLink(primary.url, primary.text, {
        className: `listen-link listen-link--${primary.kind}`,
        label: primary.kind === 'verified' ? `Listen to ${artist.name} on ${primary.label}` : `Search for ${artist.name} on ${primary.label}`,
      })
    );
  }
  return li;
}

/**
 * After createPlaylist resolved.
 * @param {HTMLElement} container
 * @param {object} vm from playlistOutcome
 * @param {{ lineup: object, service: string }} context
 * @returns {HTMLElement} the heading (focusable, tabindex -1)
 */
export function renderPlaylistOutcome(container, vm, { lineup, service }) {
  container.hidden = false;
  clear(container);
  const heading = h('h4', { className: 'playlist-result-heading', text: vm.heading, attrs: { tabindex: '-1' } });
  container.append(heading);
  for (const line of vm.lines) container.append(h('p', { text: line }));
  if (vm.link) container.append(h('p', { className: 'playlist-open' }, externalLink(vm.link.url, vm.link.text, { className: 'btn btn-primary', label: vm.link.label })));
  if (vm.visibility) container.append(h('p', { className: 'playlist-visibility', text: PLAYLIST_VISIBILITY_NOTE }));
  for (const note of vm.notes) container.append(h('p', { className: 'playlist-note', text: note }));
  if (vm.newest) {
    // A list, not a sentence: artist names can contain commas ("hey, nothing").
    container.append(
      h('p', { className: 'playlist-names-label', text: vm.newest.label }),
      h('ul', { className: 'playlist-names' }, ...vm.newest.names.map((name) => h('li', { text: name })))
    );
  }
  if (vm.capNote) container.append(h('p', { className: 'playlist-note', text: vm.capNote }));
  if (vm.leftOut.length) {
    container.append(h('p', { className: 'playlist-left-out-intro', text: 'Left out of the playlist:' }));
    for (const group of vm.leftOut) {
      container.append(
        h('p', { className: 'playlist-left-out-label', text: group.label }),
        h('ul', { className: 'playlist-left-out' }, ...group.artists.map((a) => leftOutItem(a, lineup, service)))
      );
    }
  }
  return heading;
}

/**
 * When createPlaylist rejected, or the run could not start: nothing was created.
 * @param {HTMLElement} container
 * @param {{ heading: string, text: string }} vm from playlistFailure
 * @returns {HTMLElement} the heading (focusable, tabindex -1)
 */
export function renderPlaylistFailure(container, vm) {
  container.hidden = false;
  clear(container);
  const heading = h('h4', { className: 'playlist-result-heading', text: vm.heading, attrs: { tabindex: '-1' } });
  container.append(heading, h('p', { text: vm.text }));
  return heading;
}
