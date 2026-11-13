#!/usr/bin/env node
/**
 * Title and body for the scheduled lineup pull request. Thin CLI over scripts/lib/pr-text.js.
 *
 *   node scripts/lineup-pr-text.js --new-state <file> --review <file> [--old-state <file>] [--old-lineup <file>]
 *        [--new-lineup <file>] [--title-file <file>] [--body-file <file>]
 *
 * Without --title-file/--body-file the title and body are printed. A missing or empty old file counts as "nothing before".
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { summarize } from './lib/pr-text.js';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const readText = (p) => (p && existsSync(p) ? readFileSync(p, 'utf8') : '');
const readJson = (p) => {
  const t = readText(p);
  return t.trim() ? JSON.parse(t) : undefined;
};

if (!opt('new-state')) {
  console.error('Usage: lineup-pr-text.js --new-state <file> [--old-state <file>] [--old-lineup <file>] [--new-lineup <file>] [--review <file>] [--title-file <file>] [--body-file <file>]');
  process.exit(2);
}

const { title, body } = summarize({
  oldState: readJson(opt('old-state')),
  newState: readJson(opt('new-state')),
  oldLineup: readJson(opt('old-lineup')),
  newLineup: readJson(opt('new-lineup')),
  review: readText(opt('review')),
});

if (opt('title-file')) writeFileSync(opt('title-file'), title + '\n');
if (opt('body-file')) writeFileSync(opt('body-file'), body + '\n');
if (!opt('title-file') && !opt('body-file')) console.log(`TITLE: ${title}\n\n${body}`);
