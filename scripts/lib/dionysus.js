/**
 * The festival app vendor's documented public API (https://dionysustickets.com/api-docs/): read-only, no
 * credentials. Pure parsing plus one orchestration function that takes an injected client, so everything is
 * testable without a network. Used by stage `source` (scripts/lineup-source.js).
 *
 *   GET <baseUrl>/festivals/<festivalId>/performers   array of performers (the lineup)
 *   GET .../venues  .../tags  .../events              the schedule groundwork
 *
 * Every field may be missing or the wrong type; a bad answer for the lineup makes the stage fall back to the
 * page scrape, and a bad answer for the schedule endpoints is only reported.
 * Volatile fields (`version`, timestamps), bios, image URLs, `trackInfo` and preview clips are never kept.
 */
import { normalizeName } from '../../src/core/normalize.js';
import { parseSocialLinks } from './festival.js';
import { MAX_SCHEDULE_EVENTS, MIN_SCRAPED_NAMES } from './constants.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** @param {{baseUrl: string, festivalId: string}} api @param {'performers'|'venues'|'tags'|'events'} endpoint */
export function apiUrl(api, endpoint) {
  return `${String(api.baseUrl).replace(/\/+$/, '')}/festivals/${encodeURIComponent(api.festivalId)}/${endpoint}`;
}

/** The lineup endpoint is final on a 200 with any JSON; other 2xx/3xx and 5xx are retried, 4xx fail. */
export const apiClassify = (status, body) => {
  if (body === null) return 'retry';
  if (status === 200) return 'ok';
  return status >= 500 ? 'retry' : 'fail';
};

/**
 * @param {unknown} body parsed JSON of /performers
 * @param {{musicTags?: string[]}} [opts]
 * @returns {{ok: false, reason: string}
 *   | {ok: true, total: number, included: {apiId: string, name: string, festival: object}[],
 *      excluded: {byStatus: Record<string, number>, byTag: {name: string, tags: string[]}[], invalid: number},
 *      excludedIds: Set<string>, duplicates: string[]}}
 * A performer is included when `status` is "published" and it has no tags or a tag whose title is in
 * `musicTags`. `included` is sorted by normalised name then id so new artist numbers do not depend on API order.
 * `festival` is the record's festival block: `{id, hometown?, spotify?, links}`.
 */
export function parsePerformers(body, { musicTags = ['Music'] } = {}) {
  if (!Array.isArray(body)) return { ok: false, reason: 'the performers answer is not a JSON array' };
  const music = new Set(musicTags.map((t) => text(t).toLowerCase()));
  const byStatus = {};
  const byTag = [];
  const excludedIds = new Set();
  const included = [];
  let invalid = 0;
  for (const p of body) {
    const id = isObject(p) ? text(p.id, 100) : '';
    const name = isObject(p) ? text(p.name) : '';
    if (!id || !name) {
      invalid++;
      continue;
    }
    const status = typeof p.status === 'string' && p.status ? p.status : 'missing';
    if (status !== 'published') {
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      excludedIds.add(id);
      continue;
    }
    const tags = (Array.isArray(p.tags) ? p.tags : []).map((t) => text(isObject(t) ? t.title : t, 60)).filter(Boolean);
    if (tags.length > 0 && !tags.some((t) => music.has(t.toLowerCase()))) {
      byTag.push({ name, tags });
      excludedIds.add(id);
      continue;
    }
    const festival = { id };
    const hometown = text(p.hometown, 120);
    if (hometown) festival.hometown = hometown;
    const { spotify, links } = parseSocialLinks(p.socialLinks, 'name');
    if (spotify) festival.spotify = spotify;
    festival.links = links;
    included.push({ apiId: id, name, festival });
  }
  included.sort((a, b) => byText(normalizeName(a.name), normalizeName(b.name)) || byText(a.apiId, b.apiId));
  byTag.sort((a, b) => byText(normalizeName(a.name), normalizeName(b.name)) || byText(a.name, b.name));
  // Two performers with the same normalised name cannot both be records; the first (lowest id) is kept.
  const seen = new Set();
  const unique = [];
  const duplicates = [];
  for (const p of included) {
    const k = normalizeName(p.name);
    if (seen.has(k)) duplicates.push(p.name);
    else {
      seen.add(k);
      unique.push(p);
    }
  }
  return {
    ok: true,
    total: body.length,
    included: unique,
    excluded: { byStatus: Object.fromEntries(Object.entries(byStatus).sort(([a], [b]) => byText(a, b))), byTag, invalid },
    excludedIds,
    duplicates,
  };
}

/** @returns {{id: string, title: string, address: string}[]|null} null when the answer is not an array; sorted by title then id */
export function parseVenues(body) {
  if (!Array.isArray(body)) return null;
  return body
    .filter((v) => isObject(v) && text(v.id, 100))
    .map((v) => ({ id: text(v.id, 100), title: text(v.title), address: text(v.address, 300) }))
    .sort((a, b) => byText(a.title.toLowerCase(), b.title.toLowerCase()) || byText(a.title, b.title) || byText(a.id, b.id));
}

/** @returns {string[]|null} tag titles, sorted */
export function parseTagTitles(body) {
  if (!Array.isArray(body)) return null;
  return body.filter(isObject).map((t) => text(t.title, 60)).filter(Boolean).sort(byText);
}

/** An ISO 8601 string as given, or a Firestore-style {seconds} object converted; '' when it is neither. */
function timeOf(v) {
  if (typeof v === 'string') return Number.isNaN(Date.parse(v)) ? '' : v.trim();
  const secs = isObject(v) ? (v.seconds ?? v._seconds) : undefined;
  return Number.isFinite(secs) ? new Date(secs * 1000).toISOString() : '';
}

/**
 * @param {unknown} body parsed JSON of /events
 * @returns {{id: string, title: string, start: string, end: string, venueId: string, performerIds: string[], canceled: boolean, status: string}[]|null}
 *   null when the answer is not an array. Only published events (or events with no status) are kept.
 */
export function parseEvents(body) {
  if (!Array.isArray(body)) return null;
  const out = [];
  for (const e of body) {
    if (!isObject(e) || !text(e.id, 100)) continue;
    const status = typeof e.status === 'string' ? e.status : '';
    if (status && status !== 'published') continue;
    out.push({
      id: text(e.id, 100),
      title: text(e.title),
      start: timeOf(e.startTime),
      end: timeOf(e.endTime),
      venueId: text(e.venueId, 100),
      performerIds: (Array.isArray(e.performerIds) ? e.performerIds : []).filter((x) => typeof x === 'string' && x).map((x) => x.slice(0, 100)),
      canceled: e.canceled === true,
      status,
    });
  }
  return out;
}

/**
 * The compact `schedule` section of the state.
 * @param {object} args
 * @param {{id: string, title: string, address: string}[]} args.venues
 * @param {ReturnType<typeof parseEvents>} args.events
 * @param {Map<string, number>} args.numberByApiId API performer id -> lineup number n
 * @returns {{venues: object[], events: object[], unknownPerformerIds: number}}
 *   events: `{id, title, start, end, venueId, performers: [n, ...], unknownPerformers?: [rawId, ...], canceled}`,
 *   sorted by start then id; `unknownPerformerIds` counts the distinct raw ids across all events.
 */
export function buildSchedule({ venues, events, numberByApiId }) {
  const unknown = new Set();
  const list = events.map((e) => {
    const performers = [];
    const raw = [];
    for (const id of e.performerIds) {
      const n = numberByApiId.get(id);
      if (n !== undefined) {
        if (!performers.includes(n)) performers.push(n);
      } else if (!raw.includes(id)) {
        raw.push(id);
        unknown.add(id);
      }
    }
    const out = { id: e.id, title: e.title, start: e.start, end: e.end, venueId: e.venueId, performers: performers.sort((a, b) => a - b) };
    if (raw.length) out.unknownPerformers = raw.sort(byText);
    out.canceled = e.canceled;
    return out;
  });
  list.sort((a, b) => byText(a.start, b.start) || byText(a.id, b.id));
  return { venues, events: list, unknownPerformerIds: unknown.size };
}

/**
 * Numbers for the performers the schedule can reference: every record that has an API id.
 * @param {{n: number, festival?: {id?: string}}[]} records
 */
export function numberByApiId(records) {
  const map = new Map();
  for (const r of records) if (r.festival?.id && !map.has(r.festival.id)) map.set(r.festival.id, r.n);
  return map;
}

/**
 * Facts about a built schedule for the review report.
 * @param {{venues: object[], events: object[], unknownPerformerIds?: number}|null|undefined} schedule
 */
export function scheduleSummary(schedule) {
  const events = schedule?.events ?? [];
  const venues = schedule?.venues ?? [];
  const venueIds = new Set(venues.map((v) => v.id));
  const starts = events.map((e) => e.start).filter(Boolean).sort(byText);
  const ends = events.map((e) => e.end || e.start).filter(Boolean).sort(byText);
  return {
    venues: venues.length,
    events: events.length,
    first: starts[0] ?? null,
    last: ends[ends.length - 1] ?? null,
    canceled: events.filter((e) => e.canceled).length,
    withUnknownPerformers: events.filter((e) => e.unknownPerformers?.length).length,
    unknownPerformerIds: schedule?.unknownPerformerIds ?? 0,
    withUnknownVenue: events.filter((e) => e.venueId && !venueIds.has(e.venueId)).length,
    withoutVenue: events.filter((e) => !e.venueId).length,
  };
}

/**
 * Fetch and parse everything for a run: one request per endpoint.
 * The performers answer is required (`performers.ok === false` carries the reason); venues, tags and events are
 * best effort and never throw: each is `{ok: true, value}` or `{ok: false, reason}`.
 * @param {{getJson: Function}} client from createClient (cache off; the lineup must always be live)
 * @param {{baseUrl: string, festivalId: string, musicTags?: string[]}} api
 * @returns {Promise<{performers: ReturnType<typeof parsePerformers>|{ok: false, reason: string}, venues: object, tags: object, events: object}>}
 */
export async function fetchDionysus(client, api) {
  const get = async (endpoint) => {
    try {
      const { body } = await client.getJson(apiUrl(api, endpoint), { classify: apiClassify });
      return { ok: true, body };
    } catch (err) {
      return { ok: false, reason: err?.message ?? String(err), requestFailed: true };
    }
  };
  const p = await get('performers');
  const performers = p.ok ? parsePerformers(p.body, { musicTags: api.musicTags }) : { ok: false, reason: p.reason };
  if (performers.ok && performers.included.length < MIN_SCRAPED_NAMES) {
    return {
      performers: { ok: false, reason: `only ${performers.included.length} performer(s) would be included (expected at least ${MIN_SCRAPED_NAMES})` },
      ...(await extras(get)),
    };
  }
  // The API is unreachable when the lineup request itself failed: do not spend three more retry cycles on the rest.
  if (p.requestFailed) {
    const skipped = { ok: false, reason: 'skipped: the performers request failed' };
    return { performers, venues: skipped, tags: skipped, events: skipped };
  }
  return { performers, ...(await extras(get)) };
}

async function extras(get) {
  const wrap = async (endpoint, parse) => {
    const r = await get(endpoint);
    if (!r.ok) return r;
    const value = parse(r.body);
    return value === null ? { ok: false, reason: `the ${endpoint} answer is not a JSON array` } : { ok: true, value };
  };
  const venues = await wrap('venues', parseVenues);
  const tags = await wrap('tags', parseTagTitles);
  let events = await wrap('events', parseEvents);
  if (events.ok && events.value.length > MAX_SCHEDULE_EVENTS) {
    events = { ok: false, reason: `${events.value.length} events is more than the ${MAX_SCHEDULE_EVENTS} limit; not stored` };
  }
  return { venues, tags, events };
}
