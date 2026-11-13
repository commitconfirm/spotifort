# Spotifort

[![CI](https://github.com/commitconfirm/spotifort/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/commitconfirm/spotifort/actions/workflows/ci.yml)

<p align="center">
  <img src="public/spotifort_transparent.png" alt="Spotifort Logo" width="200">
</p>

<p align="center">
  <strong>Find which artists you love are playing Treefort 2027</strong>
</p>

<p align="center">
  <a href="https://spotifort.com">spotifort.com</a> · <a href="https://spotifort.com/setup">Setup Guide</a> · <a href="https://spotifort.com/lineup">Full Lineup</a> · <a href="https://spotifort.com/why">Why Client ID?</a>
</p>

---

## What Is This?

Spotifort matches your Spotify Liked Songs against the [Treefort Music Fest](https://treefortmusicfest.com/) 2027 lineup (March 31 – April 4, Boise, Idaho). Connect your Spotify account and instantly see which artists you already like that are playing the festival.

## Privacy First

All processing happens **client-side in your browser**. Spotifort has no backend, no database, no cookies, and no advertising or cross-site tracking. Anonymous, cookieless page-visit counts are collected with Cloudflare Web Analytics. Your Spotify data never leaves your device. The access token is held in memory only. Your Client ID (and, during login, the PKCE verifier and OAuth state) is kept in this tab's session storage until you close the tab. When you close the tab, everything is gone.

## How It Works

1. Create a free Spotify Developer app ([setup guide](https://spotifort.com/setup))
2. Paste your Client ID into Spotifort
3. Authorize with Spotify (read-only access to your Liked Songs)
4. See your matches

### Why Do I Need a Client ID?

Spotify's [February 2026 API changes](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security) restrict Development Mode apps to 5 authorized users. Rather than limiting Spotifort to 5 people, each user creates their own Spotify Developer app — making you user #1 on your own app. This is the only way an independent, open-source project can work within Spotify's current restrictions.

For the full story on what changed and what Spotifort could be without these restrictions, see [Why Does Spotifort Need a Client ID?](https://spotifort.com/why)

**Requirements:**
- Spotify Premium account (required by Spotify for Developer Mode)
- A desktop/laptop computer to create the Developer app (Spotify's dashboard doesn't work on mobile)
- Once set up, Spotifort works on any device

## Lineup Data

The Treefort lineup is maintained as a static JSON file sourced from the [official Treefort website](https://treefortmusicfest.com/lineup/) and cross-referenced with Spotify's catalog. It is updated manually and may not reflect last-minute changes.

You can view the full lineup data, including which artists are and aren't on Spotify, at [spotifort.com/lineup](https://spotifort.com/lineup).

## Tech Stack

- Vanilla JavaScript
- [Vite](https://vitejs.dev/) build tool
- [Spotify Web API](https://developer.spotify.com/documentation/web-api) with PKCE authentication
- Hosted on [Cloudflare Pages](https://pages.cloudflare.com/)

## Development

```bash
# Clone the repo
git clone https://github.com/commitconfirm/spotifort.git
cd spotifort

# Install dependencies
npm install

# Create your env file with your Spotify Client ID
echo "VITE_SPOTIFY_CLIENT_ID=your_client_id_here" > .env.local

# Start dev server (runs on port 9090)
npm run dev

# Build for production
npm run build

# Run the tests
npm test

# After a build, check dist/ against the CSP and build rules
npm run check:dist
```

Every change lands through a pull request. CI runs the tests, build, `npm audit` (high and critical fail) and `check:dist` on each PR; `main` deploys to spotifort.com.

### Updating Lineup Data

The festival year and dates live in one place, `festival.config.js`. The lineup is built in stages; each is incremental and safe to rerun.

```bash
# Everything, in order: scrape, festival feed, Spotify, MusicBrainz, Last.fm, build.
# A rerun with nothing new only fetches the Treefort page.
npm run lineup

# Or one stage at a time
npm run lineup:scrape       # artist names and festival slugs from the Treefort page
npm run lineup:festival     # the festival's own performer feed: Spotify link and other links (--refresh re-fetches everyone)
npm run lineup:spotify      # Spotify ids: festival link first, search as the fallback (SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET in .env.local, see .env.local.example)
npm run lineup:musicbrainz  # links to other platforms (1 request per second; a first run takes about 7 minutes)
npm run lineup:lastfm       # similar artists and tags (LASTFM_API_KEY in .env.local)
npm run lineup:build        # outputs and the review and sanity reports; no network
```

What it writes:

| File | What | Edited by |
|---|---|---|
| `data/<year>/state.json` | everything resolved so far | the pipeline |
| `data/<year>/overrides.json` | hand corrections the pipeline always respects | you |
| `data/<year>/review.md` | matches to check, new and removed artists | the build |
| `public/data/<year>/lineup.json`, `similarity.json` | static data for the new experience | the build |
| `public/lineups/<year>.json` | the current site's format | the build |

To fix a wrong match, add the artist to `overrides.json` (see `docs/ARCHITECTURE.md`) and run `npm run lineup:build`. Raw API answers are cached in `~/.cache/spotifort/`, outside the repository; set `SPOTIFORT_CACHE_DIR` to put them elsewhere.

Similar artists, tags and listener counts come from [Last.fm](https://www.last.fm/); links to other platforms come from [MusicBrainz](https://musicbrainz.org/).

## Disclaimer

**This project is not affiliated with, endorsed by, or associated with Treefort Music Fest or Spotify.** This is an independent, open-source community tool built by an enthusiast.

Use at your own risk. No guarantees of accuracy or availability. Lineup data is manually maintained and may not reflect the most current information.

## Contributing

Contributions are welcome. If you find an artist missing from the lineup or matched incorrectly, open an issue. If you want to add a feature, check the issues or open a discussion first.

## Built With

This project was built with [Claude Code](https://claude.ai/code) by Anthropic.

## Contributors

- [commitconfirm](https://github.com/commitconfirm) — creator and maintainer
- [Claude Code](https://claude.ai/code) — AI pair programmer

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <a href="https://commitconfirm.com">commitconfirm.com</a>
</p>