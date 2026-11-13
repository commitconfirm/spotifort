// Try the app core from the command line, with no UI:
//   npm run try -- "Phoebe Bridgers" "Zach Bryan"
//   npm run try -- "Wilco" --top 10 --spotify-file export.json     ([{ name, ids: { spotify }, weight }, ...])
//   npm run try -- "Wilco" --decay 1                               (contribution decay; default DECAY in recommend.js)
// Builds the pool the way the UI will: lineup artists become picked entries, every other name becomes a typed
// entry (and is reported when the index has nothing for it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import festival from '../festival.config.js';
import { prepareLineup } from '../src/core/lineup-index.js';
import { prepareSimilarity } from '../src/core/similarity-index.js';
import { normalizeName } from '../src/core/normalize.js';
import { addBatch, addPicked, addTyped, emptyPool } from '../src/core/pool.js';
import { matchPool } from '../src/core/match.js';
import { recommend } from '../src/core/recommend.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'public', 'data', String(festival.year));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * Build a pool the way the UI does.
 * @returns {{ pool: object, unknown: string[] }} unknown: typed names the index has nothing for
 */
export function buildPool(names, lineup, similarity) {
  let pool = emptyPool();
  const unknown = [];
  for (const name of names) {
    const hit = lineup.byKey(normalizeName(name));
    if (hit) pool = addPicked(pool, hit);
    else {
      const key = normalizeName(name);
      pool = addTyped(pool, similarity.nameFor(key) ?? name);
      if (!similarity.has(key)) unknown.push(name);
    }
  }
  return { pool, unknown };
}

export function formatReport({ pool, unknown, matches, result, limit = 30 }) {
  const out = [];
  out.push(`Pool: ${pool.entries.length} artist${pool.entries.length === 1 ? '' : 's'}`);
  if (unknown.length) out.push(`Not in the index (no similarity data): ${unknown.join(', ')}`);
  out.push('', 'Playing Treefort');
  if (!matches.length) out.push('  (none)');
  for (const m of matches) out.push(`  ${m.name}${m.confirmed ? '' : '  [unconfirmed]'}${m.unverified ? '  [lineup match unverified]' : ''}`);
  out.push('', `Recommendations (showing ${Math.min(limit, result.recommendations.length)} of ${result.recommendations.length})`);
  for (const band of ['strong', 'good', 'worth-a-listen']) {
    const rows = result.recommendations.slice(0, limit).filter((r) => r.band === band);
    if (!rows.length) continue;
    out.push(`  ${band}`);
    for (const r of rows) {
      const why = r.reasons.map((x) => `${x.name} ${x.contribution.toFixed(2)}${x.kind === 'lineup' ? ` (${x.signal})` : ''}`).join(', ');
      out.push(`    ${r.score.toFixed(2)}  ${r.name}  <- ${why}`);
    }
  }
  out.push('', 'No data');
  if (!result.noData.length) out.push('  (none)');
  for (const e of result.noData) out.push(`  Nothing at Treefort this year is close to ${e.name}`);
  return out.join('\n');
}

function main(argv) {
  const names = [];
  let spotifyFile = null;
  let top = 30;
  let decay;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--spotify-file') spotifyFile = argv[++i];
    else if (argv[i] === '--top') top = Number(argv[++i]) || 30;
    else if (argv[i] === '--decay') decay = Number(argv[++i]);
    else names.push(argv[i]);
  }
  if (!names.length && !spotifyFile) {
    console.error('usage: npm run try -- "Artist" ["Artist" ...] [--spotify-file batch.json]');
    process.exit(1);
  }
  const lineup = prepareLineup(readJson(resolve(dataDir, 'lineup.json')));
  const similarity = prepareSimilarity(readJson(resolve(dataDir, 'similarity.json')));
  let { pool, unknown } = buildPool(names, lineup, similarity);
  if (spotifyFile) pool = addBatch(pool, 'spotify:file', readJson(resolve(spotifyFile)));
  const matches = matchPool(pool, lineup);
  const result = recommend(pool, lineup, similarity, { decay });
  console.log(formatReport({ pool, unknown, matches, result, limit: top }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
