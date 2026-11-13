// Post-build guard: node scripts/check-dist.js  (run `npm run build` first)
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import festival from '../festival.config.js';
import { checkDist } from './lib/check-dist.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const violations = checkDist(resolve(root, 'dist'), festival.year);

if (violations.length) {
  console.error(`check-dist: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('check-dist: OK');
