// "I listen on: Spotify / Apple Music / Tidal / Bandcamp" as a radio group inside a <fieldset>.

import { SERVICES } from '../store.js';
import { PLATFORM_LABELS } from '../core/links.js';
import { h, clear } from './dom.js';

/**
 * @param {HTMLElement} holder element inside the fieldset that receives the options
 * @param {string} current
 * @param {(service: string) => void} onChange
 */
export function renderServicePicker(holder, current, onChange) {
  clear(holder);
  for (const service of SERVICES) {
    const id = `service-${service}`;
    const input = h('input', { attrs: { type: 'radio', name: 'service', id, value: service, checked: service === current } });
    input.addEventListener('change', () => {
      if (input.checked) onChange(service);
    });
    holder.append(h('span', { className: 'service-option' }, input, h('label', { attrs: { for: id }, text: PLATFORM_LABELS[service] })));
  }
}
