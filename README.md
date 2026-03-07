# Spotifort

Match your Spotify Liked Songs against the [Treefort Music Fest 2026](https://treefortmusicfest.com/) lineup. Find out which artists you already love are playing in Boise this March.

**This project is not affiliated with, endorsed by, or associated with Treefort Music Fest or Spotify.** This is an independent, open-source community tool built by an enthusiast.

## Status

🚧 Under active development — targeting launch before Treefort 2026 (March 25–29).

## How It Works

1. You authenticate with Spotify using your own credentials (PKCE flow — no server, no data stored)
2. Spotifort pulls your Liked Songs and compares artists against the Treefort 2026 lineup
3. You get a list of matches — artists you already like who are playing the festival

All processing happens client-side in your browser. No personal data is stored, transmitted, or logged.

## Tech Stack

- Vanilla JS + Vite
- Spotify Web API (PKCE auth)
- Hosted on Cloudflare Pages

## License

MIT — see [LICENSE](LICENSE) for details.

## Disclaimer

Use at your own risk. No guarantees of accuracy or availability. Lineup data is manually maintained and may not reflect the most current information. This is free and open-source software (FOSS).

Built with [Claude Code](https://claude.ai/code) | [commitconfirm.com](https://commitconfirm.com)
