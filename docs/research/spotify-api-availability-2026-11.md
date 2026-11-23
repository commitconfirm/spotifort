# Spotify platform availability for Spotifort, as of 23 November 2026

Research date: 2026-11-23. Scope: what Spotify makes available today to a client-side app whose users each bring their own Client ID (Development Mode, created after 11 February 2026), plus a build-time pipeline using the owner's client-credentials token.

## How to read this file

Labels on each claim:

- **DOCUMENTED**: stated on a developer.spotify.com page. URL given.
- **LIVE-TESTED**: observed on 2026-11-23 with a client-credentials token from the owner's app (20 read-only GETs; statuses and field names only). User-token behaviour was not tested.
- **DEVELOPER REPORT**: a post on community.spotify.com or an issue on github.com. Not an official statement. The accounts named are not verified as Spotify staff.
- **INFERENCE**: my reading of the above. Not stated by Spotify.
- **UNVERIFIED**: could not be confirmed.

Method notes:

- Page text was read two ways: a summarising fetch tool (WebFetch) and raw HTML downloaded with curl and stripped of tags. Quotes below marked "(raw)" were checked against the raw HTML text. Other short quotes come from the summarising tool and may be paraphrased by it.
- Several API reference pages could not be read past about 100,000 characters (`get-playlist`, `create-playlist`). Nothing below depends on the unread tails.
- The changelog index lists exactly four 2026 entries: February, March, May, July. The URLs for April, June, August, September, October and November return HTTP 404 (`/documentation/web-api/references/changes/<month>-2026`). The July page's sidebar lists only those four. Source: https://developer.spotify.com/documentation/web-api/references/changes/july-2026 (raw). `/documentation/web-api/references/changes` and `/blog` returned 404 when fetched directly.
- The blog and the forum show Spotify posts that are not on the changelog: 2026-02-06 (access change), 2026-06-18 (refresh token expiry), 2026-07-23 (quota update). The June post is not on the changelog.

---

## Update after live tests (2026-11-23)

Later the same day a user token was used for the first time. Results are in `docs/research/spotify-playlist-live-tests-2026-11.md`. What changes in this file:

- Playlist creation is LIVE-TESTED working: `POST /me/playlists` returns 201 and `POST /playlists/{id}/items` returns 201 with `playlist-modify-private` alone. The old `POST /users/{user_id}/playlists` returns 403.
- A private playlist is not possible through the API. `public:false` keeps a playlist off the profile, but the API then reports `public:true`, the Spotify app labels it "Public Playlist", and anyone with the link can open it. Tried six ways; the table in section 3 of the live-tests file lists them.
- Search has a quota of its own: about 300 searches in a day from one developer account ended in `QUOTA_EXCEEDED` with a `Retry-After` of about 23 hours; albums and playlist creation still worked. The lineup job shares it.
- `GET /me/playlists` returns 403 "Insufficient client scope" even with the read scopes granted. Unexplained.
- Search limits, track-search quality across the 186 lineup artists, and the albums route are measured in the live-tests file.

Rows and questions below that these results change are marked "(updated 2026-11-23)". The rest of this file is as written on the morning of 2026-11-23.

---

## 1. Summary

A post-February-2026 Development Mode app keeps a small core: search (limit 10), artist, album, album tracks and track lookups one at a time, the user's library reads (saved tracks, saved albums, top items, followed artists, recently played), playlist create and item writes, and the Player endpoints. Everything that returns per-artist popularity, genres, previews, top tracks, related artists, recommendations or audio features is gone or empty. Nothing in the changelog after July 2026 changes this. Policy is the larger constraint: the Developer Policy says an app name "should not begin with 'Spot'", the Branding Guidelines say not to incorporate Spotify's trademarks "in whole or in part", and the Terms limit storing Spotify Content.

| Question | Answer | Label |
|---|---|---|
| Any Web API change after July 2026? | No. Changelog has Feb, Mar, May, Jul only. | DOCUMENTED |
| Dev Mode user cap | 5 authorised users per Client ID, allowlist required | DOCUMENTED |
| Premium rule | App owner must have Premium or the app does not function | DOCUMENTED |
| Client IDs per developer account | 25 since July 2026 (was 1) | DOCUMENTED |
| Quota counting | Per developer account, shared across all Dev Mode Client IDs, in buckets. No numbers published. | DOCUMENTED |
| 429 quota body | `"reason": "QUOTA_EXCEEDED"` | DOCUMENTED |
| Extended Quota Mode | Organisations only (since 15 May 2025), 250k MAU, up to six weeks | DOCUMENTED |
| Client credentials in Dev Mode | Works for search, artist, album, album tracks, track. 403 for batch, top-tracks, related, audio features, new releases. `/me` gives 401. | LIVE-TESTED |
| Artist `genres` | Absent from the response (not empty) | LIVE-TESTED |
| Track/album `popularity`, `preview_url` | Absent. `external_ids` present on tracks and albums. | LIVE-TESTED |
| Search `limit` | Max 10, default 5. 11 returns 400 "Invalid limit". | LIVE-TESTED, DOCUMENTED |
| Artist albums `limit` | Max 10. 11 returns 400. | LIVE-TESTED, DOCUMENTED |
| Top tracks per artist | Not available (403 live). Workaround exists in search: `type=track&q=artist:"Name"` returns tracks. | LIVE-TESTED |
| Create a private playlist | `POST /me/playlists`, scope `playlist-modify-private`. Add items `POST /playlists/{id}/items`, max 100 per request. (Updated 2026-11-23: the call works, but the playlist is not private; see below.) | DOCUMENTED |
| Does playlist creation work in a Dev Mode app with a user token? (updated 2026-11-23) | Yes: 201 on create and on adding 13 items, with `playlist-modify-private` alone. | LIVE-TESTED |
| Can the API make a playlist private? (added 2026-11-23) | No. `public:false` only keeps it off the profile; anyone with the link can open it, and the Spotify app labels it "Public Playlist". | LIVE-TESTED |
| Search quota (added 2026-11-23) | About 300 searches in a day from one developer account gave `QUOTA_EXCEEDED`, `Retry-After` about 23 hours; other buckets kept working. | LIVE-TESTED, INFERENCE for the figure |
| Refresh tokens | PKCE refresh needs no secret. Refresh tokens last 6 months from authorisation, not extended by use. | DOCUMENTED |
| Name "Spotifort" | Policy VI: name "should not begin with 'Spot'". See section 6. | DOCUMENTED |
| Any link that pre-fills a playlist or plays an artist without the API | None documented. | UNVERIFIED |

---

## 2. Access model

### 2.1 Development Mode (what a visitor's own Client ID gets)

| Item | Current rule | Date | Label and source |
|---|---|---|---|
| Starting mode | "Newly-created apps begin in **development mode**." | n/a | DOCUMENTED, https://developer.spotify.com/documentation/web-api/concepts/quota-modes |
| Premium | "The app owner must have a Spotify Premium account for apps in development mode to function." Migration guide: "All Development Mode apps require the app owner to have an active Spotify Premium subscription." | New apps 11 Feb 2026; existing apps 9 Mar 2026 | DOCUMENTED, quota-modes page and https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide |
| What Premium means for other users | Page says nothing. Because each visitor owns their own app, the visitor is the owner. | n/a | INFERENCE |
| User cap | "Up to 5 authenticated Spotify users can use an app that is in development mode" | Feb 2026 | DOCUMENTED, quota-modes (raw) |
| Allowlist | "Each Spotify user who installs your app will need to be added to your app's allowlist". A non-allowlisted user's requests "will receive a 403 status code error." | n/a | DOCUMENTED, quota-modes |
| Client IDs per developer | 1 from 11 Feb 2026. **25 from July 2026**: "Developers can now create up to 25 apps per account." | Jul 2026 | DOCUMENTED, https://developer.spotify.com/documentation/web-api/references/changes/july-2026 (raw). The Apps page also says "up to **25 apps** per developer account": https://developer.spotify.com/documentation/web-api/concepts/apps |
| Quota accounting | Before July: per app. Now per developer account: "If you have multiple Client IDs in development mode" they share quota (July changelog, raw). Quota is split into buckets: "Endpoints are grouped into quota buckets and requests to endpoints in the same bucket count toward a shared limit." Groupings and limits "are subject to change." No bucket names, sizes or windows published. | Jul 2026 | DOCUMENTED, July changelog; blog https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates |
| 429 on quota | Body: `{"error":{"status":429,"message":"Too many requests","reason":"QUOTA_EXCEEDED"}}` | Jul 2026 | DOCUMENTED, July changelog (raw) |
| 429 on rate limit | Rolling 30-second window. `Retry-After` header "will normally" be present. Limit is "much higher" in Extended mode. No numbers. | n/a | DOCUMENTED, https://developer.spotify.com/documentation/web-api/concepts/rate-limits |
| Quota reset period | Not published. One developer reports about 22 hours of cooldown after `QUOTA_EXCEEDED`, with ~1,400-1,900 `/v1/search` requests a day and 14-19 monthly users. Original headers not captured. | n/a | DEVELOPER REPORT, https://community.spotify.com/t5/Spotify-for-Developers/Web-API-quota-updates-for-Development-Mode/td-p/7508852 |
| Endpoint restriction | Newly created Client IDs get "a smaller set of supported endpoints" | 11 Feb 2026 | DOCUMENTED, https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security |
| Postponement | Blog update: endpoint access changes for **existing** integrations were postponed. Premium, user cap and one-Client-ID limit still applied to existing integrations. Revised timeline not given. | after 6 Feb 2026 | DOCUMENTED, same blog post (summarising tool). The migration guide still lists 9 Mar 2026 for existing apps. The two pages disagree on whether the endpoint changes reached existing apps. |
| Purpose | Dev Mode is "a sandboxed environment for learning and experimentation" and "should not be relied on as a foundation for building or scaling a business" | Feb 2026 | DOCUMENTED, blog (summarising tool) |
| Redirect URIs | HTTPS required "unless you are using a loopback address". `http://127.0.0.1:PORT` and `http://[::1]:PORT` allowed. "`localhost` is not allowed as redirect URI." Must exactly match. | enforced by Nov 2025 | DOCUMENTED, https://developer.spotify.com/documentation/web-api/concepts/redirect_uri |

### 2.2 Extended Quota Mode

| Item | Rule | Label and source |
|---|---|---|
| Purpose | "for Spotify apps that are ready for a wider audience"; "can be installed by an unlimited number of users"; allowlist no longer applies | DOCUMENTED, quota-modes |
| Who may apply | "as of May 15th 2025, Spotify only accepts applications from organizations (not individuals)." Requirements listed: legally registered entity, launched service, at least 250k MAU, availability in key markets, commercial viability. Review "can take up to six weeks." Partner Application form from a company email first. | DOCUMENTED, quota-modes (raw and summarising tool) |
| Rate limit | Higher than Dev Mode | DOCUMENTED, rate-limits |
| Forum reports that no middle path exists | Several posts. A reply written as the company acknowledges "a gap between Development Mode and Extended Quota for indie developers, with no concrete plan yet" and says the one-app-per-user model "is being redesigned, with no date given" (attribution inferred from wording; the page shows no staff badge). | DEVELOPER REPORT, https://community.spotify.com/t5/Spotify-for-Developers/February-2026-Spotify-for-Developers-update-thread/m-p/7361070 |

### 2.3 Client credentials

| Item | Finding | Label and source |
|---|---|---|
| What the flow is | "does not include user authorization"; "only endpoints that do not access user information can be accessed." Needs a client secret. No refresh. Token lifetime 3600 s. | DOCUMENTED, https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow and https://developer.spotify.com/documentation/web-api/concepts/authorization |
| Token request on 2026-11-23 | HTTP 200. Response keys: `access_token`, `token_type`, `expires_in` (3600). No refresh token. | LIVE-TESTED |
| Endpoints reachable | See section 3, column "App-only". Search, artist, artist albums, album, album tracks and track all returned 200 **without a `market` parameter**. | LIVE-TESTED |
| Is the owner's Premium needed for app-only calls? | Docs do not say. A GitHub maintainer reported a client-credentials albums call failing with a message that the app owner needs Premium (while the owner lacked it). | DEVELOPER REPORT, https://github.com/ramsayleung/rspotify/issues/550. INFERENCE: app-only calls fall under the same Premium rule. |
| Spotify's stated direction | Same issue quotes Spotify as "moving away from the Client Credentials flow for metadata endpoints". Quote is second-hand. | DEVELOPER REPORT, same issue |
| Do client-credentials calls share the account quota? | Not stated. A forum user asked and got no answer. | UNVERIFIED, thread above |
| Refresh-token expiry and client credentials | "Client Credentials flow is not affected, since it issues no user-linked tokens." | DOCUMENTED, https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration (summarising tool) |

### 2.4 Tokens and refresh

| Item | Finding | Label and source |
|---|---|---|
| Access token lifetime | 1 hour | DOCUMENTED, https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens |
| PKCE refresh request | `POST https://accounts.spotify.com/api/token`, `grant_type=refresh_token`, `refresh_token`, `client_id`. No `Authorization` header for PKCE. | DOCUMENTED, refreshing-tokens |
| New refresh token each time? | "Depending on the grant used to get the initial refresh token, a refresh token might not be included in each response." Keep the old one if none returned. | DOCUMENTED, refreshing-tokens |
| Refresh token lifetime | **6 months from the user's authorisation**. "Refreshing an access token does not reset or extend the refresh token's 6-month lifetime." Applies to Authorization Code and PKCE. New apps from 18 Jun 2026, existing apps from 20 Jul 2026. | DOCUMENTED, blog 2026-06-18 and refreshing-tokens |
| Expired token | Token endpoint returns `400` `{"error":"invalid_grant"}`. Discard and re-authorise. | DOCUMENTED, blog 2026-06-18 |
| Implicit grant | Listed "[Deprecated]" in the sidebar. | DOCUMENTED, authorization concepts page |
| Storing a refresh token in the browser | The docs do not discuss it. Spotifort's rule (token in memory only) is its own. | INFERENCE |

---

## 3. Endpoint inventory

Status key for a new Dev Mode app: **available** (documented and not listed as removed), **changed**, **removed** (listed as removed in the February 2026 migration guide), **deprecated** (labelled deprecated on its reference page), **unclear**.

Important reading note: the reference pages still document removed endpoints. For example `GET /artists/{id}/top-tracks` and `GET /artists/{id}/related-artists` and `GET /recommendations` show a "Deprecated" badge, not "Removed". The migration guide lists top-tracks as removed. Live test returned 403 for top-tracks and related-artists. I treat the live result and the migration guide as the Dev Mode truth, and the reference page as the Extended-mode/legacy truth. INFERENCE.

"App-only" column: LIVE-TESTED result with the client-credentials token, or n/a (needs user), or "not tested".

Source abbreviations: **MG** = https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide ; **CL-Feb/Mar/May/Jul** = https://developer.spotify.com/documentation/web-api/references/changes/{february,march,may,july}-2026 ; **REF** = https://developer.spotify.com/documentation/web-api/reference/<slug>.

### 3.1 Search

| Endpoint | Status | Scopes | Limits | Fields removed or deprecated | Change and date | App-only | Source |
|---|---|---|---|---|---|---|---|
| `GET /search` | changed | none listed ("OAuth 2.0") | `limit` 0-10, default 5; `offset` 0-1000; types: album, artist, playlist, track, show, episode, audiobook | Deprecated on page: `available_markets`, `popularity`, `preview_url`. Live: artist results carry only `external_urls,href,id,images,name,type,uri` (no `genres`, `popularity`, `followers`). Track results carry `external_ids`, no `popularity`, no `preview_url`. | `limit` max 50 to 10, default 20 to 5, 11 Feb 2026 (MG, CL-Feb) | 200. `limit=11` gives 400 "Invalid limit". `type=track&q=artist:"<name>"` 200, 6 tracks. `type=playlist` 200. | REF `search`; MG; live |

Field filters in `q`: `artist`, `year`, `album`, `genre`, `isrc`, `track`, `upc`, `tag:new`, `tag:hipster`. Source: REF `search`. The `genre:` filter is documented; its effect when artist `genres` are absent was not tested.

Result order for the track search: the response has no `popularity`, so order cannot be checked against popularity. For one lineup artist the six results were ordered: four tracks by that artist alone, then two collaborations (live, one artist). A forum reply written as the company says artist search results are "ranked based on relevance", noted as undocumented (DEVELOPER REPORT, February update thread above).

### 3.2 Albums

| Endpoint | Status | Scopes | Limits | Fields removed or deprecated | Change and date | App-only | Source |
|---|---|---|---|---|---|---|---|
| `GET /albums/{id}` | available | none listed | tracks paged inside the object; no `limit` parameter | Deprecated: `available_markets`, `genres` ("always empty"), `label`, `popularity`; track items `available_markets`, `linked_from`, `preview_url`. `external_ids` present. | Field removals 11 Feb 2026; `external_ids` restored Mar 2026 (CL-Mar) | 200 (keys: `album_type,total_tracks,external_urls,href,id,images,name,release_date,release_date_precision,type,uri,artists,tracks,copyrights,external_ids,genres`) | REF `get-an-album`; live |
| `GET /albums?ids=` | removed | n/a | n/a | n/a | 11 Feb 2026 (MG) | 403 | MG; live |
| `GET /albums/{id}/tracks` | available | none listed | `limit` default 20, max 50; `offset` | Deprecated: `available_markets`, `linked_from`, `preview_url` | n/a | 200 (keys: `artists,disc_number,duration_ms,explicit,external_urls,href,id,name,track_number,type,uri,is_local`) | REF `get-an-albums-tracks`; live |
| `GET /me/albums` | available | `user-library-read` | `limit` max 50, default 20 | Deprecated: album `available_markets`, `genres`, `label`, `popularity`; track items `available_markets`, `linked_from`, `preview_url` | n/a | n/a (user) | REF `get-users-saved-albums` |
| `PUT /me/albums`, `DELETE /me/albums`, `GET /me/albums/contains` | removed | n/a | n/a | n/a | replaced by `/me/library` 11 Feb 2026 (MG) | n/a | MG |
| `GET /browse/new-releases` | removed | n/a | n/a | n/a | 11 Feb 2026 (MG) | 403 | MG; live |

### 3.3 Artists

| Endpoint | Status | Scopes | Limits | Fields removed or deprecated | Change and date | App-only | Source |
|---|---|---|---|---|---|---|---|
| `GET /artists/{id}` | available, fields reduced | none listed | one id | Deprecated on page: `followers`, `genres`, `popularity`. `images` is not deprecated. Live response keys: `external_urls,href,id,images,name,type,uri`. Three image sizes (640, 320, 160 px), all on host `i.scdn.co`. | `followers`, `popularity` removed 11 Feb 2026 (MG). `genres` is deprecated on the page and absent live. | 200 | REF `get-an-artist`; MG; live |
| `GET /artists?ids=` | removed | n/a | n/a | n/a | 11 Feb 2026 (MG) | 403 | MG; live |
| `GET /artists/{id}/albums` | changed | none listed | `limit` default 5, max 10; `include_groups` album, single, appears_on, compilation | Deprecated: `available_markets`, `album_group` | `limit` max reduced to 10 (page and live; the migration guide's limit table lists only search) | 200. `limit=11` gives 400. | REF `get-an-artists-albums`; live |
| `GET /artists/{id}/top-tracks` | removed | n/a | n/a | n/a | 11 Feb 2026 (MG). Reference page shows "Deprecated", no replacement named. | 403 | MG; REF `get-an-artists-top-tracks`; live |
| `GET /artists/{id}/related-artists` | blocked | n/a | n/a | `followers`, `genres`, `popularity` deprecated on page | Not in the MG removal list. Reference page shows "Deprecated". | 403 | REF `get-an-artists-related-artists`; live; CLAUDE.md |

### 3.4 Tracks

| Endpoint | Status | Scopes | Limits | Fields removed or deprecated | Change and date | App-only | Source |
|---|---|---|---|---|---|---|---|
| `GET /tracks/{id}` | available | none listed | one id | Deprecated: `available_markets`, `popularity`, `preview_url`, `linked_from`. `external_ids` not deprecated. | removals 11 Feb 2026; `external_ids` restored Mar 2026 | 200 (keys: `album,artists,disc_number,duration_ms,explicit,external_ids,external_urls,href,id,is_local,is_playable,name,track_number,type,uri`) | REF `get-track`; live |
| `GET /tracks?ids=` | removed | n/a | n/a | n/a | 11 Feb 2026 (MG) | not tested (batch albums/artists returned 403) | MG |
| `GET /me/tracks` | available | `user-library-read` | `limit` default 20, max 50; `offset` | Deprecated: `album.available_markets`, `track.available_markets`, `linked_from`, `popularity`, `preview_url` | n/a | n/a (user) | REF `get-users-saved-tracks` |
| `PUT/DELETE /me/tracks`, `GET /me/tracks/contains` | removed | n/a | n/a | n/a | replaced by `/me/library` 11 Feb 2026 (MG) | n/a | MG |
| `GET /audio-features/{id}`, `GET /audio-features`, `GET /audio-analysis/{id}` | blocked | n/a | n/a | n/a | Not in the MG removal list. | `audio-features/{id}` 403 | CLAUDE.md; live |
| `GET /recommendations` | blocked | n/a | n/a | page marks `popularity`, `preview_url`, `available_markets` deprecated | Reference page "Deprecated". | not tested | REF `get-recommendations`; CLAUDE.md (403 recorded) |

### 3.5 Library (new group)

| Endpoint | Status | Scopes | Limits | Notes | Change and date | Source |
|---|---|---|---|---|---|---|
| `PUT /me/library` | available (new) | `user-library-modify`, `user-follow-modify`, `playlist-modify-public` (page lists all three) | `uris` max 40 | URI types: track, album, episode, show, audiobook, user, playlist. **Artist is not in the list on the page.** One forum user reports a save of 43 artist URIs succeeded and followed them. | Added 11 Feb 2026 (CL-Feb) | REF `save-library-items`; DEVELOPER REPORT https://community.spotify.com/t5/Spotify-for-Developers/Restore-Web-API-write-access-for-individual-developers/m-p/7474338 |
| `DELETE /me/library` | available (new) | same three | `uris` max 40 | URI types: track, album, episode, show, audiobook, user, playlist | 11 Feb 2026 | REF `remove-library-items` |
| `GET /me/library/contains` | available (new) | `user-library-read`, `user-follow-read`, `playlist-read-private` | `uris` max 40 | URI types include **artist**. Response is an array of booleans. | 11 Feb 2026 | REF `check-library-contains` |

Reference page for the old `PUT /me/following`: "This endpoint is deprecated. Use Save Items to Library instead." Source: REF `follow-artists-users`.

### 3.6 Users

| Endpoint | Status | Scopes | Limits | Fields removed or deprecated | Change and date | App-only | Source |
|---|---|---|---|---|---|---|---|
| `GET /me` | changed | `user-read-private`, `user-read-email` for the gated fields | n/a | Deprecated: `country`, `email`, `explicit_content`, `followers`, `product`. Present: `display_name`, `external_urls`, `href`, `id`, `images`, `type`, `uri`, **`account_id`**. | removals 11 Feb 2026; `account_id` added May 2026 (CL-May: "A public, immutable, pseudoanonymous identifier") | 401 "Valid user authentication required" | REF `get-current-users-profile`; CL-May (raw); live |
| `GET /me/top/{type}` | available | `user-top-read` | `limit` default 20, max 50; `time_range` short_term (~4 weeks), medium_term (~6 months), long_term (~1 year) | Artist objects: `followers`, `genres`, `popularity` deprecated. Track objects: `available_markets`, `linked_from`, `popularity`, `preview_url`. | n/a | n/a | REF `get-users-top-artists-and-tracks` |
| `GET /me/following?type=artist` | available | `user-follow-read` | `limit` default 20, max 50; cursor `after` | `followers`, `genres`, `popularity` deprecated | n/a | n/a | REF `get-followed` |
| `PUT /me/following`, `DELETE /me/following`, `GET /me/following/contains` | deprecated/removed | n/a | n/a | n/a | replaced by `/me/library` (MG). Page: "Use Save Items to Library instead." | n/a | MG; REF `follow-artists-users` |
| `GET /users/{id}` | removed | n/a | n/a | n/a | 11 Feb 2026 (MG) | n/a | MG |
| `GET /users/{id}/playlists` | removed | n/a | n/a | n/a | 11 Feb 2026 (MG) | n/a | MG |
| `PUT/DELETE /playlists/{id}/followers`, `GET /playlists/{id}/followers/contains` | removed | n/a | n/a | n/a | replaced by `/me/library` 11 Feb 2026 | n/a | MG |

### 3.7 Playlists

| Endpoint | Status | Scopes | Limits | Fields removed or deprecated | Change and date | Source |
|---|---|---|---|---|---|---|
| `POST /me/playlists` (Create Playlist) | available | `playlist-modify-private` (private); `playlist-modify-public` (public). Collaborative needs both. | each user generally limited to 11,000 playlists | Body: `name` (required, "doesn't need to be unique"), `public` (**default true**), `collaborative`, `description`. Returns 201 and the playlist object. Response `tracks` deprecated, use `items`. | `POST /users/{user_id}/playlists` removed 11 Feb 2026 (MG) | REF `create-playlist` |
| `POST /users/{user_id}/playlists` | removed | n/a | n/a | n/a | 11 Feb 2026 | MG |
| `POST /playlists/{id}/items` (Add Items) | available | `playlist-modify-public`, `playlist-modify-private` | "A maximum of 100 items can be added in one request." `uris` in body recommended. | n/a | Replaces `POST /playlists/{id}/tracks` (page labelled "[DEPRECATED]": "Use Add Items to Playlist instead.") | REF `add-items-to-playlist`; REF `add-tracks-to-playlist` |
| `GET /playlists/{id}/items` | changed | `playlist-read-private` | `limit` default 20, max 50 | Only for playlists the user owns or collaborates on: "A `403 Forbidden` status code will be returned if the user is neither the owner nor a collaborator". | Replaces `/tracks`, 11 Feb 2026 | REF `get-playlists-items`; MG |
| `PUT /playlists/{id}/items`, `DELETE /playlists/{id}/items` | available | modify scopes (not individually fetched) | not fetched | DELETE body key `tracks` renamed `items` (MG) | Renamed 11 Feb 2026 | MG |
| The four old `/tracks` playlist endpoints | deprecated | n/a | n/a | n/a | Marked "[DEPRECATED]" in the reference sidebar. The May 2026 changelog page shows the labels in its sidebar but has no text about them. Date of the deprecation label is UNVERIFIED. | CL-May sidebar (raw); REF pages |
| `GET /playlists/{id}` | changed | not stated on the part read | n/a | `items`/`tracks` "only available for playlists owned by the current user or playlists the user is a collaborator of." `description` "Only returned for modified, verified playlists, otherwise null." Image URLs "temporary and will expire in less than a day." | `tracks` renamed `items` 11 Feb 2026 | REF `get-playlist`; MG |
| `GET /me/playlists` | available | `playlist-read-private` (and `playlist-read-collaborative` per scopes page) | `limit` default 20, max 50; `offset` max 100,000 | `tracks` deprecated, use `items` | n/a | REF `get-a-list-of-current-users-playlists` |
| `PUT /playlists/{id}` (Change Playlist Details) | available | modify scopes (not fetched) | n/a | n/a | n/a | REF listing only; UNVERIFIED details |
| `PUT /playlists/{id}/images` (custom cover) | available | `ugc-image-upload`, `playlist-modify-public`, `playlist-modify-private` | Base64 JPEG, max 256 KB payload. Response 202. | n/a | n/a | REF `upload-custom-playlist-cover` |
| `GET /playlists/{id}/images` | listed | not fetched | n/a | n/a | n/a | REF listing only |
| `GET /browse/featured-playlists`, `GET /browse/categories/{id}/playlists` | blocked / unclear | n/a | n/a | n/a | Featured playlists not in the MG removal list. CLAUDE.md records 403. | CLAUDE.md; not re-tested |
| Public playlist read by an app-only token | `GET /playlists/37i9dQZF1DXcBWIGoYBM5M` (a Spotify editorial playlist) returned 404 | n/a | n/a | n/a | n/a | LIVE-TESTED. I did not try a user-created public playlist id. |

### 3.8 Player

All Player endpoints need a user token. The February changelog summary says player endpoints remain. Scopes below for rows I did not fetch come from the scopes page descriptions and are UNVERIFIED per endpoint.

| Endpoint | Status | Scopes | Notes | Source |
|---|---|---|---|---|
| `PUT /me/player/play` (Start/Resume) | available | `user-modify-playback-state` | "This API only works for users who have Spotify Premium." Body: `context_uri` ("Valid contexts are albums, artists & playlists."), `uris`, `offset`, `position_ms`. Optional `device_id`. 204 on success. | REF `start-a-users-playback` |
| `GET /me/player/recently-played` | available | `user-read-recently-played` | `limit` default 20, max 50; `after`/`before` Unix ms; "Currently doesn't support podcast episodes." History depth not stated. Deprecated fields: track `available_markets`, `linked_from`, `popularity`, `preview_url`; album `available_markets`. | REF `get-recently-played` |
| `GET /me/player`, `GET /me/player/devices`, `GET /me/player/currently-playing`, `GET /me/player/queue` | available (listed) | `user-read-playback-state`, `user-read-currently-playing` | not fetched | REF listing; scopes page |
| `PUT /me/player` (transfer), pause, next, previous, seek, repeat, volume, shuffle, `POST /me/player/queue` | available (listed) | `user-modify-playback-state` | not fetched; Premium expected | REF listing; scopes page |

### 3.9 Other groups

| Group | Endpoints | Status for a new Dev Mode app | Source |
|---|---|---|---|
| Audiobooks | `GET /audiobooks/{id}`, `GET /audiobooks`, chapters list, saved audiobooks | Batch removed (MG). Saved audiobooks moved to `/me/library`. Single reads unclear. | MG; REF nav |
| Categories | `GET /browse/categories`, `GET /browse/categories/{id}` | removed | MG |
| Chapters | `GET /chapters/{id}`, `GET /chapters` | batch removed; single unclear | MG |
| Episodes | `GET /episodes/{id}`, `GET /episodes`, saved episodes | batch removed; saved moved to library; single unclear | MG |
| Shows | `GET /shows/{id}`, `GET /shows`, show episodes, saved shows | batch removed; saved moved to library; single unclear. Show `available_markets`, `publisher` removed. | MG |
| Genres | `GET /recommendations/available-genre-seeds` | **404** app-only | LIVE-TESTED; endpoint listed in REF nav as `get-recommendation-genres` |
| Markets | `GET /markets` | removed | MG |
| Markets/relinking | Track Relinking concept page exists. `linked_from` removed. | not fetched | MG |

---

## 4. Scopes

Source for the full list: https://developer.spotify.com/documentation/web-api/concepts/scopes (summarising tool; descriptions quoted as returned). The page says nothing about deprecated or removed scopes.

| Scope | What it unlocks (per the page) | Used by Spotifort today |
|---|---|---|
| `user-library-read` | "Read access to a user's library." Saved tracks, saved albums, `/me/library/contains`. | yes |
| `user-library-modify` | "Write/delete access to a user's 'Your Music' library." `PUT/DELETE /me/library` for tracks and albums. | no |
| `user-top-read` | "Read access to a user's top artists and tracks." | yes |
| `user-follow-read` | "Read access to the list of artists and other users that the user follows." Followed artists. | yes |
| `user-follow-modify` | "Write/delete access to the list of artists and other users that the user follows." Listed on `PUT/DELETE /me/library`. | no |
| `user-read-recently-played` | "Read access to a user's recently played tracks." | no |
| `user-read-playback-position` | "Read access to a user's playback position in a content." (podcasts) | no |
| `user-personalized` | "Get personalized content for the user." No endpoint found that uses it. | no |
| `playlist-read-private` | "Read access to user's private playlists." | no |
| `playlist-read-collaborative` | "Include collaborative playlists when requesting a user's playlists." | no |
| `playlist-modify-private` | "Write access to a user's private playlists." | no |
| `playlist-modify-public` | "Write access to a user's public playlists." | no |
| `ugc-image-upload` | "Write access to user-provided images." Playlist cover. | no |
| `user-read-playback-state` | "Read access to a user's player state." | no |
| `user-modify-playback-state` | "Write access to a user's playback state" | no |
| `user-read-currently-playing` | "Read access to a user's currently playing content." | no |
| `streaming` | "Control playback of a Spotify track. This scope is currently available to the Web Playback SDK." Premium required. | no |
| `app-remote-control` | "Remote control playback of Spotify. This scope is currently available to Spotify iOS and Android SDKs." | no |
| `user-read-email` | "Read access to user's email address." | no |
| `user-read-private` | "Read access to user's subscription details (type of user account)." | no |
| `user-soa-link`, `user-soa-unlink`, `soa-manage-entitlements`, `soa-manage-partner`, `soa-create-partner` | Open Access (partner account linking). Not relevant to a public web app. | no |

Gone: no scope is documented as removed. Fields gated by scopes (`email`, `product`, `country`) are themselves deprecated on `GET /me`, so `user-read-private` and `user-read-email` may return little. INFERENCE.

Scope of any scope request on a Dev Mode app: UNVERIFIED whether Dev Mode restricts which scopes a login may request. The reports found concern 403s on endpoints, not scopes.

---

## 5. Other Spotify surfaces

Current Spotifort CSP (public/_headers): `default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://api.spotify.com https://accounts.spotify.com https://cloudflareinsights.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`. Also `X-Frame-Options: DENY`, `Permissions-Policy` with camera, microphone, geolocation, payment, usb blocked.

`frame-ancestors 'none'` and `X-Frame-Options: DENY` stop other sites framing Spotifort. They do not stop Spotifort framing another site. Framing is governed by `frame-src` (falling back to `child-src`, then `default-src`). With `default-src 'self'` and no `frame-src`, a Spotify iframe is blocked. INFERENCE from CSP semantics.

| Surface | What it does | Requirements | What it would need from Spotifort's CSP | Label and source |
|---|---|---|---|---|
| Embed iframe | `<iframe src="https://open.spotify.com/embed/track/{ID}">`. Supports podcasts, episodes, tracks, playlists, artists and albums. Heights 352, 232, 152, 80 px; min width 280 px. Needs `allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"`. No API call and no token. Using Embeds means accepting the Developer Terms. | none | `frame-src https://open.spotify.com`. The embed loads its own resources inside the frame, which Spotifort's CSP does not govern. `Permissions-Policy` has no entry for `autoplay` or `encrypted-media`, so defaults apply. | DOCUMENTED, https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed (raw and summarising tool); https://developer.spotify.com/documentation/embeds. CSP needs are INFERENCE. |
| Embed login/preview behaviour (30 s preview vs full track) | Page does not say. | n/a | n/a | UNVERIFIED |
| iFrame API | Script `https://open.spotify.com/embed/iframe-api/v1`. Define `window.onSpotifyIframeApiReady`, then `IFrameAPI.createController(element, {uri|url, width, height}, cb)`. Controller: `loadEntity(uriOrUrl, preferVideo, startAt)`, `loadUri`, `play`, `pause`, `resume`, `togglePlay`, `restart`, `seek`, `destroy`. Events: `ready`, `playback_started`, `playback_update`. "Programmatic playback 'might not be supported in all browsers and for all users'." | none | `script-src https://open.spotify.com` plus `frame-src https://open.spotify.com`. The page's inline `window.onSpotifyIframeApiReady` assignment would have to live in a same-origin script file (no inline script allowed). Whether the API script itself needs further hosts is UNVERIFIED. | DOCUMENTED, https://developer.spotify.com/documentation/embeds/tutorials/using-the-iframe-api and https://developer.spotify.com/documentation/embeds/references/iframe-api. Entity types accepted by `loadEntity` are not listed (all examples use episodes): UNVERIFIED for artists/tracks. |
| oEmbed | `GET https://open.spotify.com/oembed?url=<encoded Spotify URL>`. Response: `html`, `width`, `height`, `version`, `provider_name`, `provider_url`, `type` ("rich"), `title`, `thumbnail_url`, `thumbnail_width`, `thumbnail_height`. No auth mentioned. | none stated | `connect-src https://open.spotify.com` for a browser fetch, if CORS permits. Thumbnails need `img-src` for the thumbnail host. CORS behaviour and supported types are not documented. | DOCUMENTED, https://developer.spotify.com/documentation/embeds/tutorials/using-the-oembed-api. CORS: UNVERIFIED. |
| Web Playback SDK | Client-side JS library creating a local Spotify Connect device in the browser. Script `https://sdk.scdn.co/spotify-player.js`. | "requires a Spotify Premium subscription". Needs a user access token ("expires in 1 hour"). Scope `streaming` (scopes page). Iframes need "encrypted-media and autoplay" allowed. iOS: playback does not start automatically after transfer. "must not be used in commercial projects without Spotify's prior written approval." Works in a Dev Mode app: UNVERIFIED. | `script-src https://sdk.scdn.co`; the SDK opens its own iframe and connections (hosts not documented on the pages read): UNVERIFIED. | DOCUMENTED, https://developer.spotify.com/documentation/web-playback-sdk and https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started |
| Web API Player (`PUT /me/player/play`) | Starts playback on the user's existing Spotify Connect device. Valid contexts: albums, artists, playlists. | user token, `user-modify-playback-state`, Premium, an active device | `connect-src https://api.spotify.com` already allowed | DOCUMENTED, REF `start-a-users-playback` |
| `open.spotify.com` links | `https://open.spotify.com/artist/{id}` etc. "When a user with the Spotify client installed visits one, 'it will launch the Client and navigate to the requested resource.'" Plain `<a>` links need no CSP entry. | none | none (navigation) | DOCUMENTED, https://developer.spotify.com/documentation/web-api/concepts/spotify-uris-ids (the page's only example is a track; artist behaviour is not stated) |
| `spotify:` URIs | `spotify:track:{id}` form. "You can paste one into the search box of the Spotify Desktop Client." Whether a browser link with `href="spotify:artist:..."` is supported is not stated. `form-action 'self'` does not block link navigation. | Spotify desktop client installed | none | DOCUMENTED (format only); link behaviour UNVERIFIED |
| Pre-fill a playlist, or start playback of an artist, from a link without the API | No documented URL parameter or scheme. The URIs page mentions no query parameters. | n/a | n/a | UNVERIFIED (searched the pages above; nothing found) |
| Cover art and artist images | Delivered from `i.scdn.co` (LIVE-TESTED for artist images). URLs in playlist responses "expire in less than a day". Rules: original form only; no crop, overlay, animation or blur; link back and attribute. | none | `img-src https://i.scdn.co` (currently `img-src 'self' data:`) | host LIVE-TESTED; rules DOCUMENTED in https://developer.spotify.com/documentation/design (raw) |
| iOS / Android SDK | iOS SDK works through the installed Spotify app (iOS 12+), uses `app-remote-control`. Not relevant to a web page. Premium requirement not stated on the page read. | native app | n/a | DOCUMENTED briefly, https://developer.spotify.com/documentation/ios |

---

## 6. Policy constraints that bind this project

Documents and versions read in raw HTML on 2026-11-23:

- Developer Terms, "Version 10, effective as of 15 May, 2025": https://developer.spotify.com/terms
- Developer Policy, "Effective as of 15 May, 2025": https://developer.spotify.com/policy
- Design and branding guidelines: https://developer.spotify.com/documentation/design

Section numbers for the Terms below follow the page's section headings (I to X). I could not confirm sub-numbering such as "IV.3.1" from raw text, so I give the section and the heading words. The summarising tool gave numbers like IV.3.1(a); the raw text shows "Storing and displaying content" under Section IV.

"SDA" is defined as "any application, website or service that accesses the Spotify Service or Spotify Content through, or which incorporates, the Spotify Platform" (Terms, definitions, raw). Spotifort is an SDA.

### 6.1 Naming

| Source | Exact text (raw) | What it covers |
|---|---|---|
| Developer Policy, VI "Naming and Branding" | "You must also follow the Branding Guidelines when naming your SDA. For example, the name should not begin with “Spot” or be confusing in sound or spelling to Spotify. Unless you have applicable permissions, don’t imply any endorsement, tie-in, co-branding or promotion by Spotify." | The name of the SDA, that is the app or service. It is an example under a "must follow the Branding Guidelines" sentence. The wording is "should not", and it is given as an example. It does not mention playlist names. |
| Branding Guidelines (design page) | "The app name should not include 'Spotify' or be similar to 'Spotify' in sound or spelling. It shouldn't imply endorsement by Spotify, but suggesting to users that it is 'for Spotify' is acceptable." and "Don't incorporate Spotify's trademarks, in whole or in part, in the name of your company, product, application, service, or website." | The app name as entered on the Dashboard (the name is shown to users when they authorise), and the name of the company, product, service or website. |
| Developer Terms, Section VII (IP) | "You agree not to attempt to use or register any trademark or domain name that includes the word “Spotify,” any other Spotify trademark, or any name that is confusingly similar to any of them." | Trademarks and domain names. |
| Developer Terms, Section IV, "Illegal or unauthorized purpose" | "misusing Spotify Intellectual Property, such as using Spotify Marks as part of the name of your company or service." | Company or service name. |
| Developer Terms definition | "Spotify Marks" means "all trademarks, service marks, logos, brand names, or trade names used to identify Spotify and its products or services". | n/a |

Facts about "Spotifort": it begins with the letters "Spot". It does not contain the word "Spotify". It shares the first five letters ("Spoti") with "Spotify". Whether it is "confusing in sound or spelling" or incorporates a trademark "in part" is a judgment the pages do not make. UNVERIFIED how Spotify applies it.

Playlist title "Spotifort: Treefort 2027": none of the passages above mention names a user's playlist carries. The Policy says to follow Branding Guidelines "when naming your SDA", and the guidelines' playlist text concerns showing Spotify's own titles unaltered ("Don't manipulate any content or metadata"). A playlist the app creates in the user's account with its own name is not addressed. INFERENCE.

The Policy also says "your SDA must not have a specific artist or artists as the sole subject of the SDA unless you have applicable permissions" (Policy II, raw). Whether a festival lineup counts is not addressed. INFERENCE only.

### 6.2 Storing and caching Spotify content

| Source | Text (raw) | Relevance |
|---|---|---|
| Terms IV "Storing and displaying content" | "you may not store, aggregate or create compilations or databases of Spotify Content, other than as strictly necessary to operate your SDA. You must use reasonable efforts to ensure that any data you display to users is the most up to date data available through the Spotify Platform, and to delete older data. Do not store Spotify Content indefinitely." | The pipeline commits Spotify ids and other data in `data/<year>/state.json` and `public/data/<year>/lineup.json`. |
| Terms IV "Local caching" | "Do not locally cache any Spotify Content, except as strictly necessary to enhance the performance of your SDA and its functionality, and limited to the temporary caching of: metadata and cover art; or Conditional Downloads of sound recordings." | Applies to `.cache/` and to precomputed track ids. |
| Terms, definition | "Spotify Content" is "any content, data, information or material made available through the Spotify Platform, Spotify Service or by Spotify ... metadata, playlists, and user data including Spotify Personal Data." | Whether a bare Spotify artist or track id is "Spotify Content" is not stated. UNVERIFIED. |
| Terms IV "Improper use" | "including using any robot, spider, site search/retrieval application, or other tool to retrieve, duplicate, or index any portion of the Spotify Service or Spotify Content (which includes playlist data)" | Applies to the scheduled pipeline. |
| Policy II "Display metadata and cover art when streaming" | "metadata and cover art may only be used in connection with the underlying content" (for a Streaming SDA) | Not obviously relevant. |
| Terms V "Users & Data" | "You may only process Spotify Personal Data for as long as is necessary to provide your SDA to the applicable user"; "you must obtain explicit consent from the user who provided the data to us before using it for any purpose other than displaying it back to the user on your SDA." | Library import in the browser. |
| Policy I | "you must provide all users with an easily accessible mechanism to disconnect their Spotify account from your SDA at any time and provide clear instructions on how to do so." On disconnect, "delete and no longer request or process any of that user's personal data." | Matches the existing "Remove" and "Forget my data" controls. Relevance of the pool (artist names derived from the library) is a judgment. |

### 6.3 Combining with other services

| Source | Text (raw) | Notes |
|---|---|---|
| Policy III | "Do not create any product or service which is integrated with streams or content from another service." | Context is a list of prohibited application types. Whether Last.fm similarity or MusicBrainz links count as "content from another service" is not defined. UNVERIFIED. |
| Policy III | "Do not build an SDA that enables the transfer of data to another service, except for the purpose of enabling a user to transfer their personal data, or the metadata of the user's playlists to another service." | Relevant to Tidal and Apple Music planned sources, and to share links. |
| Policy III | "Do not build products and services that mimic, or replicate or attempt to replace a core user experience of Spotify ... Your product or service must add independent value or functionality that improves users' interactions with Spotify." | n/a |
| Terms IV "Transfer to third parties" | "do not transfer Spotify Content to third parties, including directly or indirectly transferring any data (including aggregate, anonymous or derivative data) received from Spotify to, or use such data in connection with, any ad network, ad exchange, data broker, or other advertising or monetization-related toolset, even if a user consents". Hosting providers ("third party data processors") are allowed. | Cloudflare Web Analytics is not fed Spotify data by Spotifort. Whether page-visit counts are "derivative data" is not addressed. |
| Branding Guidelines | "Spotify content should never be seated next to content from similar services. Dedicate the full row (shelf) in the view to Spotify content." and "Platforms that aggregate content from multiple audio providers must give Spotify fair treatment - anything made available to all other partners must be available" (truncated in my read). | Listen-link rows with several services. The guideline text is written for content shelves; its application to a link row is a judgment. |

### 6.4 Attribution, logo, links, wording

| Rule | Text | Source |
|---|---|---|
| Attribution | "If you display any Spotify Content you must clearly attribute the content as being supplied and made available by Spotify, by using the Spotify Marks." "Metadata, cover art and Audio Preview Clips must be accompanied by a link back to the applicable album, content or playlist on the Spotify Service." | Policy II (raw) |
| Logo | "you must always attribute content from Spotify with the logo." "In partner integrations, you should always use our full logo (icon + wordmark)." Icon alone only if space is short or the brand is established. Green logo only on black or white backgrounds. Do not alter. Minimum sizes 70 px (full logo) and 21 px (icon) in the summarising tool's reading. | Design page (raw, minimum sizes from summarising tool) |
| Link wording | "If the Spotify app is not installed then the link should say, GET SPOTIFY FREE. If the Spotify app is installed then use any of the following text strings: OPEN SPOTIFY, PLAY ON SPOTIFY or LISTEN ON SPOTIFY." Applies "On a platform where Spotify already exists" (mobile and desktop integrations). The page does not address a plain website. | Design page (raw) |
| Titles | "Don't manipulate any content or metadata." Titles must be shown as provided. Layouts sized for 25 characters (playlist/album), 18 (artist), 23 (track). | Design page (raw) |
| Content set size | "Never show more than 20 items in a content set." | Design page (raw) |
| Cover art | Original form; no crop, blur, animation, overlay; round corners 4 px small/medium, 8 px large devices (summarising tool); no brand over artwork. | Design page |
| Standalone service | "You must not offer metadata, cover art, and/or Audio Preview Clips as a standalone service or product." | Policy II (raw) |
| Preview clips | Only to promote the underlying content, with a link back. `preview_url` is absent in live responses. | Policy V (raw); live |
| Endorsement | "You may not suggest a partnership with, sponsorship by, or endorsement by Spotify without Spotify's prior written approval." Policy: "don't imply any endorsement, tie-in, co-branding or promotion by Spotify". Brand pairing: "Don't use the Spotify brand together with any other brand or in any co-branded communications." | Terms IX (Publicity); Policy II, VI; design page (raw) |
| Logo of the app | "Your logo should not include, or look similar to the Spotify logo or any of its brand elements (e.g. Spotify Green, the circle, and the waves)." | Design page (raw) |
| Marks licence | Spotify Marks from the Branding Guidelines may be used "solely to promote your use, and the results of your use, of the Spotify Platform." | Terms III (raw) |

### 6.5 Analytics and profiling on Spotify data

| Text | Source |
|---|---|
| "Do not analyze the Spotify Content or the Spotify Service for any purpose, including without limitation, creating new or derived listenership metrics, benchmarking, functionality, usage statistics, user metrics, or building profiles of users, including for the purpose of targeting them with advertising or marketing." | Policy III (raw) |
| "Only request and process the data that is needed to operate your SDA." | Policy I (raw) |
| "Do not use the Spotify Platform or any Spotify Content to train a machine learning or AI model or otherwise ingest Spotify Content into a machine learning or AI model." | Policy III (raw) |
| Matching a visitor's library against a lineup is "functionality" the app provides. Whether that is "analysis ... for any purpose" is not addressed. | INFERENCE: UNVERIFIED |

The Cloudflare Web Analytics beacon counts page visits only; Spotifort sends it no Spotify data (project design, per CLAUDE.md). Not a Spotify-documented question.

### 6.6 Bring-your-own Client ID

| Text | Source |
|---|---|
| "You must use a separate Security Code for each SDA. You may not use more than one Security Code for each SDA." | Terms VI "Security Codes" and Policy VII (raw) |
| "the appropriate Security Code must be embedded in your SDA ... in a secure manner not accessible by third parties." | Terms VI (raw) |
| "You may not sell, transfer, sublicense or otherwise disclose your account or Security Codes to any other party or use it for any other purpose except in connection with your SDA." | Terms VI (raw) |
| "To access and use the Spotify Platform, you must link your developer account to a Spotify account." | Policy VII (raw) |
| "You must use the additional quota granted only for the use case that Spotify reviewed." | Policy VII (raw) |
| The Terms and Policy do not mention apps where each end user supplies their own Client ID. | Searched raw text of both: no match. |
| Under that model Spotifort (the SDA, a website) accesses the platform with a different Security Code per visitor, none of which Spotifort owns. Whether that satisfies the "one Security Code for each SDA" sentence is not addressed. | INFERENCE: UNVERIFIED |
| "Terms V": "You must display and require end users to agree to an enforceable end user agreement reflecting at least the following minimum terms", and a privacy policy must be displayed. In the BYOCID flow the visitor accepts Spotify's terms when creating their own app. | Terms V (raw, partial) |

### 6.7 Commercial use and streaming

| Text | Source |
|---|---|
| "Spotify is for personal, non-commercial use". "Except for the limited commercial uses for Non-Streaming SDAs ... commercial uses are not permitted for SDAs." Non-Streaming SDAs may sell advertising or access. | Policy III, IV (raw) |
| "Streaming" means "using the Spotify Platform to enable playback of sound recordings ... including using the Spotify Platform to control a background Spotify application." Widgets and Audio Preview Clips are not Streaming. | Terms definitions (raw) |
| Playlist creation involves no playback. Whether it makes Spotifort a Streaming SDA: not by the definition. Embeds are Widgets, which "are not included in the definition of an SDA" (Terms, raw). | INFERENCE |

---

## 7. Feature map for Spotifort

"Feasible today" is about API availability only, not about whether to build it. All user-token rows are UNTESTED here (no user token was used) unless a source says otherwise; "yes" therefore means "documented as available and not listed as removed".

| Feature | Endpoints or surface | Scopes | Feasible today | Main risk |
|---|---|---|---|---|
| Liked Songs import | `GET /me/tracks`, 50 per page | `user-library-read` | yes (the owner's live login read 2,998 tracks per PLAN-2027.md, 2026-11-13; not re-run today) | Per-account quota buckets are unpublished; a large library is many requests. `QUOTA_EXCEEDED` 429. |
| Top artists | `GET /me/top/artists`, medium_term and long_term, 50 each | `user-top-read` | yes | Artist `genres`, `popularity` absent. Only ids and names are used, so no effect. |
| Followed artists | `GET /me/following?type=artist`, cursor paging, 50 per page | `user-follow-read` | yes | None documented. |
| Pipeline artist search | `GET /search?type=artist`, client credentials | none | yes (LIVE-TESTED 200, limit 10 allowed, 5 used) | Search `limit` ceiling 10; no `popularity`, so ambiguous same-name artists cannot be ranked by popularity. Owner's Premium must stay active. |
| Album-link resolution | `GET /albums/{id}`, client credentials | none | yes (LIVE-TESTED 200) | Batch `GET /albums` is 403, so one call per album. |
| Playlist creation, N tracks per lineup artist | `POST /me/playlists`, then `POST /playlists/{id}/items` (max 100 URIs per call) | `playlist-modify-private` (private). `playlist-modify-public` only if public. | yes with limits. (Updated 2026-11-23: LIVE-TESTED, create 201 and add 13 items 201 with `playlist-modify-private` alone. Before that only a DEVELOPER REPORT: https://community.spotify.com/t5/Spotify-for-Developers/403-Errors/m-p/7379428/highlight/true.) | Scope request widens the consent screen (current scopes are read-only), and the consent screen also shows a "View your Spotify account data" block. 188 artists x 3 tracks = 564 URIs, so 6 add calls, but the track lookups before them are many requests. `public` defaults to true. **The playlist cannot be private through the API**: `public:false` keeps it off the profile only, and the Spotify app labels it "Public Playlist". Name policy (section 6.1). |
| Look up tracks per artist in the browser | `GET /search?type=track&q=artist:"Name"` (user token) or `GET /artists/{id}/albums` + `GET /albums/{id}/tracks` | none listed | yes with limits. App-only live test: 6 tracks for a small artist from one search call. Top tracks endpoint is removed (403 live). (Updated 2026-11-23: works with a user token too; measured across all lineup artists in the live-tests file, section 4.) | No popularity field, so "top" tracks cannot be chosen by popularity. Search `limit` max 10 and results are not documented as ordered by popularity. Artist-albums path needs 1 + N calls per artist. Name matching can return other artists' tracks (live: 2 of 6 results had a second artist; 18 of 186 lineup artists had one in their first 3). Quota: search has its own bucket, about 300 a day per developer account (live-tests file, section 5). |
| Precompute track ids in the pipeline | same endpoints with client credentials | none | yes (LIVE-TESTED endpoints respond) | Terms IV: "may not store, aggregate or create compilations or databases of Spotify Content, other than as strictly necessary to operate your SDA" and "Do not store Spotify Content indefinitely". Track ids can go stale. Quota is per developer account, shared with the pipeline's other calls. |
| Saved albums as a pool source | `GET /me/albums`, 50 per page; album `artists` array | `user-library-read` (already requested) | yes | No new scope; album objects carry artist ids and names. |
| Visitor's own playlists as a pool source | `GET /me/playlists` then `GET /playlists/{id}/items` (50 per page) | `playlist-read-private`, `playlist-read-collaborative` | yes with limits: item contents only for playlists the user owns or collaborates on. Followed playlists made by others return no items. | One request per playlist plus paging. Playlist `items` is absent on followed playlists. |
| Recently played as a pool source | `GET /me/player/recently-played`, 50 max | `user-read-recently-played` | yes with limits: history depth not documented; no podcasts. | Shallow history, so few artists. |
| Follow a lineup artist from a result row | `PUT /me/library?uris=spotify:artist:...` (max 40) | `user-follow-modify` | untested. The page's URI list omits artist for save/remove but one report says artist URIs worked and followed 43 artists. The old `PUT /me/following` is deprecated. | Conflict between the page and the report. Adds a write scope. |
| Save a track from a result row | `PUT /me/library?uris=spotify:track:...` | `user-library-modify` | yes | Adds a write scope. |
| In-page preview of a lineup artist | `preview_url` (absent live), or an Embed iframe for the artist | none (embed) | embed: yes with CSP change. `preview_url`: no. | CSP needs `frame-src https://open.spotify.com`. Embed may require login for full tracks (UNVERIFIED). Policy VI link wording and attribution apply to Spotify content. |
| In-page playback | Web Playback SDK, or iFrame API `loadEntity` | `streaming` (SDK); none (iFrame API) | SDK: Premium only, Dev Mode untested. iFrame API: artist entity support UNVERIFIED. | Script hosts and CSP. SDK may not be used commercially without approval. iOS autoplay limits. |
| "Play this artist" on the visitor's device | `PUT /me/player/play` with `context_uri` = artist URI; `GET /me/player/devices` | `user-modify-playback-state`, `user-read-playback-state` | yes with limits: Premium needed, an active device needed. | A Streaming SDA under the Terms' definition ("control a background Spotify application"). Streaming is "only permitted for Premium subscribers" and commercial uses are barred. |
| Show artist images | `images` array on artist objects (3 sizes, `i.scdn.co`) | none | yes (LIVE-TESTED present) | Needs `img-src https://i.scdn.co`. Must not be cropped or overlaid; needs attribution and link back. Storing images in the repo is not permitted by the caching clause beyond "temporary" (INFERENCE). |
| Show cover art | album `images` | none | yes (field present on albums) | Same as above. |
| Read the official Treefort playlist | `GET /playlists/{id}/items` | `playlist-read-private` | no for a playlist the visitor does not own or collaborate on. Items are absent for others' playlists; endpoint returns 403 to non-owners. `GET /playlists/{id}` for Spotify's own editorial playlist returned 404 app-only (a Treefort-made playlist was not tried). | None (blocked). |
| Refresh tokens with PKCE | `POST accounts.spotify.com/api/token` with `grant_type=refresh_token`, `client_id` | n/a | yes. Refresh tokens last 6 months. | Needs the refresh token held somewhere. CLAUDE.md currently forbids writing any token to storage. A 400 `invalid_grant` means re-login. |
| Keep a token across page reloads | none in the API. Access token 1 hour. | n/a | n/a | Documented only as token lifetimes. A reload loses the in-memory token. |
| Refresh the import | repeat the three reads | read scopes | yes | Quota. |
| Use `account_id` to identify the account | `GET /me` field `account_id` | none beyond login | yes (May 2026) | Spotifort stores no accounts. Likely irrelevant. |
| Check whether lineup artists are already followed | `GET /me/library/contains?uris=spotify:artist:...` (max 40 per call) | `user-follow-read`, `user-library-read`, `playlist-read-private` (page lists all three) | yes | Page scope list is long; actual requirement per URI type is not stated. UNVERIFIED. |
| Set a playlist cover | `PUT /playlists/{id}/images`, base64 JPEG <= 256 KB | `ugc-image-upload` + modify scope | yes | Extra scope. Branding rules on artwork. |
| Concerts, schedules | none | n/a | no; PLAN-2027.md records "There is no concerts endpoint." | n/a |

---

## 8. Corrections to CLAUDE.md

Statements in CLAUDE.md's Spotify sections that my findings contradict or make stale. CLAUDE.md was not edited.

| # | CLAUDE.md says | Finding | Evidence |
|---|---|---|---|
| 1 | "Each developer gets one Client ID with a maximum of 5 authorized users." | Stale. 25 Client IDs per developer account since July 2026. The 5-user cap per Client ID stands. | July changelog (raw): "Increased from 1 to 25." |
| 2 | Same section: dev mode limits implicitly per Client ID (the table of limits). | Quota is now per developer account, shared across all Dev Mode Client IDs. Visitors' own Client IDs each belong to separate accounts, so a visitor's quota is their own. The owner's pipeline shares one budget with every other Dev Mode app on the owner's account. | July changelog and blog 2026-07-23 |
| 3 | `GET /artists/{id}`: "Individual artist metadata + genres. Works one at a time." | `genres` is absent from the live response (the key is missing, not empty), and deprecated on the reference page. `popularity` and `followers` are also absent. `images` is present. | LIVE-TESTED; REF `get-an-artist` |
| 4 | `GET /artists/{id}/albums`: "Available but not currently used." | Available, but `limit` max is 10 (default 5). `limit=11` returns 400. | LIVE-TESTED; REF `get-an-artists-albums` |
| 5 | `GET /search`: "Search artists/tracks by name. Used by lineup script." (no limit) | `limit` max 10, default 5. 11 returns 400. The script's `SEARCH_LIMIT = 5` is fine. | LIVE-TESTED; MG |
| 6 | `GET /me`: "Available but not currently used." | `country`, `email`, `explicit_content`, `followers`, `product` are deprecated or removed. `account_id` was added in May 2026. | REF `get-current-users-profile`; CL-May |
| 7 | "Removed response fields (across all endpoints): `popularity`, `followers`, `available_markets`, `email`, `country`." | Incomplete. Also removed or deprecated: `linked_from`, `label`, `album_group`, `publisher` (shows, audiobooks), `explicit_content`, `product`, `preview_url` (absent live), artist `genres`. | MG; REF pages; live |
| 8 | "`external_ids` ... were briefly removed in February 2026 but reverted in the March 2026 changelog and remain available." | Confirmed. Live: present on tracks, track search results and albums. | CL-Mar; LIVE-TESTED |
| 9 | Blocked table: `GET /playlists/{id}/tracks (others' playlists)`. | The endpoint was renamed `/items`; the old path is labelled deprecated. Ownership/collaboration restriction applies to `/items`. | MG; REF `get-playlists-items` |
| 10 | Blocked table: `GET /artists/{id}/top-tracks`, `GET /artists` (batch) etc. | Confirmed removed in the migration guide; live 403 for top-tracks, artists batch, albums batch, related-artists, audio-features, `browse/new-releases`. | MG; LIVE-TESTED |
| 11 | Blocked table lists `GET /browse/featured-playlists`, `GET /recommendations`, `GET /audio-features`. | Not in the migration guide's removal list. Reference pages for some show "Deprecated". Live: audio-features 403. Recommendations and featured playlists were not re-tested today; recommendations genre seeds returned 404. | MG; REF; LIVE-TESTED |
| 12 | Working table has no mention of the Library group. | `PUT/DELETE /me/library` and `GET /me/library/contains` exist and replace the save/remove/follow endpoints. `PUT /me/following` is deprecated. | CL-Feb; MG |
| 13 | "Why BYOCID ... Extended Quota Mode requires a registered business entity, 250K MAU, and Spotify approval". | Matches the quota-modes page (organisations only since 15 May 2025, 250k MAU, up to six weeks). Not stale. | quota-modes |
| 14 | "This does require users to have Spotify Premium." | Consistent: the rule is on the app owner, and under BYOCID the visitor owns the app. | quota-modes; INFERENCE |
| 15 | PKCE section describes the flow but nothing about refresh tokens. | Refresh tokens expire after 6 months from authorisation (from 18 Jun 2026 for new apps). Not stale but missing. | blog 2026-06-18 |
| 16 | "Scopes requested: user-library-read user-top-read user-follow-read". | Still valid scope names. | scopes page |
| 17 | "Required Disclaimers: Spotify logo/attribution per their branding requirements". | The design page requires the Spotify logo (full logo in partner integrations) next to any Spotify metadata, and link wording GET SPOTIFY FREE / OPEN SPOTIFY / PLAY ON SPOTIFY / LISTEN ON SPOTIFY. The current text-link wording is not checked here. | design page (raw) |
| 18 | PLAN-2027.md (not CLAUDE.md) says "Spotify marks `genres` ... Verified in docs; not live-tested". | Now live-tested: absent. | LIVE-TESTED |

---

## 9. Open questions

| Question | Cheapest way to confirm |
|---|---|
| ANSWERED 2026-11-23: Does `POST /me/playlists` plus `POST /playlists/{id}/items` work for a Dev Mode user token with `playlist-modify-private`? | Yes (201, 201). Not private, though; see the live-tests file. |
| OPEN, added 2026-11-23: why does `GET /me/playlists` return 403 "Insufficient client scope" even with `playlist-read-private` and `playlist-read-collaborative` granted? | Unexplained. Not needed for the playlist feature. |
| OPEN, added 2026-11-23: size and reset period of the search quota, and the size of the albums bucket. | About 300 searches in a day is one day's count from one account (INFERENCE). |
| Does `PUT /me/library` accept `spotify:artist:` URIs? The page omits artist from save; one forum report says it works. | A logged-in call with a single artist URI, then `GET /me/library/contains`. Needs a user token. |
| Do client-credentials calls draw from the same quota bucket as user calls and as the owner's other apps? | Not answerable from docs. Ask on the forum thread or count requests until a 429. Only the latter is cheap and it risks a cooldown. |
| What are the quota bucket names, sizes and reset period? (partly answered 2026-11-23) | Not published. A 429 was reached by accident: search ran out after about 300 requests, `Retry-After` about 23 hours, other buckets unaffected. Other buckets' sizes unknown. |
| Does the app owner's Premium status affect app-only tokens? | The owner's token works today. Confirm by checking whether calls fail when Premium lapses; not testable safely. Forum report supports it. |
| Does `GET /playlists/{id}` work with an app-only token for a user-created public playlist? | One GET with a known public playlist id. Cheap. Not done: only one Spotify editorial playlist was tried (404). |
| Is `GET /recommendations`, `GET /browse/featured-playlists` still 403 today? | Two app-only GETs. Cheap. I stopped at the 20-request cap. |
| What does a Web Playback SDK token request need in Dev Mode, and does it work? | Needs a user token with `streaming`, Premium, and a test page. |
| Does the Embed show full tracks to a logged-in Spotify user and 30-second previews to others? Do artist embeds work inside the iFrame API `loadEntity`? | Build a test page; check what renders. Needs a CSP change on a preview deployment. |
| Does oEmbed send CORS headers for a browser fetch? | `curl -I https://open.spotify.com/oembed?url=...` and read `access-control-allow-origin`. Cheap, not done here. |
| Does any `open.spotify.com` or `spotify:` link pre-fill a playlist or start artist playback? | No documentation found. Test by hand in the desktop and mobile clients. |
| How does Spotify apply "should not begin with 'Spot'" to "Spotifort"? Does a playlist titled "Spotifort: Treefort 2027" matter? | Ask Spotify through the Developer Support form or the forum; there is no other source. |
| Does the "one Security Code for each SDA" sentence cover BYOCID? | Same: ask Spotify. |
| Are Spotify artist and track ids "Spotify Content" for the storing clause? | Same. |
| Did the postponement of endpoint changes for existing apps ever end? The blog says postponed, the migration guide says 9 Mar 2026. | Irrelevant to a new app; check by testing against an old Client ID if the owner has one. |
| `playlist-read-collaborative` and `user-read-recently-played` in a Dev Mode app: any scope restriction? | One login requesting both scopes. |
| When was the "[DEPRECATED]" label added to the old playlist `/tracks` endpoints? | The Wayback Machine for the reference pages. The May changelog has the labels in its sidebar but no text. |
| Quota-modes page and Developer Terms may have changed since the version read. | Re-run the raw fetches before relying on this file. |

---

## 10. Live probes run

20 read-only GETs to `api.spotify.com` with a client-credentials token (the token request is a separate call to `accounts.spotify.com`; it returned 200 each of the three times). No secrets or tokens printed or written. The lineup artist used was the first entry of `public/data/2027/lineup.json`.

| # | Request | Status |
|---|---|---|
| 1 | `GET /artists/{id}` | 200 |
| 2 | `GET /search?type=artist&limit=10&q=<name>` | 200 |
| 3 | `GET /search?type=artist&limit=11&q=<name>` | 400 Invalid limit |
| 4 | `GET /search?type=track&limit=10&q=artist:"<name>"` | 200 |
| 5 | `GET /artists/{id}/albums?limit=10&include_groups=album,single` | 200 |
| 6 | `GET /artists/{id}/albums?limit=11` | 400 Invalid limit |
| 7 | `GET /albums/{id}` | 200 |
| 8 | `GET /albums/{id}/tracks?limit=50` | 200 |
| 9 | `GET /tracks/{id}` | 200 |
| 10 | `GET /artists/{id}/top-tracks?market=US` | 403 |
| 11 | `GET /artists?ids={id}` | 403 |
| 12 | `GET /albums?ids={id}` | 403 |
| 13 | `GET /playlists/37i9dQZF1DXcBWIGoYBM5M` | 404 |
| 14 | `GET /artists/{id}/related-artists` | 403 |
| 15 | `GET /me` | 401 |
| 16 | `GET /audio-features/{id}` | 403 |
| 17 | `GET /recommendations/available-genre-seeds` | 404 |
| 18 | `GET /browse/new-releases` | 403 |
| 19 | `GET /search?type=playlist&limit=1&q=treefort` | 200 |
| 20 | `GET /artists/{id}` (image hosts only) | 200 |

No 429 occurred. No `Retry-After` header was seen on any response.

Fields observed:

- Artist: `external_urls, href, id, images, name, type, uri`. No `genres`, `popularity`, `followers`.
- Track (search and `/tracks/{id}`): `album, artists, disc_number, duration_ms, explicit, external_ids, external_urls, href, id, is_local, is_playable, name, track_number, type, uri`. No `popularity`, no `preview_url`.
- Album: `album_type, total_tracks, external_urls, href, id, images, name, release_date, release_date_precision, type, uri, artists, tracks, copyrights, external_ids, genres`. No `popularity`, `label`, `available_markets`.
- Simplified album in artist albums: `album_type, total_tracks, external_urls, href, id, images, name, release_date, release_date_precision, type, uri, artists`.
- Album tracks item: `artists, disc_number, duration_ms, explicit, external_urls, href, id, name, track_number, type, uri, is_local`.
- Artist images: 640, 320 and 160 px, host `i.scdn.co`.
- Search without `market` worked for artist and track queries with an app-only token.
