# Evaluation of the contribution decay (PR 2.5)

`docs/evaluation-2.4.md` found that large pools saturate the recommendation score: with 300 random library artists every result was "strong" and six were at 1.00, and a real 1,300-artist library would be worse. PR 2.5 adds a **contribution decay** to `recommend()` in `src/core/recommend.js`:

```
c_i   = weight(U) · m(U, L) for every pool artist U linked to lineup artist L, sorted descending
score = 1 − Π over i of (1 − c_i · DECAY^i)          DECAY = 0.7  (DECAY = 1 is the PR 2.4 formula)
```

So the strongest link counts in full, the second at 70 %, the third at 49 %, and the long tail fades out. A single link is never changed.

Same data as 2.4 (2027, 188 artists, 11,005 outside names, `minMatch` 0.1). Every number below comes from

```
node scripts/eval-decay.js 1 0.8 0.7 0.6 0.5     # all nine scenarios + synthetic libraries
node scripts/eval-big-library.js [seed] [size] [decay]
npm run try -- "Artist" ... --decay 1             # one scenario, before
```

## Scenarios 1–8 (typed pools): before (1.00) and after (0.70)

Results: total (strong / good / worth a listen); then the top three scores and names.

| # | Pool | Decay 1.00 (before) | Decay 0.70 (after) |
|---|---|---|---|
| 1 | Phoebe Bridgers | 19 (1/10/8) · 0.52 0.43 0.37 Emma Ogier, Kate Stephenson, Fenne Lily | identical |
| 2 | Waxahatchee, Big Thief, Wilco | 28 (9/8/11) · 0.85 0.79 0.78 Ratboys, Courtney Barnett, Brennan Wedl | 28 (7/10/11) · 0.79 0.75 0.71 Ratboys, Brennan Wedl, Courtney Barnett |
| 3 | Zach Bryan, Tyler Childers, Sturgill Simpson | 7 (5/1/1) · 0.81 0.80 0.63 Colby Acuff, Orville Peck, Gabriella Rose | 7 (5/1/1) · 0.72 0.67 0.59, same order |
| 4 | Turnstile, IDLES, Fontaines D.C. | 8 (1/4/3) · 0.97 0.47 0.40 Sleaford Mods, Iceage, Drug Church | 8 (1/4/3) · 0.96 0.40 0.39 Sleaford Mods, Drug Church, Iceage |
| 5 | Kendrick Lamar, Khruangbin | 4 (0/2/2) · 0.30 0.26 0.20 | identical |
| 6a | Radiohead | no data | identical |
| 6b | Metallica, Taylor Swift | no data | identical |
| 7 | Bully | 12 (5/7/0) · 0.79 0.56 0.55 Ratboys, Wild Pink, Liquid Mike | identical |
| 8 | Modest Mouse, Courtney Barnett, Orville Peck | 28 (11/8/9) · 0.88 0.86 0.66 Caroline Rose, Ratboys, Fenne Lily | 28 (11/8/9) · 0.88 0.83 0.66, same order |

Small pools barely move: single-artist scenarios (1, 5, 6, 7) cannot change by construction, the same artists are recommended everywhere, and only artists carried by several weaker links drop a little (scenario 2: Courtney Barnett 0.79 → 0.71 falls below Brennan Wedl, whose one strong link stays; Greg Freeman and Fenne Lily move from strong to good). That is the intended direction: one strong reason beats three lukewarm ones.

## Scenario 9: synthetic libraries

Pools sampled from the similarity index with liked-song weights (as in 2.4), five seeds each, averages over the top 30 shown.

**300 artists**

| Decay | strong/good/worth | at 0.95+ | median | #10 | #30 | hubs in top 10 |
|---|---|---|---|---|---|---|
| 1.00 (before) | 30 / 0 / 0 | 7.0 | 0.89 | 0.93 | 0.81 | 2.0 |
| 0.80 | 30 / 0 / 0 | 3.4 | 0.79 | 0.85 | 0.70 | 1.8 |
| **0.70** | 30 / 0 / 0 | 3.2 | 0.76 | 0.82 | 0.65 | 1.8 |
| 0.60 | 30 / 0 / 0 | 3.0 | 0.73 | 0.79 | 0.61 | 1.8 |
| 0.50 | 30 / 0 / 0 | 2.8 | 0.71 | 0.78 | 0.58 | 1.6 |

**1,300 artists** (the owner's real library size)

| Decay | strong/good/worth | at 0.95+ | median | #10 | #30 | hubs in top 10 |
|---|---|---|---|---|---|---|
| 1.00 (before) | 30 / 0 / 0 | 30.0 | 1.00 | 1.00 | 1.00 | 1.8 |
| 0.80 | 30 / 0 / 0 | 19.8 | 0.96 | 0.98 | 0.93 | 2.2 |
| **0.70** | 30 / 0 / 0 | 12.0 | 0.93 | 0.96 | 0.89 | 2.0 |
| 0.60 | 30 / 0 / 0 | 8.6 | 0.92 | 0.95 | 0.84 | 2.0 |
| 0.50 | 30 / 0 / 0 | 7.6 | 0.90 | 0.94 | 0.81 | 2.0 |

Seed 20270331 at 300 artists, before and after (`node scripts/eval-big-library.js 20270331 300 1` and without the last argument): the top five are the same (Fiig, LP Giobbi, The Man The Myth The Meatslab, Victoryland, Wild Pink, each carried by one 1.00 link); below them the top 30 spreads from 0.81–1.00 to 0.65–1.00, and Chico Detour (one 0.80 link) enters the top 10 in place of TWEN (three links of 0.30–0.45). Hubs in the top 30: 5 before, 4 after.

## What this shows

1. **The decay fixes the ordering problem, not the banding problem.** At 1,300 artists the old formula gave all 30 results 1.00, so the order was decided by floating-point ties and names. With 0.7 the scores spread from 0.89 to 1.00 again and the order follows the strength of the best links. It does **not** bring any result below 0.5 for a big library, at any decay tried: the strongest single link of most top-30 artists is already above 0.5, and a decay never lowers the first link. Bands based on absolute thresholds cannot work for big libraries, whatever the decay.
2. **Hub bias is unchanged** (about 2 of the top 10 at every value), as expected: the decay targets saturation, not data richness. The per-artist damping suggested in 2.4 is still the candidate if hubs prove a problem on a real library.
3. **Choosing the value.** Below 0.7 the gains on big pools are small (1,300 artists: 12.0 → 8.6 → 7.6 results at 0.95+) while small, multi-artist pools keep losing score (scenario 3: Colby Acuff 0.81 → 0.72 at 0.7, 0.65 at 0.5; scenario 2 loses another strong result at 0.6). Above 0.7 the 1,300-artist case stays near saturation (19.8 at 0.95+ for 0.8). No value is clearly better than 0.7, so **the default stays 0.7**.

## Consequence for the UI

Because absolute bands saturate for any big library, the results page switches to **rank bands** when the pool has 100 or more artists and more than 10 results are strong: the first 10 are "Strong match", the next 10 "Good match", the rest "Worth a listen", with a note above the list ("With a library this big, matches are grouped by rank."). Typed pools of a few artists keep the absolute bands, which read well in scenarios 1–8. Constants: `LARGE_POOL`, `RELATIVE_STRONG`, `RELATIVE_GOOD` in `src/app/state.js`.

## To check with a real library

In a development build (`npm run dev`), every recompute logs to the console: pool size, how many pool artists contributed to any recommendation, and the score distribution of every lineup artist above the 0.1 cutoff (min, median, max, count per absolute band) plus whether rank bands are in use. With a real 1,300-artist library, the things to read are the share of candidates at 0.95+ and whether the top 10 look right; if the top is still crowded, a lower decay (0.6) or the hub damping are the next levers.
