# CLAUDE.md — Spotifort Project Brief

## Project Overview

**Spotifort** is a client-side web application that matches a user's Spotify Liked Songs against the Treefort Music Fest 2027 lineup (March 31 – April 4, 2027, Boise, Idaho; year and dates live only in `festival.config.js`). It identifies which artists the user already likes that are playing the festival and suggests other Treefort artists by genre overlap.

- **Live site:** https://spotifort.com
- **Repo:** https://github.com/commitconfirm/spotifort
- **Project manager thread:** This project is managed via a dedicated Claude.ai chat thread. Architectural decisions, scope changes, and priorities are tracked there.

## Architecture & Constraints

### Client-Side Only — No Backend

This is a **privacy-first** application. All processing happens in the browser. There is no server, no database, no analytics, no cookies, no tracking. The Spotify access token lives in a JS variable in memory and is never written to any storage API. The user's Client ID, the PKCE verifier and the OAuth `state` are kept in sessionStorage (they must survive the redirect to Spotify) and disappear when the tab closes. Nothing is ever put in localStorage.

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

The lineup is stored as a **static JSON file per year** (`public/lineups/<year>.json`, year from `festival.config.js`) maintained via a pipeline script. The Treefort Spotify playlist cannot be read by new Dev Mode apps, so the script uses a two-step approach:

1. Scrape artist names from the Treefort website (`lineupUrl` in `festival.config.js`; parses `<h3 class="lineup-artist-name">`) — the ground truth for who's performing
2. For each artist new to the file, use the Spotify Search API to find their Spotify ID (the `genres` field is deprecated by Spotify and may be empty; use `npm run lineup:genres` to fill genres)

This avoids the playlist restriction entirely and catches artists that may be on the website but not in the playlist.

The JSON file includes:
- `lastUpdated` — ISO date string, displayed on the site
- `enriched` — `false` on a scrape-only placeholder (no Spotify data yet); set `true` by `npm run lineup`
- `artists` — array of objects, each with: `name`, `spotifyId` (nullable), `spotifyUrl` (nullable), `genres` (array), `notOnSpotify` (boolean)

Matching is done on `spotifyId`, NOT string comparison of names. Genre data is stored in the year file and used for the [+] expansion feature (no runtime API calls needed).

**To update the lineup:**
```bash
npm run lineup                                   # scrape + Spotify lookup of NEW artists only
node scripts/fetch-lineup.js --names-only        # scrape only, no credentials needed
npm run lineup:genres                            # add genres (MusicBrainz / Last.fm)
```
Existing records are kept; only artists new on the website or still unresolved (`spotifyId` null and `notOnSpotify` false: never looked up, or the lookup failed) are searched. An API error never marks an artist `notOnSpotify`; after 3 consecutive errors the script writes what it has, leaves the rest unresolved and exits non-zero. `enriched` is true only when nothing is unresolved. Low-confidence matches (top hit used, name differs) get `spotifyName` and are listed in the summary. Artists no longer on the website are dropped and listed in the console summary. Credential: `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` in `.env.local` (client credentials; see `.env.local.example`), else `SPOTIFY_ACCESS_TOKEN`, else a hidden prompt. Pure logic is in `scripts/lib/lineup-pipeline.js`. Fails if fewer than 50 names are scraped.

## Tech Stack

- **Language:** Vanilla JavaScript (no TypeScript, no framework)
- **Build tool:** Vite 8 (`build.rolldownOptions`); tests: Vitest (`npm test`)
- **Security headers:** `public/_headers` (strict CSP: no inline scripts, handlers or `style=` attributes anywhere in `src/`)
- **Styling:** Plain CSS (no Tailwind, no CSS framework)
- **Font:** Ubuntu (self-hosted via `@fontsource/ubuntu`, weight 700 only) for headings, bold; system sans-serif for body
- **Hosting:** Cloudflare Pages (auto-deploy from `main` branch)
- **Domain:** spotifort.com (purchased on Cloudflare)
- **Dev server port:** 9090 (configure in `vite.config.js`)

## Project Structure

```
spotifort/
├── public/
│   └── lineups/<year>.json      # Treefort artist data per year (generated by script)
├── festival.config.js           # Single source of festival year, dates, lineup URL
├── scripts/
│   ├── fetch-lineup.js          # Lineup pipeline: website scrape → Spotify search → JSON
│   └── add-genres.js            # Genre enrichment (MusicBrainz / Last.fm)
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

# Regenerate lineup data (scrape + Spotify lookup of new artists)
npm run lineup

# Add genres to the lineup file
npm run lineup:genres
```

## Key Decisions Log

1. **Client-side only** — privacy-first, no backend, no data storage
2. **PKCE auth** — recommended by Spotify for SPAs, no client secret needed
3. **Static per-year lineup file** — generated by pipeline script, more reliable than API-dependent approaches
4. **Lineup pipeline** — scrape Treefort website for ground truth names → Spotify search for IDs → genres from search results. Avoids blocked playlist endpoint.
5. **Match on Spotify artist IDs** — not string names, to avoid mismatches
6. **Genre-based similar artists** — replaces Spotify's Related Artists endpoint (blocked in Dev Mode) with genre overlap from pre-fetched data in the year file
7. **Vanilla JS + Vite** — minimal dependencies, fast builds, simple
8. **spotifort.com** — standalone domain, Cloudflare Pages
9. **MVP = List A + genre expansion** — ship before Treefort starts (see `festival.config.js`)
10. **BYOCID required for public launch** — Dev Mode 5-user limit has no workaround for individual developers
11. **Old Spotify app deleted** — new app (created post-Feb 2026) has restricted permissions. Batch artist endpoint and related artists endpoint both return 403. Cannot be recovered.