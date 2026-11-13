// "My artists": one chip per hand-added artist (with a remove button) and one summary chip per library source.

import { h, clear } from './dom.js';

/**
 * @param {HTMLElement} list the <ul> for chips
 * @param {{ manual: { key: string, name: string }[], libraries: { sourceId: string, label: string, text: string }[] }} chips
 * @param {{ onRemove: (key: string) => void, onRemoveLibrary: (sourceId: string) => void, onRefreshLibrary: (sourceId: string) => void, busy?: boolean }} handlers
 */
export function renderPoolChips(list, chips, { onRemove, onRemoveLibrary, onRefreshLibrary, busy = false }) {
  clear(list);
  for (const lib of chips.libraries) {
    list.append(
      h(
        'li',
        { className: 'chip chip--library', attrs: { 'data-source': lib.sourceId } },
        h('span', { className: 'chip-text', text: lib.text }),
        h('button', {
          className: 'chip-action',
          text: `Refresh`,
          attrs: { type: 'button', 'aria-label': `Refresh from ${lib.label.replace(/ library$/, '')}`, disabled: busy },
          on: { click: () => onRefreshLibrary(lib.sourceId) },
        }),
        h('button', {
          className: 'chip-remove',
          text: '×',
          attrs: { type: 'button', 'aria-label': `Remove ${lib.label}`, disabled: busy },
          on: { click: () => onRemoveLibrary(lib.sourceId) },
        })
      )
    );
  }
  for (const m of chips.manual) {
    list.append(
      h(
        'li',
        { className: 'chip', attrs: { 'data-key': m.key } },
        h('span', { className: 'chip-text', text: m.name }),
        h('button', {
          className: 'chip-remove',
          text: '×',
          attrs: { type: 'button', 'aria-label': `Remove ${m.name}` },
          on: { click: () => onRemove(m.key) },
        })
      )
    );
  }
}

/**
 * After a chip is removed, move focus to the chip that took its place (or the one before), else to `fallback`.
 * @param {HTMLElement} list
 * @param {number} index position of the removed chip
 * @param {HTMLElement} fallback
 */
export function focusAfterRemoval(list, index, fallback) {
  const buttons = [...list.querySelectorAll('.chip-remove')];
  const target = buttons[Math.min(index, buttons.length - 1)];
  (target ?? fallback).focus();
}
