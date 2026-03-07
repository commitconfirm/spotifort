# CLAUDE.md — Spotifort Project Brief

## Project Overview

**Spotifort** is a client-side web application that matches a user's Spotify Liked Songs against the Treefort Music Fest 2026 lineup (March 25–29, Boise, Idaho). It identifies which artists the user already likes that are playing the festival.

- **Live site:** https://spotifort.com
- **Repo:** https://github.com/commitconfirm/spotifort
- **Project manager thread:** This project is managed via a dedicated Claude.ai chat thread. Architectural decisions, scope changes, and priorities are tracked there.

## Architecture & Constraints

### Client-Side Only — No Backend

This is a **privacy-first** application. All processing happens in the browser. There is no server, no database, no analytics, no cookies, no tracking. The Spotify access token lives in a JS variable in memory and is never persisted to localStorage, sessionStorage, or any storage API. When the user closes the tab, everything is gone.

### Spotify API — PKCE Auth Flow

- **Auth method:** Authorization Code with PKCE (no client secret)
- **Scopes required:** `user-library-read` (for Liked Songs)
- **Future scope:** `user-top-read` (for top artists feature in List B — not in MVP)
- **Dev redirect URI:** `http://127.0.0.1:9090/callback`
- **Prod redirect URI:** `https://spotifort.com/callback`
- **Client ID:** Stored in `.env.local` as `VITE_SPOTIFY_CLIENT_ID` (not committed to repo)

### Spotify API Restrictions (February 2026 Dev Mode Changes)

Development Mode is limited to 5 authorized users. The app owner must have Spotify Premium. Key constraints:
- Playlist items are only returned for playlists the user owns/collaborates on (cannot read the official Treefort Spotify playlist via API)
- Several endpoints were removed (bulk metadata, new releases, etc.)
- Still available and used by this project: `GET /me/tracks`, `GET /artists/{id}/related-artists`, `GET /me/top/artists`, `GET /artists/{id}`

Future plan: Transition to "Bring Your Own Client ID" (Option A) so any user with Spotify Premium can use the app without being added to our allowlist. This means the UI will eventually need a Client ID input field with a link to setup instructions.

### Treefort Lineup Data

The lineup is stored as a **static JSON file** (`public/lineup.json`) maintained manually. This is intentional — API restrictions prevent reading the official Treefort Spotify playlist, and scraping the Treefort website is fragile.

The JSON file should include:
- `lastUpdated` — ISO date string, displayed on the site
- `artists` — array of objects, each with: `name`, `spotifyId` (nullable), `spotifyUrl` (nullable), `notOnSpotify` (boolean)

Matching is done on `spotifyId`, NOT string comparison of names. This avoids issues with artist name variants.

## Tech Stack

- **Language:** Vanilla JavaScript (no TypeScript, no framework)
- **Build tool:** Vite
- **Styling:** Plain CSS (no Tailwind, no CSS framework)
- **Font:** Ubuntu (Google Fonts) for headings, bold; system sans-serif for body
- **Hosting:** Cloudflare Pages (auto-deploy from `main` branch)
- **Dev server port:** 9090 (configure in `vite.config.js`)

## Project Structure

```
spotifort/
├── public/
│   └── lineup.json              # Treefort 2026 artist data (manual)
├── src/
│   ├── index.html               # Entry point
│   ├── main.js                  # App initialization, orchestration
│   ├── auth.js                  # Spotify PKCE auth flow
│   ├── spotify.js               # Spotify API calls
│   ├── matcher.js               # Matching logic (liked songs vs lineup)
│   ├── ui.js                    # DOM rendering and interaction
│   └── style.css                # All styles
├── scripts/
│   └── fetch-lineup.js          # One-time utility to generate lineup.json (not part of app)
├── .env.local                   # VITE_SPOTIFY_CLIENT_ID (gitignored)
├── .gitignore
├── CLAUDE.md
├── LICENSE                      # MIT
├── README.md
├── package.json
└── vite.config.js
```

## MVP Scope (List A Only)

The MVP delivers one core feature: show the user which artists from their Liked Songs are playing Treefort 2026.

### User Flow

1. User lands on spotifort.com
2. User sees a brief explanation of what the app does, disclaimers, and a "Connect Spotify" button
3. User clicks the button → redirected to Spotify auth → grants `user-library-read` permission
4. Redirected back to spotifort.com/callback with auth code
5. App exchanges code for access token (PKCE), stores in memory
6. App fetches all Liked Songs (paginated, 50/request), extracts unique artist IDs
7. App loads `lineup.json`, matches artist IDs
8. App displays the matched artists in List A

### UI Design

- **Color scheme:** Black and white only
- **Typography:** Ubuntu font (Google Fonts), bold, for all headings/titles. System sans-serif for body.
- **Layout:** Two-column on desktop (CSS Grid or Flexbox), single column stacked on mobile. Breakpoint ~768px.
- **Lists:** Displayed in boxes with thick black borders
- **List items:** Each artist is a bullet with `[+]` as the marker, which is clickable. In MVP, `[+]` links to the artist's Spotify page. In future, it expands to show similar artists at Treefort.
- **Bottom section:** List of Treefort artists not found on Spotify (from `lineup.json` where `notOnSpotify: true`)

### Required Disclaimers (visible on the page)

- "Not affiliated with, endorsed by, or associated with Treefort Music Fest or Spotify"
- "Lineup data last updated: [date from lineup.json]"
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

## Future Enhancements (NOT in MVP)

These are tracked for later and should NOT be built yet:

- **List B:** Top artists from user's listening history that aren't at Treefort, with similar artists who ARE at Treefort (uses `GET /me/top/artists` + `GET /artists/{id}/related-artists`)
- **[+] expansion:** Click `[+]` on any artist to expand and show similar artists also playing Treefort
- **Bring Your Own Client ID:** UI for users to enter their own Spotify Client ID, with a setup guide page
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
```

## Key Decisions Log

1. **Client-side only** — privacy-first, no backend, no data storage
2. **PKCE auth** — recommended by Spotify for SPAs, no client secret needed
3. **Static lineup.json** — more reliable than scraping or API calls to third-party playlists
4. **Match on Spotify artist IDs** — not string names, to avoid mismatches
5. **Vanilla JS + Vite** — minimal dependencies, fast builds, simple
6. **spotifort.com** — standalone domain, Cloudflare Pages
7. **MVP = List A only** — ship matches before Treefort starts March 25
8. **Option B → Option A** — use own Client ID for dev, transition to BYOCID for public launch