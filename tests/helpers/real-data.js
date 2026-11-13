import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import festival from '../../festival.config.js';
import { prepareLineup } from '../../src/core/lineup-index.js';
import { prepareSimilarity } from '../../src/core/similarity-index.js';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'data', String(festival.year));
export const lineupJson = JSON.parse(readFileSync(resolve(dir, 'lineup.json'), 'utf8'));
export const similarityJson = JSON.parse(readFileSync(resolve(dir, 'similarity.json'), 'utf8'));
export const realLineup = prepareLineup(lineupJson);
export const realSimilarity = prepareSimilarity(similarityJson);
