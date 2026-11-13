// File locations and I/O for state, overrides and outputs. Thin wrappers; logic lives in the other lib files.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import festival from '../../festival.config.js';
import { emptyState } from './state.js';
import { formatPretty } from './json-format.js';
import { validateOverrides } from './overrides.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const YEAR = festival.year;
export const FESTIVAL = festival;

/** Raw API answers live outside the repository (which sits in a synced folder): ~/.cache/spotifort, or $SPOTIFORT_CACHE_DIR. */
export const cacheRoot = (env = process.env) => (env.SPOTIFORT_CACHE_DIR ? resolve(env.SPOTIFORT_CACHE_DIR) : join(homedir(), '.cache', 'spotifort'));

export const paths = {
  state: join(ROOT, 'data', String(YEAR), 'state.json'),
  overrides: join(ROOT, 'data', String(YEAR), 'overrides.json'),
  review: join(ROOT, 'data', String(YEAR), 'review.md'),
  sanity: join(ROOT, 'data', String(YEAR), 'sanity.md'),
  lineupOut: join(ROOT, 'public', 'data', String(YEAR), 'lineup.json'),
  similarityOut: join(ROOT, 'public', 'data', String(YEAR), 'similarity.json'),
  cache: (name) => join(cacheRoot(), name),
};

/** Load .env.local if present. Never prints anything from it. */
export function loadEnv() {
  const p = join(ROOT, '.env.local');
  if (existsSync(p)) loadDotenv({ path: p, quiet: true });
}

/** Write atomically so an interrupted run never leaves half a file. */
export function writeFileAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function loadState() {
  if (!existsSync(paths.state)) return emptyState(YEAR);
  const state = JSON.parse(readFileSync(paths.state, 'utf8'));
  if (state.year !== YEAR) throw new Error(`${paths.state} is for ${state.year}, festival.config.js says ${YEAR}`);
  return state;
}

export function saveState(state) {
  writeFileAtomic(paths.state, formatPretty(state));
}

export function loadOverrides() {
  if (!existsSync(paths.overrides)) return {};
  const overrides = JSON.parse(readFileSync(paths.overrides, 'utf8'));
  const problems = validateOverrides(overrides);
  if (problems.length) throw new Error(`${paths.overrides} is invalid:\n  - ${problems.join('\n  - ')}`);
  return overrides;
}

export const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
