# Spotifort

<p align="center">
  <img src="public/spotifort_transparent.png" alt="Spotifort Logo" width="200">
</p>

<p align="center">
  <strong>Find which artists you love are playing Treefort 2026</strong>
</p>

<p align="center">
  <a href="https://spotifort.com">spotifort.com</a> · <a href="https://spotifort.com/setup">Setup Guide</a> · <a href="https://spotifort.com/lineup">Full Lineup</a> · <a href="https://spotifort.com/why">Why Client ID?</a>
</p>

---

## What Is This?

Spotifort matches your Spotify Liked Songs against the [Treefort Music Fest 2026](https://treefortmusicfest.com/) lineup (March 25–29, Boise, Idaho). Connect your Spotify account and instantly see which artists you already like that are playing the festival.

## Privacy First

All processing happens **client-side in your browser**. Spotifort has no backend, no database, no analytics, no cookies, and no tracking. Your Spotify data never leaves your device. When you close the tab, everything is gone.

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
```

### Updating Lineup Data

```bash
# Regenerate lineup.json from Treefort website + Spotify search
# Prompts for a Spotify access token
node scripts/fetch-lineup.js

# Add genre data to existing lineup.json
node scripts/add-genres.js
```

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