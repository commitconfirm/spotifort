# Spotifort

Spotifort tells a visitor which artists to see at a given year's Treefort Music Fest. The visitor names artists they like, and Spotifort shows which of them are playing and which other acts on the festival lineup sound similar.

## Language

### The festival

**Lineup**:
The set of music acts playing the festival in a given year.
_Avoid_: Roster, bill, performers (the festival vendor's word)

**Lineup artist**:
One act on the lineup. Every lineup artist has a lineup number and may have listen links, tags and similar lineup artists.
_Avoid_: Performer, act, band

**Lineup number**:
The stable number that identifies one lineup artist for the year, kept even if the festival renames the act.
_Avoid_: Artist id, index

**Outside artist**:
An artist who is not on the lineup but about whom we know which lineup artists sound like them.
_Avoid_: Non-lineup artist, other artist

**Unverified**:
A property of a lineup artist: we are not sure our link to that act (for example its streaming page) points to the right artist.
_Avoid_: Unconfirmed, unmatched

### What the visitor brings

**Pool**:
The visitor's own collection of artists, shown to them as "My artists". Everything the visitor adds, by hand or from a library, goes into it, and all results are worked out from the whole pool.
_Avoid_: Library (when meaning the whole collection), favourites, picks, list

**Pool source**:
Where a pool artist came from: typed or picked by hand, or a library import. An artist can have more than one source.
_Avoid_: Input, origin

**Typed pick**:
An outside artist the visitor adds by hand from the search box.
_Avoid_: Manual artist

**Picked artist**:
A lineup artist the visitor adds by hand from the search box suggestions. It is tied to its lineup number, so it is never matched by name.
_Avoid_: Selected artist

**Library import**:
Reading a visitor's listening library from a streaming service and adding its artists to the pool as one source. Today this is Spotify only.
_Avoid_: Sync, connect

**Client ID**:
The visitor's own Spotify developer app identifier, which they bring and paste in so that Spotify access works for them alone.
_Avoid_: API key, Spotify app

**Listen service**:
The streaming service the visitor says they listen on, which decides which listen link is shown first.
_Avoid_: Platform, provider

### Results

**Match**:
A lineup artist the visitor already likes, because an artist in their pool is that act. Matches are the "Playing Treefort" list.
_Avoid_: Hit, found artist

**Unconfirmed**:
A property of a match: we matched it by name only, or the lineup artist it points to is unverified, so the visitor should check it.
_Avoid_: Unverified, uncertain

**Recommendation**:
A lineup artist the visitor has not matched but who sounds like artists in their pool. Recommendations are the "Recommended for you" list.
_Avoid_: Suggestion (that is autocomplete), pick

**Band**:
The tier a recommendation sits in: Strong match, Good match or Worth a listen. It tells the visitor how strong the link is without showing a number.
_Avoid_: Score, rating, level

**Reason**:
The "because you like ..." line under a recommendation, naming the pool artists that led to it.
_Avoid_: Explanation, source

**Treefort picks**:
The lineup artists across both results lists, matches and recommendations together, and not the pool.
_Avoid_: Results, picks (alone)

**Shared picks view**:
The read-only page someone sees when they open a share link, listing the Treefort picks it carries.
_Avoid_: Shared list, shared pool

### Exploring

**Similar artists**:
The other lineup artists shown when a row's `[+]` is opened, each labelled "similar listeners" or "similar tags" by the strongest signal linking them.
_Avoid_: Related artists, neighbours

**Similar listeners**:
A signal that two lineup artists are alike because people who listen to one tend to listen to the other.
_Avoid_: Direct link

**Similar tags**:
A signal that two lineup artists are alike because they carry the same genre tags.
_Avoid_: Genre match

**Genre**:
A tag people have given a lineup artist, used by the genre picker to list lineup artists when no artist name helps.
_Avoid_: Style, category

### Listening

**Listen link**:
A link on a lineup artist's row that opens that artist on the visitor's listen service, because we hold a checked page for it.
_Avoid_: Streaming link, play link

**Search link**:
A link that opens a search for the artist's name on a listen service, shown when we hold no checked page for that artist there.
_Avoid_: Fallback link

### Playlist

**Playlist**:
The Spotify playlist Spotifort makes for a visitor from the Treefort picks, holding a few tracks for each lineup artist that has a Spotify page.
_Avoid_: Mix, set list, private playlist

**Off-profile**:
A property of a playlist: it is not shown on the visitor's Spotify profile, but anyone who has its link can open it. It is not the same as private.
_Avoid_: Private, hidden, unlisted

**Left out**:
A property of a Treefort pick: it gets no tracks in the playlist because it is unverified or has no Spotify page. The visitor is told which picks were left out.
_Avoid_: Skipped, missing, failed

**Own track**:
A track that carries the lineup artist's own Spotify identity, as opposed to a track by another artist with a similar name.
_Avoid_: Matching track, top track

**Newest releases**:
The artist's most recent releases on Spotify, used as the source of tracks when too few own tracks are found another way.
_Avoid_: Latest albums, new music

## Relationships

- The **Lineup** has many **Lineup artists**; each has one **Lineup number**.
- The **Pool** has many artists, each from one or more **Pool sources**; an artist is a lineup artist or an **Outside artist**.
- A **Library import** is one **Pool source**; a **Typed pick** and a **Picked artist** are the hand-added sources.
- Every pool artist that is a lineup artist becomes a **Match**; a **Match** is **Unconfirmed** when it is by name only or the lineup artist is **Unverified**.
- Every other lineup artist that sounds like pool artists becomes a **Recommendation** with one **Band** and a **Reason**.
- **Treefort picks** are the **Matches** plus the **Recommendations**; a share link carries them and opens as a **Shared picks view**.
- Each lineup artist row shows a **Listen link** or **Search link** for the **Listen service**, and a `[+]` that reveals **Similar artists**.
- A **Playlist** is made from the **Treefort picks** and is **Off-profile**.
- Each **Treefort pick** either contributes **Own tracks** to the **Playlist** or is **Left out**; an **Unverified** lineup artist is always **Left out**.
- When a lineup artist has too few **Own tracks**, its **Newest releases** supply the rest.

## Flagged ambiguities

- "Picks" names three different things: the artists a visitor adds by hand (the Picked artist), the Treefort picks (matches plus recommendations), and, in the plan, the saved pool ("artist picks"). Each needs its own term until one is chosen.
- "Match" means a lineup artist the visitor already likes, a strong or good link in the "Strong match" and "Good match" bands, and a Last.fm similarity score. The "No Treefort matches yet" message covers both result lists.
- "Playing Treefort" is both the matches list heading and the badge on any lineup artist in autocomplete, whether or not the visitor has that artist.
- "Unconfirmed" and "Unverified" are easy to confuse. Unverified belongs to a lineup artist; Unconfirmed belongs to a match and can be caused by Unverified, but the visitor sees only "unconfirmed" on results and only "unverified" on the full lineup page. "Confirmed" is also used for a lineup record whose identity another source has checked.
- "Pool", "My artists", "my artists pool" and "artist picks" are used for one thing; and "library" means both the whole pool and the imported Spotify source.
- "Library" for a Spotify import covers Liked Songs, top artists and followed artists, though only the first is a library in Spotify's own sense.
- "Similar" means any artist Last.fm links to a lineup artist, or only a lineup artist in the `[+]` list. "Similar listeners" covers two internal signals.
- "Genre" and "tag" are the same thing: the app says genre, the data says tag, and Spotify's own genres are a different, unused thing.
- "Band" is the recommendation tier here but ordinary speech for a music act; "act" and "band" must not stand in for lineup artist.
- "Listen service" in the UI is "platform" in the data, and the platforms the data holds links for are more than the services the visitor can choose.
- "Lineup artist" is "performer" in the festival vendor's data, and the vendor's performers include acts we exclude.
- Spotify's "public" and "private" mean two different things: in its API, whether a playlist is listed on the owner's profile; in its app, who can open it. A playlist made through the API as not-public is therefore **Off-profile**, not private. Spotify's own app labels it public.
