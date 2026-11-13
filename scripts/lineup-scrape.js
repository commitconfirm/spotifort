#!/usr/bin/env node
/**
 * Stage 1: scrape the festival's lineup page into data/<year>/state.json.
 * New names get the next artist number; names gone from the page are marked `removed` (never deleted).
 * Fails loudly, changing nothing, when the page yields too few names or would remove too much of the lineup.
 *
 * Usage: node scripts/lineup-scrape.js [--print]   (--print: list the names, write nothing)
 */
import { FESTIVAL, loadState, saveState, today } from './lib/store.js';
import { parseLineupHtml, parseRetryAfter } from './lib/lineup-pipeline.js';
import { mergeScrape } from './lib/state.js';
import { MIN_SCRAPED_NAMES } from './lib/constants.js';

const CLIENT_NAME = 'Spotifort lineup script (https://spotifort.com)';

async function fetchPage(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': CLIENT_NAME } });
    if (res.status === 429 || res.status === 503) {
      const wait = Math.min(60, parseRetryAfter(res.headers.get('retry-after')) ?? 2 ** attempt);
      console.log(`  HTTP ${res.status}; waiting ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Lineup page returned HTTP ${res.status}`);
    return res.text();
  }
  throw new Error('Lineup page kept rate limiting us');
}

async function main() {
  console.log(`${FESTIVAL.name} ${FESTIVAL.year}: scraping ${FESTIVAL.lineupUrl}`);
  const names = parseLineupHtml(await fetchPage(FESTIVAL.lineupUrl));
  if (names.length < MIN_SCRAPED_NAMES) {
    throw new Error(
      `Only found ${names.length} artist names (expected at least ${MIN_SCRAPED_NAMES}). ` +
      'The page markup has probably changed (looking for <h3 class="lineup-artist-name">). State not changed.'
    );
  }
  if (process.argv.includes('--print')) {
    names.forEach((n) => console.log(n));
    return;
  }
  const { state, added, removed, restored, renamed } = mergeScrape(loadState(), names, today());
  saveState(state);
  console.log(`  names on the site: ${names.length}; records: ${state.artists.length}`);
  console.log(`  added ${added.length}, removed ${removed.length}, restored ${restored.length}, renamed ${renamed.length}`);
  for (const n of added) console.log(`    + ${n}`);
  for (const n of removed) console.log(`    - ${n} (marked removed; excluded from outputs)`);
  for (const n of restored) console.log(`    ~ ${n} (back on the site)`);
  for (const n of renamed) console.log(`    ~ ${n}`);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
