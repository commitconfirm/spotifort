// Small DOM helpers. All text goes in through textContent; URLs reach the DOM only through externalLink(), which
// accepts URLs that core/links.js has already validated and re-checks the scheme.

/**
 * Create an element.
 * @param {string} tag
 * @param {{ className?: string, text?: string, attrs?: Record<string, string|boolean|number|null|undefined>,
 *   on?: Record<string, EventListener>, hidden?: boolean }} [props]
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  if (props.className) el.className = props.className;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const [type, fn] of Object.entries(props.on ?? {})) el.addEventListener(type, fn);
  if (props.hidden) el.hidden = true;
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Remove all children. */
export function clear(el) {
  el.replaceChildren();
}

/**
 * An external link opening in a new tab. Only https URLs are rendered as links; anything else becomes plain text.
 * @param {string|null} url already validated by core/links.js
 * @param {string} text
 * @param {{ className?: string, label?: string }} [options] label: accessible name when the visible text is short
 */
export function externalLink(url, text, { className, label } = {}) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return h('span', { className, text });
  return h('a', {
    className,
    text,
    attrs: { href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label },
  });
}

/** Set a polite live region's text so screen readers announce it (clearing first makes repeats audible). */
export function announce(el, text) {
  el.textContent = '';
  window.setTimeout(() => {
    el.textContent = text;
  }, 50);
}
