// /lineup: every lineup artist with a listen link for the chosen service, tags, the unverified marker and the
// artist's Last.fm page (Last.fm's terms ask for a link back).

import { log } from './log.js';
import { createStore } from './store.js';
import { loadLineup } from './data/load.js';
import { prepareLineup } from './core/lineup-index.js';
import { lastfmUrl } from './core/links.js';
import { listenFor, formatCount } from './app/state.js';
import { formatDate } from './utils.js';
import { h, clear, externalLink } from './ui/dom.js';
import { renderServicePicker } from './ui/service-picker.js';

const store = createStore();
let service = store.loadService();
let lineup = null;

const content = document.getElementById('lineup-content');

function artistItem(artist) {
  const { primary } = listenFor(artist, service);
  const lastfm = lastfmUrl(artist);
  const tags = Array.isArray(artist.tags) ? artist.tags : [];
  return h(
    'li',
    { className: 'lineup-item' },
    h(
      'div',
      { className: 'lineup-item-head' },
      h('span', { className: 'artist-name', text: artist.name }),
      artist.unverified ? h('span', { className: 'badge', text: 'unverified' }) : null,
      !artist.spotifyIds?.length ? h('span', { className: 'badge badge--plain', text: 'no Spotify match' }) : null,
      h(
        'span',
        { className: 'listen' },
        primary
          ? externalLink(primary.url, primary.text, {
              className: `listen-link listen-link--${primary.kind}`,
              label: primary.kind === 'verified' ? `Listen to ${artist.name} on ${primary.label}` : `Search for ${artist.name} on ${primary.label}`,
            })
          : null,
        lastfm ? externalLink(lastfm, 'Last.fm', { className: 'listen-link listen-link--lastfm', label: `${artist.name} on Last.fm` }) : null
      )
    ),
    tags.length ? h('p', { className: 'lineup-tags', text: tags.join(' · ') }) : null
  );
}

function render() {
  clear(content);
  const artists = [...lineup.artists].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  content.append(
    h('h2', { text: `All artists (${formatCount(artists.length)})` }),
    h('ul', { className: 'lineup-list' }, ...artists.map(artistItem))
  );
}

async function init() {
  renderServicePicker(document.querySelector('#service-picker .service-options'), service, (s) => {
    service = s;
    store.saveService(s);
    if (lineup) render();
  });
  try {
    lineup = prepareLineup(await loadLineup());
  } catch (err) {
    log.error('Lineup load failed:', err.message);
    clear(content);
    content.append(
      h('p', { text: "We couldn't load the lineup data. Check your connection and try again." }),
      h('p', {}, h('button', { className: 'btn', text: 'Try again', attrs: { type: 'button' }, on: { click: () => init() } }))
    );
    return;
  }
  if (lineup.lastUpdated) document.getElementById('last-updated').textContent = `Lineup data last updated: ${formatDate(lineup.lastUpdated)}`;
  render();
}

init();
