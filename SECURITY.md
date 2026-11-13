# Security Policy

Spotifort is a free, open-source site run by one person. Security reports are welcome and taken seriously.

## Supported Versions

There are no numbered releases. The only supported version is what is live at [spotifort.com](https://spotifort.com), which is built from the `main` branch.

| Version | Supported |
| --- | --- |
| Live site (`main`) | Yes |
| Older commits, forks, self-hosted copies | No |

## Reporting a Vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**, or use this link:

https://github.com/commitconfirm/spotifort/security/advisories/new

The report stays private between you and the maintainer until a fix is out.

A useful report includes:

- what the problem is and what an attacker could do with it
- the steps to reproduce it (a URL, the input used, the browser)
- whether you tested against spotifort.com or a local copy

### What to expect

| Step | When |
| --- | --- |
| Acknowledgement of your report | Within 7 days |
| An assessment: accepted, needs more information, or declined, with the reason | Within 14 days |
| A fix for an accepted report | As soon as practical, depending on severity |

If a report is accepted, you will be told when the fix is live and, if you wish, credited in the advisory. If it is declined, you will get a short explanation. There is no bug bounty.

## Scope

**In scope**

- the site at spotifort.com and its code in this repository
- the Spotify login flow (authorization code with PKCE) and how the access token is handled
- anything that could run script in a visitor's browser or leak what is stored there
- the data pipeline and GitHub Actions workflows in this repository
- the site's security headers

**Out of scope**

- Spotify, Last.fm, MusicBrainz, Cloudflare, GitHub, or Treefort Music Fest and its app vendor: report problems in those services to their owners
- your own Spotify developer app or Client ID
- denial of service, spam, and social engineering
- findings that need a compromised device or browser, or a browser that is long out of date
- missing best-practice settings with no demonstrated impact

## How the site handles data

Knowing this helps judge impact:

- There is no backend and no database. The site is static files.
- The matching and recommendations run in the visitor's browser.
- A Spotify access token, if a visitor connects, is held in memory only and never stored.
- The browser's local storage holds only the visitor's artist list, their listening-service choice and, if they tick the box, their Spotify Client ID (which is not a secret). "Forget my data" clears all three.
- Page visits are counted with Cloudflare Web Analytics, which uses no cookies.

## Good-faith research

Testing that follows this policy is welcome. Please use only your own accounts and data, avoid degrading the site for others, and give a reasonable time for a fix before sharing details publicly.
