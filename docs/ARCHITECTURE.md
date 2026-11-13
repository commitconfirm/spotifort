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
| **Raw API cache** | `~/.cache/spotifort/` (or `$SPOTIFORT_CACHE_DIR`), outside the repository | Pipeline only | No |
| **Public outputs** — what the site loads | `public/data/<year>/lineup.json`, `similarity.json` | Generated from state + overrides | Yes |

Outputs are committed so the Cloudflare build needs no network and no secrets. The Phase 1 file `public/lineups/<year>.json` was removed in PR 2.5, when nothing read it any more; `check-dist` fails if a `lineups/` directory ships.

### Artist record (state)

```
{
  "n": 17,                      // stable number, assigned once, never reused (share links depend on it)
  "id": "mabe-fratti-bill-orcutt",
  "name": "Mabe Fratti & Bill Orcutt",   // exactly as the festival writes it
  "firstSeen": "2026-11-13",
  "slug": "mabe-fratti-bill-orcutt",      // fallback only: the festival's own id for the artist (card data-slug); absent when the card has none
  "formerNames": ["Old Name"],            // only while an override is still keyed by a name the festival has since changed
  "festival": { "id": "0TS2…", "hometown": "Mexico City, Mexico",    // id: the vendor API's performer id (stable across renames)
                // fallback records carry "slug" and "fetched" (and keep any "id") instead of relying on the API
                "spotify": { "kind": "artist|album", "id": "…" } | { "kind": "user|playlist|track|…", "url": "…" },
                "links": { "appleMusic": "…", "bandcamp": "…", "instagram": "…" },   // one https URL per type
                "showtimes": [ … ] },                                                  // only if a short list of flat objects
  "spotify": { "ids": ["7yHf…", "49EC…"], "matchedName": "Mabe Fratti & Bill Orcutt", "confidence": "festival|exact|inexact|ambiguous|manual|none" },
  "mbid": "…" | null,                    // null = MusicBrainz was asked and does not know the Spotify id
  "links": { "spotify": "https://…", "appleMusic": "…", "tidal": "…", "deezer": "…", "bandcamp": "…", "youtube": "…", "soundcloud": "…", "lastfm": "…" },
  "lastfm": { "queriedName": "Ratboys", "resolvedName": "Ratboy", "nameChanged": "cosmetic|different|no", "listeners": 2813,
              "similar": [["Waxahatchee", 0.70], …],     // up to 250, match as number
              "tags": [["indie rock", 100], …] }          // count ≥ 10, stoplist applied
}
```

Fields the spec above leaves implicit, as built:

- Absent means "not looked up yet", never "not found": a record with no `spotify` is unresolved and is searched again; `confidence: "none"` means a search succeeded with no result. Likewise `mbid` (absent vs `null`) and `lastfm`.
- `lastfm` also carries `url`, and `notFound: true` (Last.fm error 6) or `skipped: true` (an override said use none). Last.fm data with `nameChanged: "different"` is **not used** by the build until an override confirms it (see Overrides).
- `ids` holds platform artist ids read from MusicBrainz URLs: `tidal`, `appleMusic`, `deezer`.
- `mbFor` (the Spotify id `mbid` was resolved from) and `mbFetched` (the MBID the links were read for) let the MusicBrainz stage resume and re-resolve when an id changes.
- `mbName` is the MusicBrainz artist's name, read with the links (`mbFetched` says which MBID it belongs to). The build uses it to confirm Spotify matches (see the `unverified` rule under Public outputs).
- Top level: `lastUpdated` (date any stage last changed data; also the date shown on the site), `lastScrape` (`{date, added, removed, renamed?}` for the review report; replaced when the lineup changes, and once on the first quiet later day, so unchanged data changes no file), `source` and `schedule` (below). Removed artists keep their record with `removed: "<date>"`.
- `source` says where this run's lineup came from, so the review report can say so: `{kind: "api", performers, excluded: {byStatus: {…}, byTag: [{name, tags}], unusable?}, duplicateNames?, musicTagsNotInTagList?}` or `{kind: "fallback", reason}`. It holds no date and no API `version` fields, so a rerun on unchanged data changes nothing.
- `schedule` is groundwork for the schedule feature (nothing reads it yet, and no public file exists): `{venues: [{id, title, address}], events: [{id, title, start, end, venueId, performers: [n, …], unknownPerformers?: [rawApiId, …], canceled}], unknownPerformerIds}`. Venues are sorted by title, events by start then id; performer API ids are mapped to lineup numbers through `festival.id`, ids that map to no lineup artist (comedy acts, say) stay raw in `unknownPerformers` and are counted. Only published events are kept. If the venues or events request fails the previous section is kept; it never fails the run. The review report's "Schedule" section gives the counts, the date range, and events with unknown performers or venues, so the first run after the festival publishes set times shows it.
- `festival` is the artist's links block, stored when the API run (or the feed fetch and parse) succeeded; stored when the fetch and parse succeeded; absent means "not fetched" (never "the festival has nothing"). From the API it holds `id`, `hometown`, `spotify` and `links` and nothing volatile; `bio`, image URLs, `trackInfo`, preview clips and the API's `version` are deliberately not kept (the text, pictures and clips are the festival's), nor is the feed's `music` (one Apple Music album link). Both sources go through the same link rules (`parseSocialLinks`): the API's `socialLinks` names ("Apple Music") and the feed's `type`s ("applemusic") give the same keys, and X is stored as `x`. `showtimes` (feed only, fallback) is empty for every performer today; the schedule now comes from the API's events. `festival.links` keeps every https link by type; only Apple Music, Tidal, Deezer, Bandcamp, YouTube and SoundCloud reach the public files, passing the same host allow-list and artist-page shape checks as MusicBrainz links (so SoundCloud search pages and YouTube pages that are not a channel or handle are dropped). There is no generic website link type.
- `spotify.confidence` is `festival` when the id came from the festival's own link (`spotify.via` says `artist`, or `album` with the album id in `spotify.albumId`; an album's artists, in the album's order, become `ids`, so a duo billing gets both members). A festival result replaces an earlier search result; when the ids differ the earlier result is kept in `spotify.supersedes` so the review report can show the change. `festival` counts as confirmed (never `unverified`). A festival link to a Spotify user, playlist or track is recorded (`festival.spotify.kind`) but not used. `spotify.confidence` is `exact` when the Spotify name equals the festival name after normalisation (so "&" vs "and" is exact), `inexact` when the top hit was used with no equal name, `ambiguous` when several share the name. `manual` is never stored in state: it is what an override produces in the build. Resolution order: override, festival artist link, festival album link, search.

### Overrides

Keyed by the festival's name for the artist. Any field present replaces the resolved value; `null` clears it.

```
{ "Barbara": { "spotifyIds": ["6hhm…"], "note": "owner confirmed 2026-11-13" },
  "PLAYDEAD": { "spotifyIds": ["6rZf…"], "lastfmName": null, "unverified": true, "note": "owner decision; Last.fm autocorrects to a UK goth band" } }
```

Fields: `spotifyIds`, `mbid`, `lastfmName`, `links` (per platform), `ids`, `tags`, `unverified`, `note`. `unverified: true` (the only valid value) makes the build flag the artist `unverified` in `lineup.json` even though an override fixed the Spotify id, for matches the owner accepted without proof; MusicBrainz confirmation (rule below) clears it. Renames: the festival may rename a performer (the API id stays). The artist keeps its number and data, and an override keyed by the old name keeps applying (the record remembers it in `formerNames`) until you re-key it; the review report and the build warnings say so in capitals. Once re-keyed the old name is dropped on the next run. The file is validated on every load (unknown fields, bad ids and URLs off the allow-list are errors). `lastfmName` is the name to ask Last.fm for, so confirming an autocorrect the pipeline flagged as `different` means setting `lastfmName` to the name Last.fm returned.

Owner decisions 2026-11-13 on the five Phase 1 hand-corrected "not on Spotify" artists: **JÜN** (`3hV7…`), **PLAYDEAD** (`6rZf…`) and **SOOT** (`0U98…`) take the exact-name Spotify artist, accepted but unconfirmed (could be a different act with the same name), so they carry `unverified: true`; **Fatal Femmes** and **Sautrah** stay `spotifyIds: []`, kept as not on Spotify.

Update 2026-11-13 (festival feed): the festival's own links now supply **Barbara**, **JÜN** and **Mabe Fratti & Bill Orcutt** (its album link resolves to both members), so those overrides were removed; JÜN is no longer `unverified`. The Mabe Fratti override listed Bill Orcutt first; the album lists Mabe Fratti first, so the primary id (and the legacy `spotifyId`) changed to Mabe Fratti's. **PLAYDEAD** and **SOOT** have no festival Spotify link and keep their overrides; **Fatal Femmes** (no link) and **Sautrah** (a Spotify user profile) stay as not on Spotify. The override examples above are illustrative.

The seven Phase 1 `manual: true` records migrated into this file, together with three Last.fm corrections found by the spike:

- **Ratboys** → `lastfmName: "Ratboy"`. Last.fm redirects "Ratboys" to its misspelling "Ratboy", but that page is the same band (same bio, Chicago indie rock; tags include "wrong name") and is the one holding the similar-artist and tag data. The page literally named "Ratboys" has 202k listeners and no data.
- **Sunbloc** → `lastfmName: null`. Autocorrect gives "Sunblock", a trance act. The real "Sunbloc" page (Albany NY, alt/punk, 1.7k listeners) has no similar artists or tags.
- **PLAYDEAD** → `lastfmName: null`. Autocorrect gives "Play Dead", a UK goth band. The "Playdead" page (1.8k listeners) has no data.

### Public outputs

`lineup.json` — loaded on every visit; keep under 60 KB gzip.

```
{ "year": 2027, "lastUpdated": "…",
  "artists": [ { "n", "id", "name", "spotifyIds": [], "ids": { "tidal": "…", "appleMusic": "…" }, "links": {…},
                 "tags": ["indie rock", …],            // top 5
                 "similar": [[n, score, "direct|neighbours|tags"], …],   // up to 12 other lineup artists
                 "unverified": true } ] }                // see the rule below
```

`unverified` is set when an override says `unverified: true` (an owner-accepted guess always stays flagged), or when the Spotify match came from search and is `inexact` or `ambiguous` **and MusicBrainz does not confirm it**. Confirmed means: the chosen Spotify id resolved to a MusicBrainz artist (the `mbid` was obtained from that Spotify URL, not set by an override) and that artist's name equals the festival name after normalisation. Of 2027's 21 ambiguous matches, 16 are confirmed this way and 5 still need a human look (listed in `review.md`).

`similarity.json` — lazy-loaded when the visitor starts typing or connects a library; keep under **250 KB gzip** (`BUDGET_SIMILARITY_GZIP`, shared by build and `check-dist`).

```
{ "minMatch": 0.1,                              // the cutoff the build settled on (see below)
  "names": ["Big Thief", "Waxahatchee", …],     // display names of outside artists, sorted by normalised key; also the autocomplete list
  "edges": [[17, 70, 4, 22], …] }               // per name: flat pairs of [lineup n, score × 100]
```

There is no `keys` array: the client derives each key with the shared `normalizeName` from `names` at load time. The build guarantees the normalised keys are unique and `names` is sorted by them, and `check-dist` verifies both.

Built from each lineup artist's Last.fm similar list at **limit 250**. The match cutoff is adaptive: the build starts at `REVERSE_MIN_MATCH` (0.1) and steps up the ladder 0.1, 0.12, 0.15, 0.2, 0.25, 0.3 (`REVERSE_MIN_MATCH_LADDER`) to the first cutoff whose gzipped file fits the budget, and fails with a clear message if none does. Size is measured with a fixed gzip level (9; Node writes no timestamp), so the choice is reproducible. The cutoff used is written in the file (`minMatch`) and in `review.md`. CI fails if either file exceeds its budget. Lineup artists (by any of their normalised names) and self references are excluded; names that collide after normalisation merge, keeping the higher score and its spelling.

Measured for 2027 (188 artists): cutoff 0.1, 11,005 names, 21,586 pairs, 340 KB raw, 122 KB gzip of 250 KB; `lineup.json` is 114 KB raw, 24 KB gzip of 60 KB. Headroom estimate: tripling the lineup to 564 artists with no overlap between the new artists' similar lists and the existing ones (a pessimistic case) needs cutoff 0.15 and about 211 KB gzip; at 0.1 it would be 288 KB.

## Pipeline

One command per stage, each incremental and safe to rerun. `npm run lineup` runs `source`, `spotify`, `musicbrainz`, `lastfm` and `build` in order (`festival` runs inside `source` when it falls back). A rerun with nothing new makes four requests to the vendor API (performers, venues, tags, events) and nothing else, and changes no file.

| Stage | Reads | Does | Network |
|---|---|---|---|
| `source` | the vendor API (fallback: Treefort lineup page, then `festival`) | **Primary:** `GET <api.baseUrl>/festivals/<api.festivalId>/performers` (one request, no cache, 3 attempts, 30 s timeout, generic client name), and `/venues`, `/tags`, `/events` once each. A performer is included when `status` is `published` and it has no tags or one whose title is in `api.musicTags` (default `Music`); other statuses are excluded and counted, other tags excluded and listed. Matches records by API id first, then name (so renames keep `n`, data and overrides). Stores `festival: {id, hometown, spotify, links}`, the `schedule` section and `source`. New names get the next `n`; names gone are marked `removed`, never deleted. **Falls back** (loudly, and recorded in the review report) when the request fails, the answer is not a JSON array, or fewer than 50 performers would be included: scrapes the lineup page for names and each card's `data-slug`, then runs the `festival` stage. Fails, changing nothing, if it would remove more than half the lineup (either source). `SPOTIFORT_LINEUP_SOURCE=fallback` skips the API, `=api` forbids the fallback | Vendor API (fallback: Treefort) |
| `festival` | state | **Fallback only.** The performer feed `GET <restBase><slug>` (REST base read from the lineup page's `tmfLineup` config, falling back to a constant; only an https URL on the festival's host is accepted). Fetches records with a slug and no stored answer (or a changed slug; `--refresh` re-fetches all) at most one request per 400 ms, 3 attempts, cached. Stores the Spotify link, other links and hometown (keeping the record's API `id`). A failure leaves the record unfetched and is retried; over half failing (after 10 requests) stops the stage with a warning and exit 0. Does nothing when the last source was the API | Treefort |
| `spotify` | state, overrides | Resolves in order: override, festival artist link (no call), festival album link (`GET /albums/{id}`, artists in order), search. Sets `confidence`. A failed album call is retried next run and never falls through to search. Needs no credential when there is nothing to look up (artist links need none) | Spotify |
| `musicbrainz` | state, overrides | Spotify URL → MBID → platform links and ids, 1 request/second. Only https URLs on the per-platform host allow-list are stored | MusicBrainz |
| `lastfm` | state, overrides | `getInfo`, `getSimilar` (250), `getTopTags` by name with autocorrect; classifies name changes; at most 4 requests/second | Last.fm |
| `build` | state + overrides | Applies overrides, computes lineup-to-lineup similarity, writes the two public files, `review.md` and `sanity.md` | None |

Rules that came out of Phase 1 and the spike:

- An API failure never becomes a negative fact. A record is `unresolved` until a successful call says otherwise.
- Hand corrections live only in overrides, so a full rebuild from scratch reproduces them.
- The review report (printed, and written to `data/<year>/review.md` for the scheduled pull request) lists: the lineup source used (API or fallback, with the reason) and the performers excluded by status and by tag, Spotify ids by source (override, festival artist link, festival album link, search, none), every case where the festival link differs from an earlier search result, performers whose festival Spotify link is not an artist or album page, performers with no festival link resolved by search (the weakest matches, with their confidence), festival feed failures and artists without a slug, inexact and ambiguous Spotify matches (ambiguous ones split into confirmed by MusicBrainz and needing a human look), owner-accepted unconfirmed matches, the reverse-index cutoff used, Last.fm names that changed to a different artist, artists with no similar data, artists added, removed and renamed (with a loud note when an override still has to be re-keyed), and the schedule counts.
- Retry transient non-JSON 200s from Last.fm and never cache them. Treat Last.fm `error: 6` as "not found".
- `scripts/lib/` holds pure, tested logic; the stage scripts hold only I/O. Every stage is incremental and resumable (state is saved as it goes), stops after three consecutive API failures, and never prints or caches an API key.
- Raw API answers are cached in `~/.cache/spotifort/` (override with `SPOTIFORT_CACHE_DIR`), outside the repository so a synced folder never carries it, keyed by the request without credentials, so reruns and rebuilds on one machine are free. CI starts with an empty cache and relies on state alone.

## Scoring

### Name normalisation (one function, used by pipeline and app)

Unicode NFKD → drop combining marks → lowercase → `&` becomes `and` → drop punctuation but keep all Unicode letters and digits → collapse whitespace → drop a leading `the `. When two names collide after normalisation their edges merge, keeping the higher score.

Implemented in `src/core/normalize.js`, with these precisions: only Latin/Greek/Cyrillic-style combining accents are dropped (kana dakuten and Indic vowel signs are kept, otherwise が and か collapse); a few letters NFKD leaves alone are folded (ø→o, ł→l, ß→ss, æ→ae, œ→oe, đ ð þ ı); apostrophes and dots vanish inside a word (`a.m.` = `am`) while other punctuation separates words (`Jay-Z` = `Jay Z`); and a name made only of punctuation or symbols (`!!!`) keeps its characters instead of collapsing to an empty key.

### Lineup-to-lineup similarity (build time)

For lineup artists A and B, three signals in [0, 1]:

- **direct** `d` — the higher of A→B and B→A Last.fm match.
- **neighbours** `g` — cosine similarity of their Last.fm similar lists as sparse vectors weighted by match. This is what makes the graph dense: two acts that share many similar artists are similar even if neither lists the other.
- **tags** `t` — cosine similarity of their tag vectors, weighted by inverse document frequency across the lineup, so "rock" counts for little and "shoegaze" for a lot.

Combined: `s = 1 − (1 − d)(1 − 0.7·g)(1 − 0.3·t)`. Keep the top 12 per artist with `s ≥ 0.08`, and record which signal contributed most (the largest of `d`, `0.7·g`, `0.3·t`; ties go to direct, then neighbours, then tags). IDF is `ln(1 + N/df)` over the lineup, and a tag's weight is `count/100 × idf`. All of these are named constants in `scripts/lib/constants.js` and `scripts/lib/similarity.js`.

**Tuned in PR 2.3.** The starting tag weight was 0.4. The sanity report (`data/<year>/sanity.md`, regenerated by every build) showed 49% of neighbour links dominated by tags, and artists such as Modest Mouse getting ten near-identical "indie rock" neighbours that outranked weaker but real Last.fm links. At 0.3 tag-dominated links fall to 40%, direct rise to 37% and neighbours to 23%, with the same number of isolated artists. The neighbour weight (0.7) and cutoff (0.08) were kept. Re-run the sanity report and re-tune if a later lineup changes the mix.

### Pool to lineup recommendations (run time)

The pool is a list of `{ key, name, weight, sources }`. For each lineup artist L that the visitor does not already have:

`score(L) = 1 − Π over i of (1 − c_i · DECAY^i)`, where `c_i = weight(U) · m(U, L)` sorted descending

and `m(U, L)` is the reverse-index score if U is an outside artist, or the lineup-to-lineup score if U is itself on the lineup. The product form means many weak links add up but cannot exceed 1. The contribution decay (added in PR 2.5, `DECAY = 0.7` in `src/core/recommend.js`) makes the strongest few links decide the score, so a long tail of weak links from a 1,300-artist library cannot push every result to 1.00; `DECAY = 1` is the original formula. A single link is never affected. See `docs/evaluation-2.5.md`. The reasons shown for L are the three pool artists with the largest `weight · m`.

- Show at most 30 recommendations with `score ≥ 0.1`, in three bands rather than as numbers: strong (≥ 0.5), good (≥ 0.25), worth a listen. For a pool of 100 or more artists with more than 10 strong results (a big library saturates the absolute bands even with the decay), the UI assigns bands by rank instead: the first 10 strong, the next 10 good, the rest worth a listen (`useRelativeBands` in `src/app/state.js`), and says so above the list.
- Weights: typed artist 1.0; Spotify top artist 1.0 falling linearly to 0.6 by rank; liked songs `min(1, 0.4 + 0.2·log2(1 + count))`; followed 0.7. An artist from several sources takes the highest.
- A typed artist that is neither on the lineup nor in the index gets an honest message ("nothing at Treefort this year is close to Metallica") and the tag picker.

### Matching the pool against the lineup

By platform ID where the source provides one (Spotify ID in `spotifyIds`, later Tidal and Apple IDs in `ids`). Otherwise by normalised name, shown with an "unconfirmed" marker. Typed artists picked from autocomplete match by `n` directly.

## App modules

```
src/core/      pure logic, no DOM, no fetch — all unit tested
  normalize.js        name normalisation (imported by scripts/ too)
  search.js           shared autocomplete: prefix, then word-prefix, then substring; shorter first
  similarity-index.js prepareSimilarity(json): outside artist key -> [{ n, score }], display name, search
  lineup-index.js     prepareLineup(json): by n, Spotify id, platform id, name; neighbours; search; tag counts
  pool.js             add, remove, merge sources, weights, serialise (pure functions over plain data)
  match.js            pool × lineup → matches (confirmed / unconfirmed)
  recommend.js        pool × lineup × similarity → ranked list with reasons; recommendByTags, listTags
  share.js            picks ↔ URL fragment
  links.js            URL allow-list (shared with scripts/), verified link or generated search link per platform
src/data/load.js lazy, memoised loaders for the two JSON files
src/sources/   one module per library source, same interface
  spotify.js     { id, label, isAvailable(), connect(clientId), isConnected(), fetchArtists(onProgress) → { items: [{ name, ids, weight }], songs, missing } }
src/app/state.js  pure view-model logic (no DOM): results, reasons, bands, suggestions, examples, share, diagnostics
src/ui/        rendering and events only
src/store.js   localStorage wrapper: versioned keys; pool, listen service and Client ID only, never tokens
src/auth.js    PKCE login; the access token in memory only
```

Built in PR 2.4 (everything above except `src/sources/` and `src/ui/`), with these precisions:

- **Pool entries** are `{ key, name, weight, sources, sourceWeights, ids, n? }`, unique by key. `sourceWeights` keeps each source's weight so that clearing a source can re-weight an entry; `weight` is the highest. Sources are `typed`, `picked` (a lineup artist chosen from autocomplete, carries `n`) and library ids such as `spotify:liked`. Serialised form is `{ v: 1, entries: [{ name, sw, n?, ids? }] }`; keys and weights are recomputed on load, malformed entries are dropped, and the pool is capped at 5,000 entries.
- **Matching.** A pick matches by `n`; otherwise by Spotify id (any of the lineup artist's ids), then other platform ids, then normalised name (unconfirmed). `confirmed` is true when some entry matched by pick, or by id on a record that is not `unverified`.
- **Recommendations.** Lineup artists the visitor already matched (including by name) are excluded. `noData` lists pool artists that are not on the lineup and have no reverse-index entry; a lineup artist with no neighbours is not "no data". Scores of 0.10 count despite floating-point error.
- **Share fragments** are `s=<year>.<base64url>` (the caller adds `#`); bit `n - 1` of the set is bit `(n - 1) mod 8` of byte `(n - 1) div 8`. Numbers above 24,000 and fragments over 4,096 characters are refused; unknown numbers are dropped on decode.
- **Links.** `links.js` is the one source of truth for allowed hosts (it replaces `link-hosts.js`); `bandcamp.com` itself is allowed only for `/search`.

- **Share link.** `#s=<year>.<base64url of a bitset over n>`; picks only. Because `n` is stable, links survive lineup updates.
- **Listen links.** A verified link when `links` has one; otherwise a search URL on that platform built from the name and marked as a search. Every rendered URL passes a host allow-list.
- **Persistence.** `localStorage`, never cookies (a cookie would be sent to the server on every request and the site promises none). The Spotify setup form has a "Remember my Client ID on this device" checkbox, ticked by default; unticked, the ID lives in `sessionStorage` for the tab only. The artist pool is remembered automatically, and so is the listen service. One visible "Forget my data" control clears the pool, the Client ID and the service together. Keys are `spotifort:v1:pool`, `spotifort:v1:clientId` and `spotifort:v1:service`. A stored Client ID is re-validated against the 32-hex-character pattern on every read, and a stored service against the four known values. Access and refresh tokens are never stored.
- **One HTML entry point for the app.** `/callback` is served by the same page instead of a hand-copied duplicate; the landing preview is generated from lineup data or removed.

### As built in PR 2.5 (the new experience)

- **Pages.** `src/index.html` is the only app page. A small Vite plugin (`callbackPage` in `vite.config.js`) copies the built `dist/index.html` to `dist/callback.html`, which Cloudflare Pages serves for `/callback`; the dev server serves `index.html` for `/callback` through its HTML fallback. `check-dist` verifies the two files are identical. The hard-coded "Here's what you'll see" preview is gone.
- **States.** `main.js` routes between the normal view, a read-only shared view (when `location.hash` decodes to at least one known artist; anything else is ignored) and the callback (completes the PKCE login, then imports). Data: `lineup.json` loads at once; `similarity.json` loads on the first focus, pointer-down or input in the search box, when an example chip is tapped before it has loaded, or at start-up when a saved pool exists. Until it arrives, lineup matches show and recommendations say they are loading.
- **Pool and sources.** Hand-added artists use the `typed` (outside) and `picked` (lineup, carries `n`) sources. Removing a hand-added chip removes only those sources (`removeSources` in `pool.js`), so an artist the Spotify library also holds stays in the pool. The Spotify import is one pool source, `spotify`, weighted per artist by the highest of liked-songs, top-artist and followed weights; it is shown as one summary chip with Refresh and Remove. Refresh reuses the in-memory token if there is one, otherwise logs in again with the stored Client ID.
- **Spotify import.** Liked Songs: the first page gives `total`, the rest are read 50 at a time with at most 4 requests in flight. Top artists: `medium_term` and `long_term`, 50 each. Followed: cursor paging. 401 stops the import ("login expired"); 429 waits for `Retry-After` (clamped to 1–30 s, up to 5 attempts); 5xx and network errors back off and retry; a failure of top or followed artists (e.g. 403 when a scope was not granted) is reported and the import continues. The bearer token is only sent to `https://api.spotify.com/`.
- **Autocomplete.** WAI-ARIA combobox with a listbox popup: lineup hits first (up to 4, labelled "Playing Treefort"), then outside artists, 8 in all. No debounce (one linear pass per keystroke); the result count is announced after typing pauses. Enter with no highlighted option adds an exact match; otherwise it asks the visitor to pick a suggestion, or, when nothing matches, says "We don't have data for …" and offers the genre picker. Unknown names are never added.
- **"No data" messages** are shown only for hand-added artists that the index has nothing for (in practice, ones restored from an older saved pool), never for library imports.
- **Examples.** `exampleArtists` in `festival.config.js` (injected at build time as `__EXAMPLE_ARTISTS__`). Before the similarity index loads they are checked against the lineup only, then re-checked; any that resolve to nothing are dropped. `tests/examples.test.js` and `check-dist` fail on a stale example.
- **Diagnostics.** In development builds every recompute logs its time, pool size, the number of pool artists that contributed, and the score distribution (min, median, max, count per band, whether rank bands are in use).

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

- The exact-name problem is now limited to performers without a festival Spotify link (2027: 7 of 188 have no festival artist or album link; overrides settle four of them, leaving LP Giobbi, Thomas Dollbaum and Jeffrey Lewis & The Voltage to search). For those, search by name has no second source when MusicBrainz does not know the artist; they ship flagged `unverified` only when the name match was inexact or ambiguous (and MusicBrainz does not confirm it) or an override says so, and the rest rely on the owner's review of the report. Festival links also cover search's blind spot for very common names.
- The lineup now comes from the festival app vendor's documented public API (https://dionysustickets.com/api-docs/): read-only, no credentials, versioned (`v1`). It is still a third party: the meaning of `status` and `tags`, and the festival id, are the festival's data entry. Later lineup waves add comedy, film and podcast acts; the `api.musicTags` filter keeps them out of music matching and the report lists who was excluded. If the vendor's tag titles change, the report warns when none of `musicTags` is in the festival's tag list.
- **Fallback.** If the API fails, is not a JSON array or returns under 50 included performers, the `source` stage scrapes the Treefort lineup page and the `festival` stage reads the website's performer feed. That feed is undocumented (the endpoint the lineup page's own script calls; `robots.txt` disallows only `/wp-admin/`) and can change or disappear without notice: bad answers are failures for one performer (retried), a mostly failing feed stops the stage with a warning, and the pipeline carries on with search. The fallback is covered by tests and can be forced with `SPOTIFORT_LINEUP_SOURCE=fallback`; on 2026-11-13 it produced byte-identical `lineup.json` and `similarity.json` to the API path. `npm run lineup:festival -- --refresh` re-reads everyone after a fallback run.
- `schedule` in the state is groundwork only: venues are fetched (68 for 2027), events are empty until the festival publishes set times, and nothing reads the section yet. The event shape comes from the vendor's documented `RestEvent` schema, not from a real event, so the first real events need a look at the review report's Schedule section (times are kept as the API gives them).
- A festival link is trusted as the festival's own statement, but it can be wrong (a Spotify user, album or the wrong act). Non-artist links are reported, an album resolves to its credited artists, and an override still beats the festival.
- Seven lineup artists have no Last.fm similarity and few or no tags. They can be matched but will rarely be recommended.
- Collaboration billings resolve to one member in MusicBrainz; their platform links may point at that member.
