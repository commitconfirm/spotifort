/**
 * Hand corrections (data/<year>/overrides.json). Pure logic, no file I/O.
 *
 * Keyed by the festival's name for the artist. Any field present replaces the resolved value; null clears it.
 *   spotifyIds   string[]            replaces the Spotify result ([] = not on Spotify); first id is the primary
 *   mbid         string|null         MusicBrainz id
 *   lastfmName   string|null         name to ask Last.fm for; null = use no Last.fm data
 *   links        {platform: url|null}  per-platform replacement; null clears that platform
 *   ids          {tidal|appleMusic|deezer: string|null}
 *   tags         string[]            replaces the Last.fm tags
 *   unverified   true                flag the match `unverified` in lineup.json (cleared when MusicBrainz confirms it)
 *   note         string              why (free text, never used by the pipeline)
 */
import { normalizeName } from '../../src/core/normalize.js';
import { PLATFORMS, cleanPlatformUrl } from '../../src/core/link-hosts.js';

export const OVERRIDE_FIELDS = ['spotifyIds', 'mbid', 'lastfmName', 'links', 'ids', 'tags', 'unverified', 'note'];
const ID_PLATFORMS = ['tidal', 'appleMusic', 'deezer'];
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} overrides parsed overrides.json
 * @returns {string[]} problems; empty when valid
 */
export function validateOverrides(overrides) {
  if (!isObject(overrides)) return ['overrides.json must be an object keyed by artist name'];
  const problems = [];
  const seen = new Map();
  for (const [name, o] of Object.entries(overrides)) {
    const bad = (m) => problems.push(`${name}: ${m}`);
    const key = normalizeName(name);
    if (seen.has(key)) bad(`duplicates the override for "${seen.get(key)}" (same normalised name)`);
    else seen.set(key, name);
    if (!isObject(o)) {
      bad('must be an object');
      continue;
    }
    for (const f of Object.keys(o)) if (!OVERRIDE_FIELDS.includes(f)) bad(`unknown field "${f}"`);
    if ('spotifyIds' in o) {
      if (!Array.isArray(o.spotifyIds) || !o.spotifyIds.every((i) => typeof i === 'string' && SPOTIFY_ID.test(i))) {
        bad('spotifyIds must be an array of 22-character Spotify ids');
      }
    }
    if ('mbid' in o && o.mbid !== null && !(typeof o.mbid === 'string' && MBID.test(o.mbid))) bad('mbid must be a UUID or null');
    if ('lastfmName' in o && o.lastfmName !== null && !(typeof o.lastfmName === 'string' && o.lastfmName.trim())) {
      bad('lastfmName must be a non-empty string or null');
    }
    if ('links' in o) {
      if (!isObject(o.links)) bad('links must be an object');
      else {
        for (const [p, url] of Object.entries(o.links)) {
          if (!PLATFORMS.includes(p)) bad(`links: unknown platform "${p}"`);
          else if (url !== null && cleanPlatformUrl(p, url) === null) bad(`links.${p} is not an https URL on the allow-list`);
        }
      }
    }
    if ('ids' in o) {
      if (!isObject(o.ids)) bad('ids must be an object');
      else {
        for (const [p, v] of Object.entries(o.ids)) {
          if (!ID_PLATFORMS.includes(p)) bad(`ids: unknown platform "${p}"`);
          else if (v !== null && typeof v !== 'string') bad(`ids.${p} must be a string or null`);
        }
      }
    }
    if ('tags' in o && !(Array.isArray(o.tags) && o.tags.every((t) => typeof t === 'string'))) bad('tags must be an array of strings');
    if ('unverified' in o && o.unverified !== true) bad('unverified must be true (omit the field instead of setting false)');
    if ('note' in o && typeof o.note !== 'string') bad('note must be a string');
  }
  return problems;
}

/**
 * Index overrides by normalised name so a cosmetic change on the festival site still finds them.
 * @param {Record<string, object>} overrides
 * @returns {Map<string, {name: string, value: object}>}
 */
export function indexOverrides(overrides) {
  const map = new Map();
  for (const [name, value] of Object.entries(overrides ?? {})) map.set(normalizeName(name), { name, value });
  return map;
}

/**
 * @param {Map<string, {name: string, value: object}>} index from indexOverrides
 * @param {string} artistName
 * @returns {object} the override, or {} when there is none
 */
export function overrideFor(index, artistName) {
  return index.get(normalizeName(artistName))?.value ?? {};
}

/**
 * Override names that match no artist in the state (typos, or artists that left the lineup).
 * @param {Map<string, {name: string}>} index
 * @param {{name: string}[]} records every record, removed or not
 * @returns {string[]}
 */
export function unusedOverrides(index, records) {
  const used = new Set(records.map((r) => normalizeName(r.name)));
  return [...index].filter(([k]) => !used.has(k)).map(([, v]) => v.name);
}
