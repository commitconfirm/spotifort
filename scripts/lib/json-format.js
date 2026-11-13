// Deterministic JSON writers. Same input, same bytes; diffs stay readable.

const isPrimitive = (v) => v === null || typeof v !== 'object';

/**
 * Pretty JSON for hand-reviewed files (state, overrides). Arrays of primitives stay on one line and
 * arrays of such arrays (pairs) get one pair per line.
 * @param {unknown} value
 * @returns {string} with trailing newline
 */
export function formatPretty(value) {
  return fmt(value, '') + '\n';
}

function fmt(v, pad) {
  if (isPrimitive(v)) return JSON.stringify(v);
  const inner = pad + '  ';
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every(isPrimitive)) return '[' + v.map((x) => JSON.stringify(x)).join(', ') + ']';
    const rows = v.map((x) => {
      const flat = Array.isArray(x) && x.every(isPrimitive);
      return inner + (flat ? '[' + x.map((y) => JSON.stringify(y)).join(', ') + ']' : fmt(x, inner));
    });
    return '[\n' + rows.join(',\n') + '\n' + pad + ']';
  }
  const entries = Object.entries(v).filter(([, x]) => x !== undefined);
  if (entries.length === 0) return '{}';
  const rows = entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${fmt(x, inner)}`);
  return '{\n' + rows.join(',\n') + '\n' + pad + '}';
}

/**
 * Compact JSON for shipped files: a top-level object whose array values get one element per line,
 * each element on a single compact line.
 * @param {Record<string, unknown>} obj
 * @returns {string} with trailing newline
 */
export function formatCompactLines(obj) {
  const rows = Object.entries(obj)
    .filter(([, x]) => x !== undefined)
    .map(([k, x]) => {
      if (Array.isArray(x) && x.length > 0) {
        return `${JSON.stringify(k)}:[\n${x.map((e) => JSON.stringify(e)).join(',\n')}\n]`;
      }
      return `${JSON.stringify(k)}:${JSON.stringify(x)}`;
    });
  return '{' + rows.join(',\n') + '}\n';
}
