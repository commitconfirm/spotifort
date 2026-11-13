/**
 * Orchestration shared by the network stages. No network of its own.
 *
 * Failures never become facts: an item whose work throws is left as it was and retried on the next run.
 * The stage stops after `maxConsecutiveErrors` failures in a row, or at once when the error says retrying
 * is pointless (`err.abort`, e.g. a Retry-After far beyond what we will wait).
 */
import { MAX_CONSECUTIVE_ERRORS } from './constants.js';

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<void>} work resolves when the item's result is stored in memory
 * @param {object} [opts]
 * @param {number} [opts.maxConsecutiveErrors]
 * @param {() => void} [opts.save] called every `saveEvery` successes and always at the end
 * @param {number} [opts.saveEvery]
 * @param {(item: T, index: number, total: number) => void} [opts.onItem] called before each item
 * @param {(item: T, err: Error) => void} [opts.onError]
 * @returns {Promise<{ok: number, failed: {item: T, message: string}[], notReached: T[], aborted: string|null}>}
 */
export async function processItems(items, work, opts = {}) {
  const { maxConsecutiveErrors = MAX_CONSECUTIVE_ERRORS, save = () => {}, saveEvery = 10, onItem = () => {}, onError = () => {} } = opts;
  const failed = [];
  let ok = 0;
  let streak = 0;
  let aborted = null;
  let i = 0;
  try {
    for (; i < items.length; i++) {
      onItem(items[i], i, items.length);
      try {
        await work(items[i], i);
        ok++;
        streak = 0;
        if (ok % saveEvery === 0) save();
      } catch (err) {
        streak++;
        failed.push({ item: items[i], message: err?.message ?? String(err) });
        onError(items[i], err);
        if (err?.abort) {
          aborted = err.message;
          i++;
          break;
        }
        if (streak >= maxConsecutiveErrors) {
          aborted = `${streak} consecutive errors (last: ${err?.message})`;
          i++;
          break;
        }
      }
    }
  } finally {
    save();
  }
  return { ok, failed, notReached: items.slice(i), aborted };
}

/**
 * Progress line for a stage: rewrites one line in a terminal, prints every 25th item when output is a log.
 * @returns {(item: {name: string}, index: number, total: number) => void}
 */
export function progressLine(out = process.stdout) {
  return (item, i, total) => {
    if (out.isTTY) out.write(`\r  ${i + 1}/${total} ${item.name.padEnd(45).slice(0, 45)}`);
    else if (i % 25 === 0) out.write(`  ${i + 1}/${total} ${item.name}\n`);
  };
}
