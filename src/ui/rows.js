// One lineup artist as a list row: [+] expansion (similar lineup artists), name, optional marker and reason, a
// listen link for the chosen service and a "more" control with the other services. Used by every list on the page.

import { listenFor, similarFor } from '../app/state.js';
import { h, externalLink } from './dom.js';

/**
 * Listen link for the chosen service plus the "more" control and its hidden list.
 * @returns {{ links: HTMLElement, more: HTMLElement|null }}
 */
function listenControls(artist, service, idBase) {
  const { primary, others } = listenFor(artist, service);
  const links = h('span', { className: 'listen' });
  if (primary) {
    links.append(
      externalLink(primary.url, primary.text, {
        className: `listen-link listen-link--${primary.kind}`,
        label: primary.kind === 'verified' ? `Listen to ${artist.name} on ${primary.label}` : `Search for ${artist.name} on ${primary.label}`,
      })
    );
  }
  if (!others.length) return { links, more: null };
  const moreId = `${idBase}-more`;
  const list = h(
    'ul',
    { className: 'more-links', attrs: { id: moreId, 'aria-label': `Other services for ${artist.name}` }, hidden: true },
    ...others.map((l) => h('li', {}, externalLink(l.url, l.text, { className: `listen-link listen-link--${l.kind}` })))
  );
  const button = h('button', {
    className: 'more-button',
    text: 'more',
    attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': moreId, 'aria-label': `More services for ${artist.name}` },
    on: {
      click: () => {
        const open = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(open));
        list.hidden = !open;
      },
    },
  });
  links.append(button);
  return { links, more: list };
}

/** The [+] panel: similar lineup artists with their signal and a listen link. Built on first open. */
function relatedPanel(artist, lineup, service, idBase) {
  const similar = similarFor(artist.n, lineup);
  if (!similar.length) return h('p', { className: 'related-empty', text: 'No similar artists on the lineup.' });
  return h(
    'div',
    {},
    h('p', { className: 'related-header', text: `Also at Treefort, similar to ${artist.name}:` }),
    h(
      'ul',
      { className: 'related-list' },
      ...similar.map((s) => {
        const { primary } = listenFor(s.artist, service);
        return h(
          'li',
          { className: 'related-item' },
          h('span', { className: 'related-name', text: s.name }),
          h('span', { className: 'related-signal', text: ` (${s.label})` }),
          ' ',
          primary
            ? externalLink(primary.url, primary.text, {
                className: `listen-link listen-link--${primary.kind}`,
                label: primary.kind === 'verified' ? `Listen to ${s.name} on ${primary.label}` : `Search for ${s.name} on ${primary.label}`,
              })
            : null
        );
      })
    )
  );
}

/**
 * @param {{
 *   artist: object, lineup: object, service: string, idBase: string,
 *   reason?: string, unconfirmed?: boolean, expanded: Set<string>,
 * }} options expanded: ids of rows whose [+] is open (kept across re-renders)
 * @returns {HTMLLIElement}
 */
export function artistRow({ artist, lineup, service, idBase, reason, unconfirmed, expanded }) {
  const relatedId = `${idBase}-related`;
  const related = h('div', { className: 'artist-related', attrs: { id: relatedId }, hidden: true });
  const isOpen = expanded.has(idBase);

  const marker = h('span', { className: 'artist-marker', text: '[+]', attrs: { 'aria-hidden': 'true' } });
  const toggle = h('button', {
    className: 'artist-toggle',
    attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': relatedId, 'aria-label': `Similar artists to ${artist.name}` },
  }, marker);

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    marker.textContent = open ? '[-]' : '[+]';
    if (open && !related.firstChild) related.append(relatedPanel(artist, lineup, service, idBase));
    related.hidden = !open;
    if (open) expanded.add(idBase);
    else expanded.delete(idBase);
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));

  const { links, more } = listenControls(artist, service, idBase);
  const name = h('span', { className: 'artist-name', text: artist.name });
  const badges = [];
  if (unconfirmed) badges.push(h('span', { className: 'badge', text: 'unconfirmed' }));

  const li = h(
    'li',
    { className: 'artist-item' },
    h('div', { className: 'artist-row' }, toggle, h('div', { className: 'artist-main' }, name, ...badges, reason ? h('p', { className: 'reason', text: reason }) : null), links),
    more,
    related
  );
  if (isOpen) setOpen(true);
  return li;
}
