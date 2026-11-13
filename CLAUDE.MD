# CLAUDE.md — Spotifort Project Brief

## Project Overview

**Spotifort** is a client-side web application that matches a user's Spotify Liked Songs against the Treefort Music Fest 2027 lineup (March 31 – April 4, 2027, Boise, Idaho; year and dates live only in `festival.config.js`). It identifies which artists the user already likes that are playing the festival and suggests other Treefort artists by genre overlap.

- **Live site:** https://spotifort.com
- **Repo:** https://github.com/commitconfirm/spotifort
- **2027 plan — read first:** `docs/PLAN-2027.md` is the source of truth for decisions, phases, working rules and status. It wins where this file disagrees. `main` is protected: all work, including docs, lands through a pull request.

## Architecture & Constraints

### Client-Side Only — No Backend

This is a **privacy-first** application. All processing happens in the browser. There is no backend, no database, no cookies, and no advertising or cross-site tracking. Anonymous, cookieless page-visit counts come from Cloudflare Web Analytics (injected at the edge by Cloudflare Pages, not in the repo or `dist/`). Spotify data never leaves the browser. The Spotify access token lives in a JS variable in memory and is never written to any storage API. The user's Client ID, the PKCE verifier and the OAuth `state` are kept in sessionStorage (they must survive the redirect to Spotify) and disappear when the tab closes. Nothing is ever put in localStorage.

### Spotify API — PKCE Auth Flow

- **Auth method:** Authorization Code with PKCE (no client secret)
- **Scopes required:** `user-library-read` (for Liked Songs)
- **Future scope:** `user-top-read` (for top artists feature in List B — not in MVP)
- **Dev redirect URI:** `http://127.0.0.1:9090/callback`
- **Prod redirect URI:** `https://spotifort.com/callback`
- **Client ID:** Stored in `.env.local` as `VITE_SPOTIFY_CLIENT_ID` (not committed to repo)

### Spotify API Restrictions (February 2026 Dev Mode Changes)

This app was created after February 11, 2026 and is subject to the new Dev Mode restrictions. The app owner must have Spotify Premium. Each developer gets one Client ID with a maximum of 5 authorized users.

**Endpoints confirmed WORKING for this project:**

| Endpoint | Purpose | Notes |
|----------|---------|-------|
| `GET /me/tracks` | Fetch user's Liked Songs | Paginated, 50/request. Core matching feature. |
| `GET /me/top/{type}` | User's top artists | Needs `user-top-read` scope. For future List B. |
| `GET /me/following` | User's followed artists | Could expand matching beyond Liked Songs. |
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

The lineup is built by a staged pipeline (Pipeline v2; design in `docs/ARCHITECTURE.md`). Year comes from `festival.config.js`. The Treefort Spotify playlist cannot be read by new Dev Mode apps, so names come from the website and everything else is looked up per artist:

1. `scrape`: artist names from the Treefort website (`lineupUrl`; parses `<h3 class="lineup-artist-name">` and each card's `data-slug`), the ground truth for who is performing. Each artist gets a stable number `n`.
2. `festival`: the festival's own performer feed (`GET /wp-json/tmf/v1/performer/<slug>`, undocumented, no auth; REST base read from the lineup page's `tmfLineup` config). Stores the Spotify link the festival chose, other links and hometown. A failed fetch is retried next run; if over half fail the stage stops with a warning and exits 0.
3. `spotify`: Spotify id by override, then the festival's artist link, then its album link (resolved through `GET /albums/{id}`), then Search. Confidence `festival` counts as confirmed; search gives `exact`, `inexact`, `ambiguous`.
4. `musicbrainz`: Spotify URL to MusicBrainz ID to verified links (Apple Music, Tidal, Deezer, Bandcamp, YouTube, SoundCloud, Last.fm) and platform ids.
5. `lastfm`: similar artists, tags and listener counts by name.
6. `build`: state + overrides to the static outputs.

Files:
- `data/<year>/state.json`: everything the pipeline resolved (committed, pipeline-only)
- `data/<year>/overrides.json`: hand corrections, always respected (Spotify ids, Last.fm name, links, tags)
- `data/<year>/review.md`, `sanity.md`: reports from the build
- `public/data/<year>/lineup.json`, `similarity.json`: what the new experience will load (committed; size budgets 60 KB / 200 KB gzip, enforced by `check:dist`)
- `public/lineups/<year>.json`: the Phase 1 format the live site still reads, regenerated by the build from the same state; removed when the new experience ships
- `.cache/`: raw API responses (gitignored)

Matching is done on `spotifyId`, NOT string comparison of names. The `[+]` expansion still uses `genres` in `public/lineups/<year>.json` (now the top 5 Last.fm tags, non-genre tags filtered).

**To update the lineup:**
```bash
npm run lineup               # all stages in order; a rerun with nothing new only touches the Treefort page
npm run lineup:scrape        # one stage at a time: scrape | festival | spotify | musicbrainz | lastfm | build
npm run lineup:festival -- --refresh   # re-fetch every performer (when the festival may have corrected links)
```
Each stage is incremental and resumable. An API failure never becomes a negative fact (the artist stays unresolved and is retried); a stage stops after 3 consecutive failures. Artists gone from the website are marked `removed` in state and excluded from outputs. Credentials in `.env.local` (see `.env.local.example`): `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` (else `SPOTIFY_ACCESS_TOKEN`, else a hidden prompt) and `LASTFM_API_KEY`. MusicBrainz needs none and runs at 1 request per second. Pure logic is in `scripts/lib/`; fix a wrong match by adding an entry to `overrides.json` and running `npm run lineup:build`. The name normaliser `src/core/normalize.js` is shared with the app.

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
│   ├── data/<year>/             # Pipeline v2 outputs: lineup.json, similarity.json (generated)
│   └── lineups/<year>.json      # Phase 1 format, still read by the live site (generated)
├── data/<year>/                 # state.json, overrides.json, review.md, sanity.md
├── festival.config.js           # Single source of festival year, dates, lineup URL
├── scripts/
│   ├── lineup-{scrape,spotify,musicbrainz,lastfm,build}.js   # Pipeline stages (I/O only)
│   └── lib/                     # Pure, tested pipeline logic
├── src/
│   ├── index.html               # Entry point
│   ├── main.js                  # App initialization, orchestration
│   ├── auth.js                  # Spotify PKCE auth flow
│   ├── spotify.js               # Spotify API calls (liked songs, artist data)
│   ├── matcher.js               # Matching logic (liked songs vs lineup)
│   ├── ui.js                    # DOM rendering and interaction
│   └── style.css                # All styles
├── .env.local                   # VITE_SPOTIFY_CLIENT_ID (gitignored)
├── .gitignore
├── CLAUDE.md
├── LICENSE                      # MIT
├── README.md
├── package.json
└── vite.config.js
```

## Current Feature Set (MVP)

### User Flow

1. User lands on spotifort.com
2. User sees a brief explanation of what the app does, disclaimers, and a "Connect Spotify" button
3. User clicks the button → redirected to Spotify auth → grants `user-library-read` permission
4. Redirected back to spotifort.com/callback with auth code
5. App exchanges code for access token (PKCE), stores in memory
6. App fetches all Liked Songs (paginated, 50/request), extracts unique artist IDs
7. App loads /lineups/<year>.json, matches artist IDs
8. App displays matched artists in List A with [+] genre-based expansion

### [+] Expansion Feature

When user clicks [+] on a matched artist, the app looks up that artist's genres from the year file and finds other Treefort lineup artists that share at least one genre. Results are displayed as an indented sub-list sorted by genre overlap count. This is entirely client-side using pre-fetched genre data — no runtime API calls needed.

### Lineup Transparency Page

A /lineup page shows the full Treefort lineup data from the year file:
- Artists on Spotify (with links)
- Artists not found on Spotify
- Last updated date
- Explanation of data sourcing methodology

### UI Design

- **Color scheme:** Black and white only
- **Typography:** Ubuntu font (self-hosted), bold, for all headings/titles. System sans-serif for body.
- **Layout:** Two-column on desktop (CSS Grid or Flexbox), single column stacked on mobile. Breakpoint ~768px.
- **Lists:** Displayed in boxes with thick black borders
- **List items:** Each artist is a bullet with `[+]` as a collapsible toggle for genre-based similar artists

### Required Disclaimers (visible on the page)

- "Not affiliated with, endorsed by, or associated with Treefort Music Fest or Spotify"
- "Privacy: your Spotify data stays in your browser. Page visits are counted with Cloudflare Web Analytics, which uses no cookies and does not identify you." (linked to https://www.cloudflare.com/web-analytics/)
- "Lineup data last updated: [date from the year file]" with note that lineup is manually maintained
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

These are tracked for later and should NOT be built yet:

- **List B:** Top artists from user's listening history that aren't at Treefort, with Treefort artists in similar genres (uses `GET /me/top/artists`)
- **Followed Artists matching:** Use `GET /me/following` to match followed artists against lineup, catching fans who follow but haven't liked specific tracks
- **Bring Your Own Client ID:** UI for users to enter their own Spotify Client ID, with a setup guide page. Required for public launch beyond 5 users.
- **Schedule/venue data:** When bands are playing and where during Treefort
- **Bandcamp/Soundcloud:** Support for artists not on Spotify
- **Rate limiting / progress UI:** Progress bar for users with large libraries

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

# One stage: lineup:scrape, lineup:festival, lineup:spotify, lineup:musicbrainz, lineup:lastfm, lineup:build
npm run lineup:build

# After a build, check dist/ against the CSP, data shapes and size budgets
npm run check:dist
```

## Key Decisions Log

1. **Client-side only** — privacy-first, no backend, no data storage
2. **PKCE auth** — recommended by Spotify for SPAs, no client secret needed
3. **Static per-year lineup file** — generated by pipeline script, more reliable than API-dependent approaches
4. **Lineup pipeline** — scrape Treefort website for ground truth names → Spotify search for IDs → MusicBrainz links → Last.fm similar artists and tags → static outputs. Avoids the blocked playlist endpoint and Spotify's deprecated genres.
5. **Match on Spotify artist IDs** — not string names, to avoid mismatches
6. **Genre-based similar artists** — replaces Spotify's Related Artists endpoint (blocked in Dev Mode) with genre overlap from pre-fetched data in the year file
7. **Vanilla JS + Vite** — minimal dependencies, fast builds, simple
8. **spotifort.com** — standalone domain, Cloudflare Pages
9. **MVP = List A + genre expansion** — ship before Treefort starts (see `festival.config.js`)
10. **BYOCID required for public launch** — Dev Mode 5-user limit has no workaround for individual developers
11. **Old Spotify app deleted** — new app (created post-Feb 2026) has restricted permissions. Batch artist endpoint and related artists endpoint both return 403. Cannot be recovered.