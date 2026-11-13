// Evaluation aid for docs/evaluation-2.5.md: the contribution decay in src/core/recommend.js compared across values.
//   node scripts/eval-decay.js [decay ...]        (default: 1 0.8 0.7 0.6 0.5)
// Runs the nine named scenarios of docs/evaluation-2.4.md and seeded synthetic libraries (300 and 1,300 outside
// artists, five seeds each, sampled the same way as scripts/eval-big-library.js) and prints one table per part.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import festival from '../festival.config.js';
import { prepareLineup } from '../src/core/lineup-index.js';
import { prepareSimilarity } from '../src/core/similarity-index.js';
import { addBatch, emptyPool, likedSongsWeight } from '../src/core/pool.js';
import { recommend } from '../src/core/recommend.js';
import { buildPool } from './try-recommend.js';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', String(festival.year));
const simJson = JSON.parse(readFileSync(resolve(dir, 'similarity.json'), 'utf8'));
const lineup = prepareLineup(JSON.parse(readFileSync(resolve(dir, 'lineup.json'), 'utf8')));
const similarity = prepareSimilarity(simJson);

const decays = process.argv.slice(2).map(Number).filter((d) => d > 0 && d <= 1);
if (!decays.length) decays.push(1, 0.8, 0.7, 0.6, 0.5);

const SCENARIOS = [
  ['1', ['Phoebe Bridgers']],
  ['2', ['Waxahatchee', 'Big Thief', 'Wilco']],
  ['3', ['Zach Bryan', 'Tyler Childers', 'Sturgill Simpson']],
  ['4', ['Turnstile', 'IDLES', 'Fontaines D.C.']],
  ['5', ['Kendrick Lamar', 'Khruangbin']],
  ['6a', ['Radiohead']],
  ['6b', ['Metallica', 'Taylor Swift']],
  ['7', ['Bully']],
  ['8', ['Modest Mouse', 'Courtney Barnett', 'Orville Peck']],
];

const bands = (recs) => ['strong', 'good', 'worth-a-listen'].map((b) => recs.filter((r) => r.band === b).length).join('/');
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

console.log('Named scenarios: results (strong/good/worth), top three scores, top three names');
for (const [id, names] of SCENARIOS) {
  const { pool } = buildPool(names, lineup, similarity);
  console.log(`\n${id}. ${names.join(', ')}`);
  for (const d of decays) {
    const { recommendations: r } = recommend(pool, lineup, similarity, { decay: d });
    const top = r.slice(0, 3);
    console.log(`  decay ${d.toFixed(2)}: ${String(r.length).padStart(2)} (${bands(r)})  ${top.map((x) => x.score.toFixed(2)).join(' ')}  ${top.map((x) => x.name).join(', ')}`);
  }
}

function syntheticPool(seed, size) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const picked = new Set();
  while (picked.size < size) picked.add(Math.floor(rand() * simJson.names.length));
  const items = [...picked].map((i) => ({ name: simJson.names[i], weight: likedSongsWeight(1 + Math.floor(Math.pow(1 / (1 - rand() * 0.97), 1.3))) }));
  return addBatch(emptyPool(), 'spotify:liked', items);
}

const degree = new Map();
for (const flat of simJson.edges) for (let j = 0; j < flat.length; j += 2) degree.set(flat[j], (degree.get(flat[j]) ?? 0) + 1);
const hubs = new Set([...degree].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 10).map(([n]) => n));
const SEEDS = [20270331, 1, 2, 3, 4];

for (const size of [300, 1300]) {
  console.log(`\nSynthetic ${size}-artist libraries, averages over seeds ${SEEDS.join(', ')} (top 30 shown)`);
  console.log('  decay | strong/good/worth | at 0.95+ | median | #10 score | #30 score | hubs top 10 | contributors');
  const pools = SEEDS.map((seed) => syntheticPool(seed, size));
  for (const d of decays) {
    const acc = { s: 0, g: 0, w: 0, hi: 0, med: 0, s10: 0, s30: 0, hubs: 0, contrib: 0 };
    for (const pool of pools) {
      const { recommendations: r, stats } = recommend(pool, lineup, similarity, { decay: d });
      acc.s += r.filter((x) => x.band === 'strong').length;
      acc.g += r.filter((x) => x.band === 'good').length;
      acc.w += r.filter((x) => x.band === 'worth-a-listen').length;
      acc.hi += r.filter((x) => x.score >= 0.95).length;
      acc.med += median(r.map((x) => x.score));
      acc.s10 += r[9]?.score ?? 0;
      acc.s30 += r[29]?.score ?? 0;
      acc.hubs += r.slice(0, 10).filter((x) => hubs.has(x.n)).length;
      acc.contrib += stats.contributors;
    }
    const k = pools.length;
    const f = (v, p = 1) => (v / k).toFixed(p);
    console.log(`  ${d.toFixed(2)}  | ${f(acc.s)}/${f(acc.g)}/${f(acc.w)} | ${f(acc.hi)} | ${f(acc.med, 2)} | ${f(acc.s10, 2)} | ${f(acc.s30, 2)} | ${f(acc.hubs)} | ${f(acc.contrib, 0)}`);
  }
}
