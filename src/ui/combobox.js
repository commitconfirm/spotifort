// Autocomplete following the WAI-ARIA combobox pattern with a listbox popup (aria-autocomplete="list"):
// DOM focus stays on the input, the highlighted option is conveyed with aria-activedescendant, ArrowDown/ArrowUp
// move through options (and open the list), Enter adds the highlighted option or submits the typed text, Escape
// closes the list (or clears the input when it is already closed), Tab closes it. Options are chosen by click or tap;
// mousedown is cancelled so the input keeps focus. The listbox is positioned over the page (no layout shift).
// No debounce: the index search is a single linear pass and fast enough per keystroke.

import { h, clear } from './dom.js';

const COUNT_DELAY_MS = 500; // announce the result count once typing pauses, not on every keystroke

/**
 * @param {{
 *   input: HTMLInputElement, listbox: HTMLElement, countEl: HTMLElement,
 *   getSuggestions: (query: string) => { id: string, kind: string, name: string }[],
 *   renderOption: (suggestion: object) => (Node|string)[],
 *   onSelect: (suggestion: object) => void,
 *   onSubmit: (text: string, hasSuggestions: boolean) => void,
 *   onFirstInteraction?: () => void,
 *   onInput?: () => void,
 * }} options
 * @returns {{ refresh: () => void, close: () => void, clearInput: () => void }}
 */
export function createCombobox({ input, listbox, countEl, getSuggestions, renderOption, onSelect, onSubmit, onFirstInteraction, onInput }) {
  let items = [];
  let active = -1;
  let countTimer = 0;
  let interacted = false;

  const optionId = (i) => `${listbox.id}-opt-${i}`;
  const isOpen = () => !listbox.hidden;

  function setActive(i) {
    const prev = listbox.querySelector('[aria-selected="true"]');
    if (prev) prev.setAttribute('aria-selected', 'false');
    active = i;
    if (i < 0) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    const el = document.getElementById(optionId(i));
    if (!el) return;
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (!items.length) return;
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }

  function announceCount(query) {
    window.clearTimeout(countTimer);
    countTimer = window.setTimeout(() => {
      if (!query) countEl.textContent = '';
      else countEl.textContent = items.length ? `${items.length} suggestion${items.length === 1 ? '' : 's'} available.` : 'No suggestions.';
    }, COUNT_DELAY_MS);
  }

  function render() {
    const query = input.value;
    items = query.trim() ? getSuggestions(query) : [];
    clear(listbox);
    items.forEach((s, i) => {
      const li = h(
        'li',
        {
          className: `combobox-option combobox-option--${s.kind}`,
          attrs: { id: optionId(i), role: 'option', 'aria-selected': 'false' },
          on: {
            mousedown: (e) => e.preventDefault(),
            click: () => choose(i),
          },
        },
        ...renderOption(s)
      );
      listbox.append(li);
    });
    active = -1;
    input.removeAttribute('aria-activedescendant');
    if (items.length) open();
    else close();
    announceCount(query.trim());
  }

  function choose(i) {
    const s = items[i];
    if (!s) return;
    close();
    onSelect(s);
  }

  function first() {
    if (!interacted) {
      interacted = true;
      onFirstInteraction?.();
    }
  }

  input.addEventListener('focus', first);
  input.addEventListener('pointerdown', first);
  input.addEventListener('input', () => {
    first();
    onInput?.();
    render();
  });
  input.addEventListener('blur', () => close());
  input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen()) {
          render();
          if (items.length) setActive(0);
        } else setActive(active + 1 >= items.length ? 0 : active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!isOpen()) {
          render();
          if (items.length) setActive(items.length - 1);
        } else setActive(active <= 0 ? items.length - 1 : active - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (isOpen() && active >= 0) choose(active);
        else if (input.value.trim()) onSubmit(input.value.trim(), items.length > 0);
        break;
      case 'Escape':
        if (isOpen()) {
          e.preventDefault();
          close();
        } else if (input.value) {
          e.preventDefault();
          input.value = '';
          onInput?.();
          render();
        }
        break;
      case 'Tab':
        close();
        break;
      default:
    }
  });

  return {
    /** Re-run the search for the current text (after the outside-artist index has loaded). */
    refresh() {
      if (document.activeElement === input && input.value.trim()) render();
    },
    close,
    clearInput() {
      input.value = '';
      items = [];
      close();
      countEl.textContent = '';
    },
  };
}
