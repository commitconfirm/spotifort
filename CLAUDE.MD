# CLAUDE.md — Spotifort Project Brief

## Project Overview

**Spotifort** is a client-side web application that tells a visitor who to see at Treefort Music Fest 2027 (March 31 – April 4, 2027, Boise, Idaho; year and dates live only in `festival.config.js`). With no account, the visitor types artists they like; optionally they connect their Spotify library. The app lists the lineup artists they already like ("Playing Treefort") and recommends other lineup artists from Last.fm similar-artist data ("Recommended for you"), with reasons and listen links.

- **Live site:** https://spotifort.com
- **Repo:** https://github.com/commitconfirm/spotifort
- **2027 plan — read first:** `docs/PLAN-2027.md` is the source of truth for decisions, phases, working rules and status. It wins where this file disagrees. `main` is protected: all work, including docs, lands through a pull request.

## Architecture & Constraints

### Client-Side Only — No Backend

This is a **privacy-first** application. All processing happens in the browser. There is no backend, no database, no cookies, and no advertising or cross-site tracking. Anonymous, cookieless page-visit counts come from Cloudflare Web Analytics (injected at the edge by Cloudflare Pages, not in the repo or `dist/`). Spotify data never leaves the browser. The Spotify access token lives in a JS variable in memory (`src/auth.js`) and is never written to any storage API. The PKCE verifier and the OAuth `state` are kept in sessionStorage (they must survive the redirect to Spotify). `src/store.js` is the only module that persists anything, in localStorage under versioned keys: the artist pool (`spotifort:v1:pool`), the listen service (`spotifort:v1:service`), and the Client ID (`spotifort:v1:clientId`, localStorage only when "Remember my Client ID on this device" is ticked, otherwise sessionStorage). "Forget my data" clears all of it.

### Spotify API — PKCE Auth Flow

- **Auth method:** Authorization Code with PKCE (no client secret)
- **Scopes requested:** `user-library-read user-top-read user-follow-read` (Liked Songs, top artists, followed artists). If top or followed fails (e.g. a 403), the import continues without it and says so.
- **Dev redirect URI:** `http://127.0.0.1:9090/callback`
- **Prod redirect URI:** `https://spotifort.com/callback`
- **Client ID:** each visitor brings their own (BYOCID). For local development only, `.env.local` may set `VITE_SPOTIFY_CLIENT_ID` (not committed; never used in a production build)

### Spotify API Restrictions (February 2026 Dev Mode Changes)

This app was created after February 11, 2026 and is subject to the new Dev Mode restrictions. The app owner must have Spotify Premium. Each developer gets one Client ID with a maximum of 5 authorized users.

**Endpoints confirmed WORKING for this project:**

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /me/tracks` | Fetch user's Liked Songs | Paginated, 50/request. Core matching feature. |
| `GET /me/top/{type}` | User's top artists | `user-top-read`; medium_term and long_term, 50 each. Part of the library import. |
| `GET /me/following` | User's followed artists | `user-follow-read`; `type=artist`, cursor paging (`artists.cursors.after`), 50/page. Part of the library import. |
| `GET /artists/{id}` | Individual artist metadata + genres | Works one at a time. Batch endpoint is blocked. |
| `GET /artists/{id}/albums` | Artist's albums | Available but not currently used. |
| `GET /search` | Search artists/tracks by name | Used by lineup script to find Spotify IDs. |
| `GET /me/playlists` | User's own playlists | Available but not currently used. |
| `GET /me` | Current user profile | Available but not currently used. |
| `GET /tracks/{id}` | Individual track metadata | Available but not currently used. |

**Endpoints confirmed BLOCKED (403) for new Dev Mode apps:**

| Endpoint | Would have been used for |
|----------|--------------------------|
| `GET /artists` (batch) | Fetching genres for all lineup artists at once |
| `GET /artists/{id}/related-artists` | Similar artist recommendations |
| `GET /artists/{id}/top-tracks` | Artist preview/discovery |
| `GET /tracks` (batch) | Bulk track metadata |
| `GET /recommendations` | Music recommendations |
| `GET /audio-features` | Track analysis |
| `GET /playlists/{id}/tracks` (others' playlists) | Reading the Treefort Spotify playlist |
| `GET /users/{user_id}/playlists` | Other users' playlists |
| `GET /browse/featured-playlists` | Browse features |

**Removed response fields (across all endpoints):** `popularity`, `followers`, `available_markets`, `email`, `country`.

**Note on `external_ids`:** These were briefly removed in February 2026 but reverted in the March 2026 changelog and remain available.

### Why BYOCID (Bring Your Own Client ID) Is Required for Public Use

Dev Mode limits each app to 5 authorized users. Extended Quota Mode requires a registered business entity, 250K MAU, and Spotify approval — not available to individual developers. The only viable path for public use is having each user create their own Spotify Developer app and enter their Client ID. Each user becomes user #1 on their own app, sidestepping the 5-user limit. This does require users to have Spotify Premium.

### Treefort Lineup Data

The lineup is built by a staged pipeline (Pipeline v2; design in `docs/ARCHITECTURE.md`). Year, dates and the festival's API id come from `festival.config.js` (next year: change those three). The Treefort Spotify playlist cannot be read by new Dev Mode apps, so names and links come from the festival app vendor's documented public API and everything else is looked up per artist:

1. `source` (`npm run lineup:source`): the lineup from the vendor's API (`https://admin.dionysustickets.com/api/v1/festivals/<festivalId>/performers`; documented at dionysustickets.com/api-docs, read-only, no credentials). Published performers with no tag or a tag in `api.musicTags` (default `Music`) become artists; other statuses and non-music tags are excluded and listed in the review report. Each artist gets a stable number `n`; a performer renamed by the festival is matched by its API id and keeps it. Stores the Spotify link the festival chose, other links and hometown, plus venues and events as a `schedule` section (groundwork; no UI yet). **Fallback:** if the API fails, is not a JSON array or yields under 50 performers, the stage scrapes the lineup page (`lineupUrl`) for names and then runs `festival`; the review report says which source was used. `SPOTIFORT_LINEUP_SOURCE=fallback|api` forces one.
2. `festival` (fallback only; `npm run lineup:festival`): the festival's own performer feed (`GET /wp-json/tmf/v1/performer/<slug>`, undocumented, no auth; REST base read from the lineup page's `tmfLineup` config). Stores the Spotify link the festival chose, other links and hometown. A failed fetch is retried next run; if over half fail the stage stops with a warning and exits 0.
3. `spotify`: Spotify id by override, then the festival's artist link, then its album link (resolved through `GET /albums/{id}`), then Search. Confidence `festival` counts as confirmed; search gives `exact`, `inexact`, `ambiguous`.
4. `musicbrainz`: Spotify URL to MusicBrainz ID to verified links (Apple Music, Tidal, Deezer, Bandcamp, YouTube, SoundCloud, Last.fm) and platform ids.
5. `lastfm`: similar artists, tags and listener counts by name.
6. `build`: state + overrides to the static outputs.

Files:
- `data/<year>/state.json`: everything the pipeline resolved (committed, pipeline-only)
- `data/<year>/overrides.json`: hand corrections, always respected (Spotify ids, Last.fm name, links, tags)
- `data/<year>/review.md`, `sanity.md`: reports from the build
- `public/data/<year>/lineup.json`, `similarity.json`: what the site loads (committed; size budgets 60 KB / 250 KB gzip, enforced by `check:dist`). `lineup.json` loads on every visit; `similarity.json` only on the first interaction with the search box, or when a saved pool exists
- `.cache/`: raw API responses (gitignored)

Matching is by platform ID (Spotify ID for a library import), by lineup number for an artist picked from autocomplete, and only otherwise by normalised name (shown as "unconfirmed"). The `[+]` expansion uses each artist's `similar` list in `lineup.json`.

**To update the lineup:**
```bash
npm run lineup               # all stages in order; a rerun with nothing new makes four API requests and changes no file
npm run lineup:source        # one stage at a time: source | festival (fallback only) | spotify | musicbrainz | lastfm | build
npm run lineup:festival -- --refresh   # re-fetch every performer (when the festival may have corrected links)
```
Each stage is incremental and resumable. An API failure never becomes a negative fact (the artist stays unresolved and is retried); a stage stops after 3 consecutive failures. Artists gone from the lineup are marked `removed` in state and excluded from outputs. Credentials in `.env.local` (see `.env.local.example`): `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` (else `SPOTIFY_ACCESS_TOKEN`, else a hidden prompt) and `LASTFM_API_KEY`. MusicBrainz needs none and runs at 1 request per second. Pure logic is in `scripts/lib/`; fix a wrong match by adding an entry to `overrides.json` and running `npm run lineup:build`. The name normaliser `src/core/normalize.js` is shared with the app.

**Scheduled run:** `.github/workflows/lineup.yml` runs `npm run lineup` twice daily (14:17 and 02:43 UTC) and `workflow_dispatch`, on `main` only, with secrets `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `LASTFM_API_KEY` (missing: the job ends green with a notice). On a change it runs tests, build and `check-dist`, force-pushes branch `lineup-update` (fresh from `main`), opens or updates the PR (text from `scripts/lineup-pr-text.js`), and dispatches `ci.yml` on the branch because pushes made with `GITHUB_TOKEN` do not trigger `pull_request` runs. Never commit to `lineup-update` by hand: it is rebuilt each run.

## Tech Stack

- **Language:** Vanilla JavaScript (no TypeScript, no framework)
- **Build tool:** Vite 8 (`build.rolldownOptions`); tests: Vitest (`npm test`)
- **Security headers:** `public/_headers` (strict CSP: no inline scripts, handlers or `style=` attributes anywhere in `src/`; `script-src` allows only `'self'` and `https://static.cloudflareinsights.com/beacon.min.js` for the Cloudflare Web Analytics beacon, which Cloudflare injects at the edge; `connect-src` additionally allows `https://cloudflareinsights.com`, where the beacon posts its reports — Cloudflare's docs say same-origin `/cdn-cgi/rum`, but on this project the beacon was observed posting to `cloudflareinsights.com/cdn-cgi/rum`)
- **Styling:** Plain CSS (no Tailwind, no CSS framework)
- **Font:** Ubuntu (self-hosted via `@fontsource/ubuntu`, weight 700 only) for headings, bold; system sans-serif for body
- **Hosting:** Cloudflare Pages (auto-deploy from `main` branch)
- **Domain:** spotifort.com (purchased on Cloudflare)
- **Dev server port:** 9090 (configure in `vite.config.js`)

## Project Structure

```
spotifort/
├── public/
│   ├── data/<year>/             # lineup.json, similarity.json (generated by the pipeline)
│   └── _headers                 # Security headers and CSP for Cloudflare Pages
├── data/<year>/                 # state.json, overrides.json, review.md, sanity.md
├── festival.config.js           # Festival year, dates, API festival id and music tags, fallback lineup URL, example artists for the "Try:" chips
├── scripts/
│   ├── lineup-{source,festival,spotify,musicbrainz,lastfm,build}.js   # Pipeline stages (I/O only)
│   ├── try-recommend.js, eval-*.js                          # Engine from the command line, evaluations
│   └── lib/                     # Pure, tested pipeline logic and check-dist
├── src/
│   ├── index.html               # The app page (the build copies it to callback.html for /callback)
│   ├── main.js                  # Bootstrap and orchestration (normal / shared / callback states)
│   ├── app/state.js             # Pure view-model logic: results, reasons, bands, suggestions, share, diagnostics
│   ├── core/                    # Pure engine: normalize, pool, match, recommend, share, links, search, indexes
│   ├── data/load.js             # Memoised loaders for the two data files
│   ├── sources/spotify.js       # Spotify library source (paging, retries, weights; injected fetch)
│   ├── ui/                      # Rendering and events only (combobox, rows, results, pool, genre, share, service picker)
│   ├── auth.js                  # Spotify PKCE flow; token in memory only
│   ├── store.js                 # The only persistence: pool, service, Client ID
│   ├── log.js                   # Dev-only logging
│   ├── lineup.html / lineup.js  # /lineup transparency page
│   ├── setup.html / setup.js    # /setup guide for the Spotify Client ID
│   ├── why.html, 404.html       # /why, not-found page
│   └── style.css                # All styles
├── tests/                       # Vitest
├── docs/                        # PLAN-2027.md, ARCHITECTURE.md, evaluations
├── .env.local                   # Pipeline credentials; optional VITE_SPOTIFY_CLIENT_ID for dev (gitignored)
├── CLAUDE.md
├── LICENSE                      # MIT
├── README.md
├── package.json
└── vite.config.js
```

## Current Feature Set (MVP)

### User Flow

1. Visitor lands on spotifort.com: "Who should you see at Treefort 2027?", one search box, "Try:" example chips, "or connect your Spotify library", "or browse by genre"
2. Typing shows autocomplete over lineup artists (marked "Playing Treefort") and ~11,000 outside artists from the similarity index (WAI-ARIA combobox). Picking one adds it to **My artists** (the pool). A name we have no data for is not added; the visitor is offered the genre picker
3. Results recompute on every change: **Playing Treefort** (lineup artists already in the pool, "unconfirmed" when matched by name or to an unverified record) and **Recommended for you** (grouped Strong match / Good match / Worth a listen, each with a "because you like …" reason)
4. Each row has a listen link for the chosen service ("I listen on: Spotify / Apple Music / Tidal / Bandcamp"; a search link when no verified link exists), a "more" control for the other services, and `[+]`
5. The pool is saved on the device and restored on return. "Share my picks" copies a `#s=` link with the Treefort picks only; opening one shows a read-only "Shared picks" view with "Find your own"
6. Optional Spotify: the visitor pastes their own Client ID (remembered on the device if they choose), logs in with PKCE, returns to /callback, and the app imports Liked Songs (parallel pages, progress shown), top artists and followed artists as one pool source, shown as one summary chip ("Spotify library · 1,341 artists") with Refresh and Remove
7. "Forget my data" (near the pool and in the footer) clears the pool, Client ID and service preference

### [+] Expansion Feature

`[+]` on any artist row (a button with `aria-expanded`) shows the other lineup artists in that artist's `similar` list in `lineup.json`, labelled "similar listeners" (direct or neighbour signal) or "similar tags", each with its own listen link. No runtime API calls.

### Lineup Transparency Page

/lineup lists every lineup artist with a listen link for the chosen service, its tags, an "unverified" marker, its Last.fm page link (Last.fm attribution), the last-updated date, and the data-sourcing methodology with MusicBrainz and Last.fm credits.

### UI Design

- **Color scheme:** Black and white only
- **Typography:** Ubuntu font (self-hosted), bold, for all headings/titles. System sans-serif for body.
- **Layout:** Two-column on desktop (CSS Grid or Flexbox), single column stacked on mobile. Breakpoint ~768px.
- **Lists:** Displayed in boxes with thick black borders
- **List items:** Each artist is a row with `[+]` as a collapsible toggle for similar lineup artists
- **Accessibility:** semantic landmarks and headings, visible focus, keyboard operable, 44px touch targets, `aria-live` announcements when results change, `prefers-reduced-motion` respected

### Required Disclaimers (visible on the page)

- "Not affiliated with, endorsed by, or associated with Treefort Music Fest or Spotify"
- "Privacy: your Spotify data stays in your browser. Page visits are counted with Cloudflare Web Analytics, which uses no cookies and does not identify you." (linked to https://www.cloudflare.com/web-analytics/)
- "Lineup data last updated: [date from lineup.json]"
- "Similar-artist data from Last.fm" (main page footer) and each artist's Last.fm link on /lineup
- "Use at your own risk — no guarantees of accuracy"
- "FOSS — MIT License" with link to repo
- "Built with Claude Code" with link
- Spotify logo/attribution per their branding requirements

## Logging

Use a simple logging utility gated on `import.meta.env.DEV`:

```javascript
const log = {
  info: (...args) => import.meta.env.DEV && console.log('[spotifort]', ...args),
  warn: (...args) => import.meta.env.DEV && console.warn('[spotifort]', ...args),
  error: (...args) => console.error('[spotifort]', ...args), // errors always log
};
```

Verbose logging in dev (auth flow steps, API call counts, match results). Silent in production except for errors.

## Future Enhancements (NOT in current scope)

These are tracked in `docs/PLAN-2027.md` and should NOT be built without a decision there:

- **Tidal** source (proof of concept first), as a sibling of `src/sources/spotify.js`
- **Live Last.fm lookup** for typed names missing from the static index (optional Pages Function)
- **Playlist creation**, **schedule/venue data**

## Commands

```bash
# Install dependencies
npm install

# Run dev server (port 9090)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview

# Regenerate lineup data (all pipeline stages; see Treefort Lineup Data)
npm run lineup

# One stage: lineup:source, lineup:festival (fallback only), lineup:spotify, lineup:musicbrainz, lineup:lastfm, lineup:build
npm run lineup:build

# After a build, check dist/ against the CSP, data shapes and size budgets
npm run check:dist
```

## Key Decisions Log

1. **Client-side only** — privacy-first, no backend, no data storage
2. **PKCE auth** — recommended by Spotify for SPAs, no client secret needed
3. **Static per-year lineup file** — generated by pipeline script, more reliable than API-dependent approaches
4. **Lineup pipeline** — the festival vendor's documented API for names and links (page scrape + performer feed as the fallback) → Spotify search for IDs → MusicBrainz links → Last.fm similar artists and tags → static outputs. Avoids the blocked playlist endpoint and Spotify's deprecated genres.
5. **Match on Spotify artist IDs** — not string names, to avoid mismatches
6. **Last.fm similar artists** — replace Spotify's Related Artists endpoint (blocked in Dev Mode); tags are only a fallback (genre picker)
7. **Vanilla JS + Vite** — minimal dependencies, fast builds, simple
8. **spotifort.com** — standalone domain, Cloudflare Pages
9. **No-login first** — the default experience needs no account; Spotify is an optional upgrade (PR 2.5)
10. **BYOCID required for public launch** — Dev Mode 5-user limit has no workaround for individual developers
11. **Old Spotify app deleted** — new app (created post-Feb 2026) has restricted permissions. Batch artist endpoint and related artists endpoint both return 403. Cannot be recovered.