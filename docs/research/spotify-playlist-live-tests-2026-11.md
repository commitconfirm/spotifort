# Spotify playlist creation: live tests, 23 November 2026

What was tried against Spotify's Web API on 2026-11-23 to decide how Spotifort could make a playlist from a visitor's results. It follows `docs/research/spotify-api-availability-2026-11.md`, which covered documentation and app-only probes; this file adds user-token behaviour.

## How to read this file

- **LIVE-TESTED**: observed on 2026-11-23 with a Development Mode app created after February 2026, the owner on Premium, a user token from the PKCE flow. Some probes used the lineup pipeline's client-credentials token ("app-only").
- **OBSERVED BY OWNER**: seen by the owner in the Spotify app, not captured by a script.
- **INFERENCE**: a reading of the results above. Not stated by Spotify.
- **DOCUMENTED**: stated on a Spotify page; the URL is given.

No token, Client ID, username or playlist id is recorded here. The test playlists were made in the owner's own account.

## 1. Login and consent

| Finding | Label |
|---|---|
| Requesting only `playlist-modify-private` works. The token response grants exactly that scope; `expires_in` is 3600. | LIVE-TESTED |
| Spotify's consent screen for that single scope shows two blocks. First, "View your Spotify account data": name, username, profile picture, followers, public playlists. Second, "Take actions in Spotify on your behalf": "Create, edit, and follow private playlists". The first block appears although no read scope was requested. | OBSERVED BY OWNER |
| `GET /me` returns 200 with an id under that scope. | LIVE-TESTED |

## 2. Creating and filling a playlist

| Request | Result | Label |
|---|---|---|
| `POST /me/playlists` | 201 | LIVE-TESTED |
| `POST /playlists/{id}/items` with 13 track URIs | 201 | LIVE-TESTED |
| `POST /users/{id}/playlists` (the old endpoint) | 403 Forbidden | LIVE-TESTED |
| `GET /me/playlists` | 403 "Insufficient client scope" in every run, including one where `playlist-read-private` and `playlist-read-collaborative` were granted. Unexplained. | LIVE-TESTED |

## 3. A private playlist is not possible through the API

| Attempt | Result | Label |
|---|---|---|
| Create with `public:false` | The create response says `public:false`. `GET /playlists/{id}` then says `public:true`: immediately, after 5 seconds and after 30 seconds, also with `?fields=`. | LIVE-TESTED |
| `PUT /playlists/{id}` with `{"public":false}` | 200, nothing changes. Same with a full body (name, public, collaborative, description). | LIVE-TESTED |
| Create as `public:true`, then `PUT` `public:false` | Still `true`. | LIVE-TESTED |
| Scopes | Identical with `playlist-modify-private` alone, with both modify scopes, and with all four playlist scopes. | LIVE-TESTED |
| `collaborative:true` with `public:false` | Reads `public:true, collaborative:true`. | LIVE-TESTED |
| How the Spotify app shows them | Every one of these is labelled "Public Playlist", including the collaborative one. None appears on the owner's public profile. | OBSERVED BY OWNER |
| Can a stranger open one? | Without logging in, `https://open.spotify.com/oembed?url=https://open.spotify.com/playlist/<id>` returns 200 with the playlist title for the test playlists. Anyone with the link can open them. | LIVE-TESTED |

What Spotify's pages say (cited, not re-researched):

- The "Working with Playlists" page says the public attribute "does not refer to access control" and that modifying access is not possible through the Web API: https://developer.spotify.com/documentation/web-api/concepts/playlists
- A Spotify staff reply in the developer forum dated 2024-06-11 explains that the app repurposed public/private to mean access, while the API's `public` kept the older meaning, "added to the profile": https://community.spotify.com/t5/Spotify-for-Developers/Api-to-create-a-private-playlist-doesn-t-work/m-p/6030637
- The Create Playlist reference page still says `public:false` "will be private". That is out of date: https://developer.spotify.com/documentation/web-api/reference/create-playlist
- The app's own Private setting: https://support.spotify.com/us/article/playlist-privacy-and-access/

**Conclusion (INFERENCE from the above):** through the API a playlist can be made that is off the profile but openable by anyone with the link. Only the Spotify app can make it private.

## 4. Finding tracks for an artist

`GET /artists/{id}/top-tracks` returns 403, and tracks carry no popularity field (LIVE-TESTED).

### 4.1 Search

`GET /search?type=track&limit=10&q=artist:"NAME"` works with a user token and with an app-only token, with no `market` parameter. `limit` above 10 returns 400. (LIVE-TESTED)

Measured with the app-only token over the 186 lineup artists that have a Spotify id. Only tracks carrying the lineup artist's Spotify id were kept, and versions of one song were collapsed by title. (LIVE-TESTED)

| Group | Artists | 3 or more tracks | 2 | 1 | none |
|---|---|---|---|---|---|
| Verified (183) | 183 | 172 | 4 | 1 | 6 |
| Unverified (3) | 3 | 1 | 0 | 0 | 2 |

- 18 artists had another artist's track among their first 3 results.
- The misses are name collisions (a lineup artist named Barbara returns other Barbaras; TWEN returns twenty one pilots) and non-English names.
- 129 of 186 responses returned fewer than 10 tracks; in each of those, `tracks.total` equalled the number returned.
- 55 of 1,290 own tracks (4.3%) list the lineup artist second or later.
- Duplicates are common: the same song as a single and as an album track, acoustic, remix, sped-up, or with different capitalisation.
- Result order is undocumented. For artists the reviewer knows, the first results are their best-known songs. (INFERENCE)

### 4.2 Albums route

`GET /artists/{id}/albums?include_groups=album,single&limit=10`, then `GET /albums/{id}/tracks`, returned 200 throughout, and every album track carried the artist's id. (LIVE-TESTED)

- Albums come back grouped by type (albums, then singles, each newest first), not newest first overall.
- The first page of 10 can truncate (totals up to 43).
- For the 13 artists with fewer than 3 own tracks from search, adding the newest 3 releases brought 12 of them to 3 or more. One artist has only 2 songs on Spotify.

## 5. Quota

| Finding | Label |
|---|---|
| 90 track searches, 4 at a time, with a user token: 11.6 seconds, all 200. | LIVE-TESTED |
| After roughly 300 search requests from one developer account within about 35 minutes (about 100 with a user token in the browser, about 190 with the app-only token, a few probes), every search returned 429. Body: `{"error":{"status":429,"message":"Too many requests","reason":"QUOTA_EXCEEDED"}}`. `Retry-After` was 84176 seconds (23 h 23 min). | LIVE-TESTED |
| Both `type=track` and `type=artist` were blocked, for the user token and the app-only token alike. | LIVE-TESTED |
| In the same minute `GET /artists/{id}/albums`, `GET /albums/{id}/tracks` and `POST /me/playlists` returned 2xx. Search has its own quota bucket. | LIVE-TESTED |
| "About 300 searches per 24 hours per developer account" is one day's count from one account. The size of the albums bucket is unknown. | INFERENCE |
| In the browser the `Retry-After` header may not be readable cross-origin (it was never captured there). The body's `reason` is readable. | INFERENCE |

**Consequence for the pipeline:** the scheduled lineup job's artist search draws on the same developer-account search quota. A visitor who uses their own Client ID spends their own account's quota, not the owner's.

## What this does not show

- A single day and one account. Limits may differ by account, mode or date.
- User-token search results were sampled for 12 artists; the full 186-artist measurement used the app-only token, whose results may differ by market.
- The size and reset period of the albums bucket are unknown.
- Why `GET /me/playlists` returns 403 is unexplained.
- Nothing here shows how Spotify applies its naming policy to a playlist title.
