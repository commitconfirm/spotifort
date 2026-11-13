# Evaluation of the app core (PR 2.4)

Output of `npm run try` (and `node scripts/eval-big-library.js` for scenario 9) against the committed 2027 data (188 artists; 11,005 outside names; `minMatch` 0.1), judged before any UI exists. Scores are shown for reading here; the UI will show bands only. Regenerate any scenario with the command shown above it.

## 1. Phoebe Bridgers

Assessment: Sensible but modest. Emma Ogier, Kate Stephenson, Fenne Lily, Slow Pulp are all believable indie-folk neighbours; nothing above 0.52 because one famous name has only weak Last.fm links to small acts. 19 results from a single artist is about right.

```
$ npm run try -- "Phoebe Bridgers" --top 10
Pool: 1 artist

Playing Treefort
  (none)

Recommendations (showing 10 of 19)
  strong
    0.52  Emma Ogier  <- Phoebe Bridgers 0.52
  good
    0.43  Kate Stephenson  <- Phoebe Bridgers 0.43
    0.37  Fenne Lily  <- Phoebe Bridgers 0.37
    0.36  Slow Pulp  <- Phoebe Bridgers 0.36
    0.32  Alex Amen  <- Phoebe Bridgers 0.32
    0.29  Sarah Julia  <- Phoebe Bridgers 0.29
    0.28  Brennan Wedl  <- Phoebe Bridgers 0.28
    0.28  Oscar Lindsey  <- Phoebe Bridgers 0.28
    0.28  Sean Solomon  <- Phoebe Bridgers 0.28
    0.26  hey, nothing  <- Phoebe Bridgers 0.26

No data
  (none)
```

## 2. Waxahatchee, Big Thief, Wilco

Assessment: Good. Several artists linked from all three float up (Ratboys, Courtney Barnett, Brennan Wedl), and Caroline Rose (0.57) is there on one strong link alone, so a single strong link is not drowned by the many-weak-links effect here. Reasons read naturally.

```
$ npm run try -- "Waxahatchee" "Big Thief" "Wilco" --top 10
Pool: 3 artists

Playing Treefort
  (none)

Recommendations (showing 10 of 28)
  strong
    0.85  Ratboys  <- Waxahatchee 0.70, Wilco 0.30, Big Thief 0.27
    0.79  Courtney Barnett  <- Waxahatchee 0.56, Big Thief 0.35, Wilco 0.25
    0.78  Brennan Wedl  <- Waxahatchee 0.68, Big Thief 0.22, Wilco 0.12
    0.66  Sean Solomon  <- Waxahatchee 0.46, Big Thief 0.22, Wilco 0.20
    0.64  Hudson Freeman  <- Big Thief 0.44, Waxahatchee 0.26, Wilco 0.13
    0.61  Greg Freeman  <- Wilco 0.30, Waxahatchee 0.28, Big Thief 0.22
    0.60  sadurn  <- Waxahatchee 0.40, Big Thief 0.34
    0.57  Caroline Rose  <- Waxahatchee 0.57
    0.56  Fenne Lily  <- Waxahatchee 0.35, Big Thief 0.32
  good
    0.48  Lily Seabird  <- Waxahatchee 0.26, Wilco 0.18, Big Thief 0.14

No data
  (none)
```

## 3. Zach Bryan, Tyler Childers, Sturgill Simpson

Assessment: Good and tight: seven results, all country or americana (Colby Acuff, Orville Peck, Waylon Wyatt, Bella White). The short list is honest, the lineup has little of this.

```
$ npm run try -- "Zach Bryan" "Tyler Childers" "Sturgill Simpson" --top 10
Pool: 3 artists

Playing Treefort
  (none)

Recommendations (showing 7 of 7)
  strong
    0.81  Colby Acuff  <- Zach Bryan 0.52, Tyler Childers 0.45, Sturgill Simpson 0.28
    0.80  Orville Peck  <- Sturgill Simpson 0.44, Tyler Childers 0.40, Zach Bryan 0.39
    0.63  Gabriella Rose  <- Zach Bryan 0.49, Tyler Childers 0.28
    0.60  Bella White  <- Tyler Childers 0.35, Sturgill Simpson 0.27, Zach Bryan 0.16
    0.57  Waylon Wyatt  <- Zach Bryan 0.49, Tyler Childers 0.16
  good
    0.29  Jesse Welles  <- Tyler Childers 0.29
  worth-a-listen
    0.17  Emma Ogier  <- Tyler Childers 0.17

No data
  (none)
```

## 4. Turnstile, IDLES, Fontaines D.C.

Assessment: Good. Sleaford Mods at 0.97 (IDLES 0.95) and Iceage are right; hardcore links (Drug Church, One Step Closer) trail. Only 8 results, again an honest reflection of the lineup.

```
$ npm run try -- "Turnstile" "IDLES" "Fontaines D.C." --top 10
Pool: 3 artists

Playing Treefort
  (none)

Recommendations (showing 8 of 8)
  strong
    0.97  Sleaford Mods  <- IDLES 0.95, Fontaines D.C. 0.33
  good
    0.47  Iceage  <- Fontaines D.C. 0.24, IDLES 0.21, Turnstile 0.11
    0.40  Drug Church  <- Turnstile 0.40
    0.28  Lime Garden  <- Fontaines D.C. 0.28
    0.25  World News  <- Fontaines D.C. 0.25
  worth-a-listen
    0.21  One Step Closer  <- Turnstile 0.21
    0.18  Niis  <- Turnstile 0.18
    0.15  Enter Shikari  <- Turnstile 0.15

No data
  (none)
```

## 5. Kendrick Lamar, Khruangbin

Assessment: Weak, and correctly so: four results, best 0.30. The lineup has very little hip-hop or psychedelic funk close to these two, and the output does not pretend otherwise. The UI should lean on the tag picker for pools like this.

```
$ npm run try -- "Kendrick Lamar" "Khruangbin" --top 10
Pool: 2 artists

Playing Treefort
  (none)

Recommendations (showing 4 of 4)
  good
    0.30  La Reezy  <- Kendrick Lamar 0.30
    0.26  Surprise Chef  <- Khruangbin 0.26
  worth-a-listen
    0.20  Monophonics  <- Khruangbin 0.20
    0.19  Kenny Mason  <- Kendrick Lamar 0.19

No data
  (none)
```

## 6a. Radiohead

Assessment: As expected: not in the index (their lineup matches fell under minMatch), reported as no data. Correct and honest.

```
$ npm run try -- "Radiohead" --top 10
Pool: 1 artist
Not in the index (no similarity data): Radiohead

Playing Treefort
  (none)

Recommendations (showing 0 of 0)

No data
  Nothing at Treefort this year is close to Radiohead
```

## 6b. Metallica, Taylor Swift

Assessment: As expected: both reported as no data, no recommendations.

```
$ npm run try -- "Metallica" "Taylor Swift" --top 10
Pool: 2 artists
Not in the index (no similarity data): Metallica, Taylor Swift

Playing Treefort
  (none)

Recommendations (showing 0 of 0)

No data
  Nothing at Treefort this year is close to Metallica
  Nothing at Treefort this year is close to Taylor Swift
```

## 7. Bully (a lineup artist) alone

Assessment: Good. Bully is playing, so the list is Bully's lineup neighbours (Ratboys 0.79, Wild Pink, Liquid Mike, Wishy, Courtney Barnett). Plausible, and the reasons carry the signal (direct or neighbours).

```
$ npm run try -- "Bully" --top 10
Pool: 1 artist

Playing Treefort
  Bully

Recommendations (showing 10 of 12)
  strong
    0.79  Ratboys  <- Bully 0.79 (direct)
    0.56  Wild Pink  <- Bully 0.56 (direct)
    0.55  Liquid Mike  <- Bully 0.55 (direct)
    0.51  Courtney Barnett  <- Bully 0.51 (direct)
    0.51  Wishy  <- Bully 0.51 (direct)
  good
    0.45  TWEN  <- Bully 0.45 (direct)
    0.36  Violet Grohl  <- Bully 0.36 (direct)
    0.33  Victoryland  <- Bully 0.33 (neighbours)
    0.31  Truth Club  <- Bully 0.31 (direct)
    0.30  Greg Freeman  <- Bully 0.30 (neighbours)

No data
  (none)
```

## 8. Modest Mouse, Courtney Barnett, Orville Peck (three lineup artists)

Assessment: Good. All three are matched and excluded from the results; Caroline Rose, Ratboys, Fenne Lily lead through Courtney Barnett, Bella White through Orville Peck. The mix of signals looks right. One quirk: Modest Mouse's own neighbours are mostly tag-dominated and rarely win a place against direct links, which is the intended outcome of the PR 2.3 tuning.

```
$ npm run try -- "Modest Mouse" "Courtney Barnett" "Orville Peck" --top 10
Pool: 3 artists

Playing Treefort
  Courtney Barnett
  Modest Mouse
  Orville Peck

Recommendations (showing 10 of 28)
  strong
    0.88  Caroline Rose  <- Courtney Barnett 0.88 (direct)
    0.86  Ratboys  <- Courtney Barnett 0.76 (direct), Modest Mouse 0.40 (tags)
    0.66  Fenne Lily  <- Courtney Barnett 0.66 (direct)
    0.66  Sean Solomon  <- Courtney Barnett 0.66 (direct)
    0.65  Alex Amen  <- Courtney Barnett 0.65 (direct)
    0.62  Bully  <- Courtney Barnett 0.51 (direct), Modest Mouse 0.22 (neighbours)
    0.61  Bella White  <- Orville Peck 0.61 (neighbours)
    0.58  Truman Sinclair  <- Courtney Barnett 0.43 (direct), Modest Mouse 0.27 (tags)
    0.55  Brennan Wedl  <- Courtney Barnett 0.55 (neighbours)
    0.55  Nicole Atkins  <- Courtney Barnett 0.55 (direct)

No data
  (none)
```

## 9. Synthetic big library (300 outside artists, seeded)

Assessment: see the discussion below.

```
$ node scripts/eval-big-library.js
Pool: 300 outside artists (seed 20270331); 30 recommendations
Ten highest-degree lineup artists: Barbara (250), Deeveaux (250), Surfing For Daisy (250), LP Giobbi (249), Natanya (249), Snorkeler (249), MYLO BYBEE (248), Fenne Lily (247), Black Lips (246), Heart Attack Man (246)

Top 10
  1.00  Fiig  (edges: 19)  <- materializer 1.00
  1.00  LP Giobbi  [hub]  (edges: 249)  <- BLOND:ISH 1.00, Dombresky 0.28, Peggy Gou 0.24
  1.00  The Man The Myth The Meatslab  (edges: 165)  <- Ethan Regan 1.00, Gregory Alan Isakov 0.26, Good Neighbours 0.11
  1.00  Victoryland  (edges: 108)  <- Star Moles 1.00, mary in the junkyard 0.31, Francis of Delirium 0.16
  1.00  Wild Pink  (edges: 180)  <- Star Moles 1.00, Superviolet 0.33, mary in the junkyard 0.31
  1.00  Deeveaux  [hub]  (edges: 250)  <- Two Birds 0.89, (2)Dope Podcast 0.82, Eduardo Martinez 0.78
  0.99  Barbara  [hub]  (edges: 250)  <- Jean Ferrat 0.74, Yves Montand 0.53, Dominique A 0.47
  0.99  One Step Closer  (edges: 221)  <- Anxious 0.92, Fiddlehead 0.59, Basement 0.39
  0.98  TWEN  (edges: 237)  <- Sword II 0.45, Francis of Delirium 0.38, The Automatic 0.30
  0.97  Drug Church  (edges: 240)  <- Fiddlehead 0.80, Anxious 0.58, Basement 0.32

Hubs in top 10: 3 of 10; in all 30 results: 5
Top 30 scores: 1.00 1.00 1.00 1.00 1.00 1.00 0.99 0.99 0.98 0.97 0.93 0.93 0.93 0.92 0.92 0.90 0.90 0.87 0.86 0.86 0.85 0.85 0.84 0.83 0.83 0.82 0.82 0.81 0.81 0.81
```

Overlap with the ten highest-degree lineup artists ("hubs": most outside artists pointing at them; 246 to 250 each of 11,005 names, against a median of 103): **3 of the top 10, and 5 of all 30 results**. Ten hubs are 5% of the 188-artist lineup, so they are over-represented about four times, but they do not dominate: seven of the top ten and 25 of 30 are not hubs, and the strongest single results (Fiig, 19 edges, via one 1.00 link; The Man The Myth The Meatslab, Victoryland, Wild Pink) come from one very strong link.

Two things this scenario shows:

1. **Saturation.** With 300 artists the noisy-or product pushes the top of the list to 1.00 (six results at 1.00, thirty results all at or above 0.81, so every result is "strong"). A random 300-artist pool is far more scattered than a real library, so this is a pessimistic case, but a real 1,500-artist library will saturate too. The ranking still orders sensibly; the bands stop carrying information.
2. **Mild hub bias.** Hubs gain from having many weak links. Over five seeds (a throwaway experiment, not committed) the share of hubs in the top 10 averaged 2.0 of 10 with the specified formula.

Adjustments tried on the same five seeds, none adopted:

| Variant | Hubs in top 10 (avg) | Hubs in top 30 | Top 30 scoring 0.95 or more |
|---|---|---|---|
| As specified | 2.0 | 5.0 | 7.0 |
| Only each artist's three strongest links count | 1.8 | 4.2 | 3.6 |
| m squared (weak links count much less) | 1.8 | 3.8 | 3.0 |
| m divided by sqrt(edge count / median) | 1.2 | 3.4 | 2.6 |
| m divided by 1 + ln(edge count / median) | 1.2 | 3.0 | 2.4 |

**Recommendation (not implemented).** The formula is behaving as specified and the results in scenarios 1 to 8 read well, so it is left unchanged. If the bias matters in practice, the cleanest fix is a per-artist data-richness damping, `m / (1 + ln(edges / median edges))`, applied to reverse-index scores only: it cuts hubs in the top 10 from 2.0 to 1.2 and the saturated results from 7 to 2.4, and it is principled (an artist with 250 outside neighbours is well covered by Last.fm, not necessarily more similar to everyone). It needs a real library to judge, because a uniformly random pool cannot tell us whether the hubs that survive are good recommendations. For the saturation problem the UI should rank by score but treat bands as relative for large pools (for example, show the top 10 as "strong" and the next as "good") rather than rely on the absolute thresholds.

## Summary

| # | Scenario | Result |
|---|---|---|
| 1 | Phoebe Bridgers | Sensible, modest (best 0.52) |
| 2 | Waxahatchee, Big Thief, Wilco | Good; overlaps rise, one strong link still places |
| 3 | Zach Bryan, Tyler Childers, Sturgill Simpson | Good, short and on target |
| 4 | Turnstile, IDLES, Fontaines D.C. | Good (Sleaford Mods, Iceage) |
| 5 | Kendrick Lamar, Khruangbin | Weak and honest; tag picker needed |
| 6 | Radiohead; Metallica, Taylor Swift | No data, reported as such |
| 7 | Bully alone | Good; Bully's lineup neighbours |
| 8 | Modest Mouse, Courtney Barnett, Orville Peck | Good; matched artists excluded |
| 9 | 300-artist library | Hubs over-represented but not dominant (3 of top 10, 5 of 30); scores saturate near 1.00 |
