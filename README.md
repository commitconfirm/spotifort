# Spotifort

[![CI](https://github.com/commitconfirm/spotifort/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/commitconfirm/spotifort/actions/workflows/ci.yml)

<p align="center">
  <img src="public/spotifort_transparent.png" alt="Spotifort Logo" width="200">
</p>

<p align="center">
  <strong>Who should you see at Treefort 2027?</strong>
</p>

<p align="center">
  <a href="https://spotifort.com">spotifort.com</a> · <a href="https://spotifort.com/setup">Setup Guide</a> · <a href="https://spotifort.com/lineup">Full Lineup</a> · <a href="https://spotifort.com/why">Why Client ID?</a>
</p>

---

## What Is This?

Spotifort helps you find your acts at [Treefort Music Fest](https://treefortmusicfest.com/) 2027 (March 31 – April 4, Boise, Idaho). Type a few artists you like, no account needed, and it lists who you already like that is playing and recommends other acts on the lineup that sound like them, with a reason for each and a link to listen on Spotify, Apple Music, Tidal or Bandcamp. If you want, connect your Spotify library to add all your artists at once.

## Privacy First

All processing happens **client-side in your browser**. Spotifort has no backend, no database, no cookies, and no advertising or cross-site tracking. Anonymous, cookieless page-visit counts are collected with Cloudflare Web Analytics. Your Spotify data never leaves your device, and the Spotify access token is held in memory only.

What is remembered, on your device only (`localStorage`): the artists you added, which listening service you chose, and your Spotify Client ID if you leave "Remember my Client ID on this device" ticked. "Forget my data" clears all of it.

## How It Works

1. Type an artist you like (or tap one of the examples)
2. Add a few more; results update as you go
3. Pick where you listen; every row has a listen link and `[+]` for similar acts on the lineup
4. Share your picks with a link, if you like

Recommendations come from [Last.fm](https://www.last.fm/) similar-artist data collected ahead of time for every lineup artist, so the site needs no server.

### Optional: connect Spotify

1. Create a free Spotify Developer app ([setup guide](https://spotifort.com/setup))
2. Paste your Client ID into Spotifort ("or connect your Spotify library")
3. Authorize with Spotify (read-only access to your Liked Songs, top artists and followed artists)

### Why Do I Need a Client ID?

Spotify's [February 2026 API changes](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security) restrict Development Mode apps to 5 authorized users. Rather than limiting Spotifort to 5 people, each user creates their own Spotify Developer app — making you user #1 on your own app. This is the only way an independent, open-source project can work within Spotify's current restrictions.

For the full story on what changed and what Spotifort could be without these restrictions, see [Why Does Spotifort Need a Client ID?](https://spotifort.com/why)

**Requirements (Spotify only):**
- Spotify Premium account (required by Spotify for Developer Mode)
- A desktop/laptop computer to create the Developer app (Spotify's dashboard doesn't work on mobile)
- Once set up, Spotifort works on any device

## Lineup Data

The Treefort lineup is built ahead of time into static JSON from the [official Treefort website](https://treefortmusicfest.com/lineup/), Spotify, [MusicBrainz](https://musicbrainz.org/) and [Last.fm](https://www.last.fm/) (see Updating Lineup Data below). It may not reflect last-minute changes.

You can view the full lineup data, with listen links, tags and which matches are unverified, at [spotifort.com/lineup](https://spotifort.com/lineup).

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

# Optional, for testing the Spotify import locally: a Client ID whose app has the
# redirect URI http://127.0.0.1:9090/callback (dev builds only; never used in production)
echo "VITE_SPOTIFY_CLIENT_ID=your_client_id_here" >> .env.local

# Start dev server (runs on port 9090)
npm run dev

# Try the recommendation engine from the command line
npm run try -- "Phoebe Bridgers" "Turnstile"

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
# Everything, in order: lineup source, Spotify, MusicBrainz, Last.fm, build.
# A rerun with nothing new makes four requests to the festival app vendor's API and changes no file.
npm run lineup

# Or one stage at a time
npm run lineup:source       # the lineup: the vendor's documented API (festival id in festival.config.js); falls back to the Treefort page + performer feed
npm run lineup:festival     # fallback only: the festival's own performer feed for links (--refresh re-fetches everyone)
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
| `public/data/<year>/lineup.json`, `similarity.json` | static data the site loads | the build |

To fix a wrong match, add the artist to `overrides.json` (see `docs/ARCHITECTURE.md`) and run `npm run lineup:build`. Raw API answers are cached in `~/.cache/spotifort/`, outside the repository; set `SPOTIFORT_CACHE_DIR` to put them elsewhere.

### Lineup updates

A scheduled GitHub Actions workflow (`.github/workflows/lineup.yml`) reruns `npm run lineup` twice a day, at 14:17 and 02:43 UTC (about 7:17 am and 7:43 pm Mountain Standard Time, one hour later in daylight time). If the data changed it runs the tests and the build, pushes the branch `lineup-update` (rebuilt from `main` each run) and opens or updates one pull request whose description carries the review report. Merge it when `check` and `Cloudflare Pages` are green. If nothing changed, nothing is pushed.

It needs three repository secrets (Settings, Secrets and variables, Actions): `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` and `LASTFM_API_KEY`. While any is missing the job ends green with a notice and does nothing. To run it by hand: Actions tab, "Lineup update", "Run workflow" (on `main`).

To correct a match, add the artist to `data/<year>/overrides.json` on `main` and merge that; the next run applies it and the pull request updates itself. A failed stage turns the run red and the run summary names the stage and shows the end of its output.

Similar artists, tags and listener counts come from [Last.fm](https://www.last.fm/); links to other platforms come from [MusicBrainz](https://musicbrainz.org/).

## Disclaimer

**This project is not affiliated with, endorsed by, or associated with Treefort Music Fest or Spotify.** This is an independent, open-source community tool built by an enthusiast.

Use at your own risk. No guarantees of accuracy or availability. Lineup data may not reflect the most current information.

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