// Post-build guard: node scripts/check-dist.js  (run `npm run build` first)
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import festival from '../festival.config.js';
import { existsSync, readFileSync } from 'node:fs';
import { checkDist, dataSizes } from './lib/check-dist.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const violations = checkDist(resolve(root, 'dist'), festival.year);

if (violations.length) {
  console.error(`check-dist: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('check-dist: OK');

const read = (name) => {
  const p = resolve(root, 'dist', 'data', String(festival.year), name);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};
const sizes = dataSizes(read('lineup.json'), read('similarity.json'));
for (const [name, s] of Object.entries(sizes)) {
  if (s) console.log(`  data/${festival.year}/${name}.json: ${(s.raw / 1024).toFixed(1)} KB raw, ${(s.gzip / 1024).toFixed(1)} KB gzip (budget ${(s.budget / 1024).toFixed(0)} KB)`);
}
