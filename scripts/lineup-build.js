#!/usr/bin/env node
/**
 * Stage 5: state + overrides -> public/data/<year>/{lineup,similarity}.json, the Phase 1 file
 * public/lineups/<year>.json (until the new experience ships), data/<year>/review.md and sanity.md.
 * No network. Same inputs give byte-identical outputs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { loadOverrides, loadState, paths, writeFileAtomic } from './lib/store.js';
import { buildOutputs } from './lib/build.js';
import { formatCompactLines } from './lib/json-format.js';
import { gzipSize } from './lib/size.js';
import { BUDGET_LINEUP_GZIP, BUDGET_SIMILARITY_GZIP } from './lib/constants.js';

function writeIfChanged(path, text) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  writeFileAtomic(path, text);
  return true;
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

function main() {
  const state = loadState();
  if (state.artists.length === 0) throw new Error('state.json is empty. Run npm run lineup:scrape first.');
  const out = buildOutputs({ state, overrides: loadOverrides() });

  const files = [
    [paths.lineupOut, formatCompactLines(out.lineup), BUDGET_LINEUP_GZIP],
    [paths.similarityOut, formatCompactLines(out.similarity), BUDGET_SIMILARITY_GZIP],
    [paths.legacyOut, JSON.stringify(out.legacy, null, 2) + '\n', null], // same layout as the Phase 1 file
    [paths.review, out.review, null],
    [paths.sanity, out.sanity, null],
  ];
  let wrote = 0;
  for (const [path, text, budget] of files) {
    if (writeIfChanged(path, text)) wrote++;
    if (budget) {
      const gz = gzipSize(text);
      console.log(`${path.slice(path.indexOf('public/'))}: ${kb(Buffer.byteLength(text))} raw, ${kb(gz)} gzip (budget ${kb(budget)})`);
      if (gz > budget) throw new Error(`${path} is over its gzip budget`);
    }
  }
  const s = out.stats;
  console.log(`\nactive ${s.active}, removed ${s.removed}; Spotify ${JSON.stringify(s.confidence)}`);
  console.log(`Spotify ids by source ${JSON.stringify(s.spotifySources)}; unverified ${s.unverified}`);
  console.log(`MBIDs ${s.mbids}; links ${JSON.stringify(s.linksPerPlatform)}; ids ${JSON.stringify(s.idsPerPlatform)}`);
  console.log(`similar data ${s.withSimilar}, tags ${s.withTags}; neighbours ${JSON.stringify(s.neighbourCounts)}; signals ${JSON.stringify(s.neighbourSignals)}`);
  console.log(`reverse index: cutoff ${s.reverseMinMatch}; ${s.reverseNames} names, ${s.reversePairs} pairs`);
  for (const w of out.warnings) console.log(`warning: ${w}`);
  console.log(`\n${wrote} file(s) changed.\n`);
  console.log(out.sanity);
}

try {
  main();
} catch (err) {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
}
