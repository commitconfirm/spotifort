// Deterministic gzip size: fixed level, and Node writes no timestamp into the header, so the same text always
// measures the same. Used by the build (to pick the reverse-index cutoff) and by check-dist (the budget).
import { gzipSync } from 'node:zlib';

/** @param {string|Buffer} text @returns {number} gzip size in bytes at level 9 */
export const gzipSize = (text) => gzipSync(text, { level: 9 }).length;
