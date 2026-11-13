// Evaluation aid (docs/evaluation-2.4.md, scenario 9): a synthetic "big library" of 300 outside artists sampled
// deterministically from the similarity index with liked-song weights, then the top results compared with the ten
// lineup artists that have the most reverse-index edges ("hubs").   node scripts/eval-big-library.js [seed] [size] [decay]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import festival from '../festival.config.js';
import { prepareLineup } from '../src/core/lineup-index.js';
import { prepareSimilarity } from '../src/core/similarity-index.js';
import { addBatch, emptyPool, likedSongsWeight } from '../src/core/pool.js';
import { recommend } from '../src/core/recommend.js';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', String(festival.year));
const lineupJson = JSON.parse(readFileSync(resolve(dir, 'lineup.json'), 'utf8'));
const simJson = JSON.parse(readFileSync(resolve(dir, 'similarity.json'), 'utf8'));
const lineup = prepareLineup(lineupJson);
const similarity = prepareSimilarity(simJson);

let seed = Number(process.argv[2]) || 20270331;
const size = Number(process.argv[3]) || 300;
const decay = process.argv[4] === undefined ? undefined : Number(process.argv[4]);
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); // small seeded LCG

const picked = new Set();
while (picked.size < size) picked.add(Math.floor(rand() * simJson.names.length));
// Liked-song counts: mostly 1-3, a long tail
const items = [...picked].map((i) => ({ name: simJson.names[i], weight: likedSongsWeight(1 + Math.floor(Math.pow(1 / (1 - rand() * 0.97), 1.3))) }));
const pool = addBatch(emptyPool(), 'spotify:liked', items);

const degree = new Map();
for (const flat of simJson.edges) for (let j = 0; j < flat.length; j += 2) degree.set(flat[j], (degree.get(flat[j]) ?? 0) + 1);
const hubs = [...degree].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 10).map(([n]) => n);

const { recommendations } = recommend(pool, lineup, similarity, { decay });
console.log(`Pool: ${pool.entries.length} outside artists (seed ${process.argv[2] || 20270331}); ${recommendations.length} recommendations`);
console.log(`Ten highest-degree lineup artists: ${hubs.map((n) => `${lineup.byN(n).name} (${degree.get(n)})`).join(', ')}`);
console.log('\nTop 10');
for (const r of recommendations.slice(0, 10)) {
  const why = r.reasons.map((x) => `${x.name} ${x.contribution.toFixed(2)}`).join(', ');
  console.log(`  ${r.score.toFixed(2)}  ${r.name}${hubs.includes(r.n) ? '  [hub]' : ''}  (edges: ${degree.get(r.n) ?? 0})  <- ${why}`);
}
console.log(`\nHubs in top 10: ${recommendations.slice(0, 10).filter((r) => hubs.includes(r.n)).length} of 10; in all ${Math.min(30, recommendations.length)} results: ${recommendations.filter((r) => hubs.includes(r.n)).length}`);
console.log(`Top ${Math.min(30, recommendations.length)} scores: ${recommendations.map((r) => r.score.toFixed(2)).join(' ')}`);
