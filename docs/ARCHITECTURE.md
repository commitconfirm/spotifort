# Spotifort — Phase 2 Architecture

Written 2026-11-13 from the measurements in "What the data looks like" below. `docs/PLAN-2027.md` says *what* is being built and in which pull request; this file says *how*. Change this file in the same pull request as any change that departs from it.

## Goals

1. A visitor with no account types a few artists and gets ranked Treefort recommendations with reasons.
2. Every library source (typed artists, Spotify, later Tidal and Apple Music) feeds one artist pool, and results always come from the whole pool.
3. Everything a visitor needs is static JSON generated ahead of time. No visitor data leaves the browser except to the platform they connect.
4. Next year is a config change and a data run.

## What the data looks like (spike, 188 artists, 2026-11-13)

| Finding | Number | Consequence |
|---|---|---|
| Last.fm knows the lineup | 188/188 resolve; 175 have 100+ similar artists; 7 have none (all under 100 listeners) | Last.fm is the similarity source; a tag fallback is still needed for the smallest acts |
| Last.fm autocorrect picks the wrong artist | 3 of 188 (Ratboys, Sunbloc, PLAYDEAD) | Store the resolved name, flag non-cosmetic changes, allow an override |
| Looking up Last.fm by MusicBrainz ID is worse than by name | 28/136 not found; 1 wrong artist | Key Last.fm by name |
| Direct lineup-to-lineup links are sparse | median 3 other lineup artists; 32 artists have none | Lineup-to-lineup similarity needs more than direct links (see Scoring) |
| Outside artists that reach the lineup | 21,384 at limit 250; 11,260 with match ≥ 0.1 (416 KB raw, 143 KB gzip) | A static reverse index is small enough to ship |
| Well-known artists reach the lineup | 25 of 30 tested are in the index; the static index found as many or more lineup hits than a live lookup | The static index is the product; a live lookup adds little |
| Mega-acts with no neighbours on the lineup | Taylor Swift, Metallica, The Beatles, Bad Bunny, Billie Eilish: 0 hits statically and live | Say so honestly; offer tags as a loose fallback |
| MusicBrainz resolves Spotify IDs | 136/183; of those Apple Music 121, Deezer 116, Tidal 103, Bandcamp 91, YouTube 74 | Verified listen links for roughly 55–65% of the lineup; search links for the rest |
| Last.fm tags | 161/188 have at least one tag with count ≥ 10; median 4 usable tags | Tags are the fallback signal, never the primary one |
| Name hygiene | 59 lists contain "&"/"and" or case duplicates; 233 distinct non-Latin names | One shared normaliser, Unicode-safe |

## Data

### Two kinds of files

| | Location | Edited by | Committed |
|---|---|---|---|
| **Overrides** — hand corrections | `data/<year>/overrides.json` | The owner, by hand | Yes |
| **State** — everything the pipeline has resolved | `data/<year>/state.json` | Pipeline only | Yes |
| **Raw API cache** | `.cache/` | Pipeline only | No (gitignored) |
| **Public outputs** — what the site loads | `public/data/<year>/lineup.json`, `similarity.json` | Generated from state + overrides | Yes |

Outputs are committed so the Cloudflare build needs no network and no secrets. `public/lineups/<year>.json` (the Phase 1 format) stays until the new experience ships, then is removed.

### Artist record (state)

```
{
  "n": 17,                      // stable number, assigned once, never reused (share links depend on it)
  "id": "mabe-fratti-bill-orcutt",
  "name": "Mabe Fratti & Bill Orcutt",   // exactly as the festival writes it
  "firstSeen": "2026-11-13",
  "spotify": { "ids": ["49EC…", "7yHf…"], "matchedName": "Bill Orcutt", "confidence": "exact|inexact|ambiguous|manual|none" },
  "mbid": "…" | null,
  "links": { "spotify": "https://…", "appleMusic": "…", "tidal": "…", "deezer": "…", "bandcamp": "…", "youtube": "…", "soundcloud": "…", "lastfm": "…" },
  "lastfm": { "queriedName": "Ratboys", "resolvedName": "Ratboy", "nameChanged": "cosmetic|different|no", "listeners": 2813,
              "similar": [["Waxahatchee", 0.70], …],     // up to 250, match as number
              "tags": [["indie rock", 100], …] }          // count ≥ 10, stoplist applied
}
```

### Overrides

Keyed by the festival's name for the artist. Any field present replaces the resolved value; `null` clears it.

```
{ "Barbara": { "spotifyIds": ["6hhm…"], "note": "owner confirmed 2026-11-13" },
  "PLAYDEAD": { "spotifyIds": [], "lastfmName": null, "note": "not on Spotify; Last.fm autocorrects to a UK goth band" } }
```

The seven Phase 1 `manual: true` records migrate into this file.

### Public outputs

`lineup.json` — loaded on every visit; keep under 60 KB gzip.

```
{ "year": 2027, "lastUpdated": "…",
  "artists": [ { "n", "id", "name", "spotifyIds": [], "ids": { "tidal": "…", "appleMusic": "…" }, "links": {…},
                 "tags": ["indie rock", …],            // top 5
                 "similar": [[n, score, "direct|neighbours|tags"], …],   // up to 12 other lineup artists
                 "unverified": true } ] }                // set when Spotify confidence is inexact or ambiguous
```

`similarity.json` — lazy-loaded when the visitor starts typing or connects a library; keep under 200 KB gzip.

```
{ "names": ["Big Thief", "Waxahatchee", …],     // display names of outside artists, sorted; this is also the autocomplete list
  "keys":  ["big thief", "waxahatchee", …],     // normalised form, same order
  "edges": [[17, 70, 4, 22], …] }               // per name: flat pairs of [lineup n, score × 100]
```

Built from each lineup artist's Last.fm similar list at **limit 250, match ≥ 0.1**. Both values are named constants in the pipeline; CI fails if either file exceeds its size budget.

## Pipeline

One command per stage, each incremental and safe to rerun. `npm run lineup` runs them in order.

| Stage | Reads | Does | Network |
|---|---|---|---|
| `scrape` | Treefort lineup page | New names get a record and the next `n`; names gone from the page are reported and marked `removed`, never deleted | Treefort |
| `spotify` | state | Spotify search for records with no Spotify result; sets `confidence` | Spotify |
| `musicbrainz` | state | Spotify URL → MBID → platform links, 1 request/second | MusicBrainz |
| `lastfm` | state | `getInfo`, `getSimilar` (250), `getTopTags` by name with autocorrect; classifies name changes | Last.fm |
| `build` | state + overrides | Applies overrides, computes lineup-to-lineup similarity, writes the two public files and a review report | None |

Rules that came out of Phase 1 and the spike:

- An API failure never becomes a negative fact. A record is `unresolved` until a successful call says otherwise.
- Hand corrections live only in overrides, so a full rebuild from scratch reproduces them.
- The review report (printed, and written to `data/<year>/review.md` for the scheduled pull request) lists: inexact and ambiguous Spotify matches, Last.fm names that changed to a different artist, artists with no similar data, artists added and removed.
- Retry transient non-JSON 200s from Last.fm and never cache them. Treat Last.fm `error: 6` as "not found".
- `scripts/lib/` holds pure, tested logic; the stage scripts hold only I/O.

## Scoring

### Name normalisation (one function, used by pipeline and app)

Unicode NFKD → drop combining marks → lowercase → `&` becomes `and` → drop punctuation but keep all Unicode letters and digits → collapse whitespace → drop a leading `the `. When two names collide after normalisation their edges merge, keeping the higher score.

### Lineup-to-lineup similarity (build time)

For lineup artists A and B, three signals in [0, 1]:

- **direct** `d` — the higher of A→B and B→A Last.fm match.
- **neighbours** `g` — cosine similarity of their Last.fm similar lists as sparse vectors weighted by match. This is what makes the graph dense: two acts that share many similar artists are similar even if neither lists the other.
- **tags** `t` — cosine similarity of their tag vectors, weighted by inverse document frequency across the lineup, so "rock" counts for little and "shoegaze" for a lot.

Combined: `s = 1 − (1 − d)(1 − 0.7·g)(1 − 0.4·t)`. Keep the top 12 per artist with `s ≥ 0.08`, and record which signal contributed most. The weights are starting values: the pipeline pull request must include a printed sanity report (twenty hand-picked pairs, and the count of artists with fewer than three neighbours) and tune them if the report looks wrong.

### Pool to lineup recommendations (run time)

The pool is a list of `{ key, name, weight, sources }`. For each lineup artist L that the visitor does not already have:

`score(L) = 1 − Π over pool artists U of (1 − weight(U) · m(U, L))`

where `m(U, L)` is the reverse-index score if U is an outside artist, or the lineup-to-lineup score if U is itself on the lineup. The product form means many weak links add up but cannot exceed 1, so a 1,300-artist library does not drown out strong single links. The reasons shown for L are the three pool artists with the largest `weight · m`.

- Show at most 30 recommendations with `score ≥ 0.1`, in three bands rather than as numbers: strong (≥ 0.5), good (≥ 0.25), worth a listen.
- Weights: typed artist 1.0; Spotify top artist 1.0 falling linearly to 0.6 by rank; liked songs `min(1, 0.4 + 0.2·log2(1 + count))`; followed 0.7. An artist from several sources takes the highest.
- A typed artist that is neither on the lineup nor in the index gets an honest message ("nothing at Treefort this year is close to Metallica") and the tag picker.

### Matching the pool against the lineup

By platform ID where the source provides one (Spotify ID in `spotifyIds`, later Tidal and Apple IDs in `ids`). Otherwise by normalised name, shown with an "unconfirmed" marker. Typed artists picked from autocomplete match by `n` directly.

## App modules

```
src/core/      pure logic, no DOM, no fetch — all unit tested
  normalize.js   name normalisation (imported by scripts/ too)
  pool.js        add, remove, merge sources, serialise
  match.js       pool × lineup → matches (confirmed / unconfirmed)
  recommend.js   pool × lineup × similarity → ranked list with reasons
  share.js       picks ↔ URL fragment
  links.js       verified link or generated search link per platform; URL allow-list
src/data/      lazy loaders for the two JSON files
src/sources/   one module per library source, same interface
  spotify.js     { id, label, isAvailable(), connect(), fetchArtists(onProgress) → [{ name, ids, weight }] }
src/ui/        rendering and events only
src/store.js   localStorage wrapper: versioned keys, pool and Client ID only, never tokens
```

- **Share link.** `#s=<year>.<base64url of a bitset over n>`; picks only. Because `n` is stable, links survive lineup updates.
- **Listen links.** A verified link when `links` has one; otherwise a search URL on that platform built from the name and marked as a search. Every rendered URL passes a host allow-list.
- **Persistence.** `spotifort:v1:pool` and `spotifort:v1:clientId`. A "clear my data" control removes both.
- **One HTML entry point for the app.** `/callback` is served by the same page instead of a hand-copied duplicate; the landing preview is generated from lineup data or removed.

## Live lookup — reduced role

The design interview chose "precomputed plus live". The spike shows the live part adds little: for artists missing from the static index, a live Last.fm similar lookup found zero lineup artists in every case tested, and for artists in the index the static data found as many or more. So:

- The new experience ships **fully static** and must be complete without any server call.
- The Pages Function comes afterwards as an enhancement with one job: for a typed name that is not in the index, return Last.fm's corrected name and top tags, so the tag fallback works for any artist rather than only via the picker. It is stateless, rate-limited, caches by artist name only, and can be dropped without harming anything else.

## Constraints carried through

- **Privacy.** No visitor data is stored or logged server-side. The static experience makes no third-party requests at all; connecting Spotify talks only to Spotify. Site copy says "nothing stored", and names the Last.fm lookup once the function exists.
- **Security.** The Content-Security-Policy stays `script-src 'self'; style-src 'self'; connect-src 'self'` plus Spotify. All data-derived text goes through `escapeHtml`; all data-derived URLs through the allow-list. `scripts/check-dist.js` enforces this on every pull request, and gains the size budgets above.
- **Licences.** Last.fm data is used non-commercially with a visible credit and a link to each artist's Last.fm page. MusicBrainz core data is CC0.
- **Dependencies.** No runtime dependencies in the shipped bundle.

## Known gaps

- Exact-name Spotify matches for small acts have no second source to confirm them when MusicBrainz does not know the artist (47 of 183). They ship flagged `unverified` only when the name match was inexact or ambiguous; the rest rely on the owner's review of the report.
- Seven lineup artists have no Last.fm similarity and few or no tags. They can be matched but will rarely be recommended.
- Collaboration billings resolve to one member in MusicBrainz; their platform links may point at that member.
