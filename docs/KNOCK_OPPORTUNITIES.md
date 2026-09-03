# Where should I knock? — the opportunity formula

`lib/services/knockOpportunities.ts` (pure) · `lib/services/knockCalibration.ts` (pure) · `lib/services/knockFinder.ts` (I/O) · `lib/services/censusHousing.ts` · `lib/services/opportunityBrief.ts` · `lib/services/knockRunEstimate.ts` (pure) · `app/knock-finder.tsx`

One button. The roofer should not have to think about where to go. This
document is the authority on the formula, its constants, and why each one
is what it is. Change the code and this file together.

---

## 1. What it answers

> Within the radius I chose (3–50 miles, default 25) of my base, which
> neighbourhoods are most likely to have hail- or wind-damaged roofs right
> now, why, how many claim-grade roofs should I expect to find if I knock
> there, and in what order should I drive?

Two modes (`FinderMode`):

- **Storm-hit streets** (default) — every 3-mile cell an NWS report landed in.
- **Neighbours of my jobs** — every cell one of the roofer's own jobs sits
  in, scored with the same storm evidence when there is any (§2.7).

Output per area (a ~3-mile cell):

| Field | Meaning |
|---|---|
| **Knock Score** 0–100 | Composite of storm exposure, roof susceptibility, drive distance, and ground already covered. Rank order. |
| **Storm Score** 0–100 | Saturating sum of every NWS report's severity × recency in and next to the cell. |
| **Susceptibility** 0–100 | From the Census tract: roof age (median year built), owner-occupancy, single-family share. |
| **Per-roof p** | Probability that a given roof in the cell carries *claim-grade* damage — the 8+ functional-hits-per-square bar (`docs/THRESHOLD_PROVENANCE.md`). |
| **Expect / At least** | `p × 40 doors`, and the largest M with P(finds ≥ M) ≥ 80 % (binomial). |
| **P(≥ 5)** | Chance of finding at least the target of 5 claim-grade roofs in a 40-door stop. |
| **Doors for 5** | Smallest door count that gives ≥ 80 % chance of 5. |
| **Reasons** | The facts the score used, in words. The AI brief phrases these; it never adds numbers. |

And a **trip plan**: greedy nearest-next ordering from base, 40 doors (~96 min)
per stop, 35 mph average, days capped at 8 hours including the drive home,
up to three days.

---

## 2. Inputs and weights

### 2.1 Storm reports

NWS Local Storm Reports via the IEM per-point service (`lib/noaa.ts`), radius
as chosen (`DEFAULT_SEARCH_RADIUS_MILES` 25, `MIN` 3 = one cell, `MAX` 50 —
owner: "toggle the mileage from 0–50 miles"; the roofer's last choice is
remembered in `knockFinderStore.radiusMiles`), look-back 24 months, hail +
wind. Each report is a point; hail falls
in swaths, so a report contributes weight 1.0 to its own cell and 0.4 to each
of the 8 neighbours (`ADJACENT_SPREAD`). **Only cells a report actually landed
in are ranked** — a halo of report-less cells around every storm would put
nine cards named after the same town on the list, and the 3-mi canvass
radius already reaches into them from the hit cell.

**Hail severity weight** (`hailWeight`):

| Reported size | Weight | Why |
|---|---|---|
| ≥ 2.00" | 1.00 | Damages every asphalt roof, new or old. |
| 1.50–1.99" | 0.90 | Golf-ball; functional damage on most asphalt. |
| 1.00–1.49" | 0.75 | NWS severe criterion (raised from 0.75" in 2010). IBHS impact testing: 1" marks aged 3-tab reliably, laminates less consistently. |
| 0.75–0.99" | 0.45 | Pre-2010 severe criterion; damages aged/brittle shingles and soft metals — good door-opener, weaker claim. |
| < 0.75" | 0.15 | Mostly cosmetic. |
| not reported | 0.30 | "Hail" with no size — a report, not a measurement. |

**Wind severity weight** (`windWeight`):

| Gust | Weight | Why |
|---|---|---|
| ≥ 86 mph | 0.65 | Strips shingles; whole-neighbourhood losses. |
| 70–85 mph | 0.45 | Lifts tabs, creases, breaks seals (the 70 mph "damaging" floor `stormWatch.ts` uses). |
| 58–69 mph | 0.25 | NWS severe criterion; damage on aged or poorly-sealed roofs. |
| < 58 mph | 0.08 | Rarely claimable. |
| not reported | 0.25 | A "wind damage" LSR with no gust measured. |

Wind is weighted below hail throughout because carriers contest wind claims
harder (pre-existing seal failure, maintenance) and because IBHS/Verisk
loss-cost data put hail well above wind per event in the states this app
targets.

### 2.2 Recency (`recencyWeight`)

| Months since | Weight | Why |
|---|---|---|
| 0–12 | 1.00 | Inside every filing window. |
| 12–18 | 0.75 | Many policies require notice within one year; some carriers still accept. |
| 18–24 | 0.45 | Texas's two-year suit limitation is the outer edge; most one-year windows have closed. |
| > 24 | 0 | Outside the owner's "past 2 years" and outside the HAAG corroboration window. |

### 2.3 One storm, many reports

Several reports on one calendar day in one cell are one storm. The best
report carries the day; extra reports add confidence at +15 % each, capped
at +90 %:

```
day_contribution = best_weight × (1 + 0.15 × min(reports − 1, 6)) × recency(months)
exposure         = Σ day_contribution
Storm Score      = 100 × (1 − e^(−exposure / 1.5))
```

Saturating on purpose: one 1" day inside the year → 39; two → 63; a 2"
day with five reports plus a 1" day → ~80. A single monster storm cannot
push a cell to 100 and hide everything else.

### 2.4 Housing — roof susceptibility

Census tract of the cell centre (geocoder, no key) → ACS 5-year 2023
(needs a free key, `EXPO_PUBLIC_CENSUS_API_KEY`; verified 2026-09-03 that
the API now 302s every unkeyed request):

- **B25035_001E** median year structure built → roof-age factor
- **B25003_002E / B25003_001E** owner-occupied share
- **B25024_002E / B25024_001E** single-family-detached share
- **B25001_001E** housing units ÷ tract land area → density (shown, not scored)

**Roof-age factor** (`roofAgeFactor`, from median year built):

| Building age | Factor | Why |
|---|---|---|
| ≤ 8 yrs | 0.40 | New roofs: dents show, carriers push back, homeowners under builder warranty. |
| 9–18 | 0.80 | First roof, mid-life; granule loss beginning. |
| 19–36 | 1.00 | The window: first or second roof at 10–25 yrs, brittle, granule-poor, the age band Verisk reports ~60 % higher loss cost for poor-condition roofs. |
| 37–56 | 0.90 | Often re-roofed once; mixed. |
| > 56 | 0.75 | Older stock, more non-asphalt materials, lower insurance take-up. |
| unknown | 0.85 | Neutral. |

`ownerOccupiedFactor = 0.4 + 0.6 × share` (owners file claims; renters do not).
`singleFamilyFactor = 0.3 + 0.7 × share` (the knockable stock).
`Susceptibility = 100 × age × owner × singleFamily`.

**Without a Census key** every area uses the national ACS prior — median
year built 1980, 65 % owner-occupied, 62 % single-family-detached
(`NATIONAL_HOUSING_PRIOR`) — and the card says *"Housing stock unknown
(Census key not set) — national averages assumed."* It never invents a
build year (Drift #5).

### 2.5 Access and footprint

- `accessFactor(distance, radius)`: 1.0 within the nearest quarter of the
  chosen radius, falling linearly to 0.6 at its edge. It scales with the
  dial so "nearer is better" holds whether the roofer picked 10 mi or 50;
  at the old fixed 100 mi it is the same curve as before (free within 25,
  0.6 at 100).
- `canvassedFactor`: 1 − 0.0075 × (your knocks in this cell in the last 60
  days), floor 0.7. Ground you covered last month is worth less this month.
- `ownJobsFactor`: 1.05 when you already have a job in the cell — a yard
  sign and a referral base (storm mode).
- `referralFactor`: neighbours mode replaces `ownJobsFactor` with ×1.6 when
  a **signed** job is in the cell, ×1.25 for any job (§2.7).

### 2.6 Knock Score

```
Knock = 100 × (p / 0.75)^0.45 × storm^0.25 × housing^0.3 × access × canvassed × ownJobs
```

(`p` = the per-roof probability from §4.1; storm and housing as 0–1.)
The first live run on a Plano base showed why the per-roof probability
leads: within 100 mi of DFW every cell had been hit on 5–16 storm days in
two years, the saturating Storm Score read 85–95 everywhere, and the top
ten landed within four points of each other. What separates a great
street from a fair one there is the **worst hail and how long ago** (p),
then how broad the exposure was (storm), then the housing. A weighted
geometric mean: a perfect neighbourhood with no storm is not a lead, and a
monster storm over apartment blocks is a weaker one.

**Cost of the ranking.** The cheap part of the score (a handful of
multiplications) runs for every candidate cell; the binomial statements
and the rationale run only for the top ten (`rankAreasDetailed`). The
binomial tail is one running log-binomial term walked from the short side
of k, and "doors for 5" is an exponential-then-binary search memoised by p
to three decimals. The first build did the O(n²) tail for every cell to
n = 600, twice — ~5.8 s of blocked JS per pass on a desktop CPU for 1,200
cells, and the minute-long freeze the owner hit on the phone. Now: 707
direct cells within 50 mi rank in ~35 ms, and the finder yields to the
event loop between phases so Back keeps working.

### 2.7 Neighbours of my jobs (`mode: 'neighbours'`)

The population is the set of cells the roofer's geocoded jobs sit in
(`OwnActivity.jobs`, each with `signed` — a signed proposal, the homeowner's
signature on the inspection, or the linked lead at or past Approved / Signed
— `isSignedJob` in `knockFinder.ts`). Each cell is scored with the same
storm evidence as storm mode when a report landed in or next to it (a
signed job in a hail cell is the best street in the county), and with
`EMPTY_EVIDENCE` otherwise:

- storm factor floors at `NEIGHBOUR_STORM_FLOOR` = 0.1 so the geometric
  mean does not zero a referral street; `p` sits at the 0.01 floor, so the
  card honestly expects ~0 claim-grade roofs per 40 doors and the rationale
  says *"No NWS hail or wind report on file here … a referral street, not a
  claim street."*
- `referralFactor` (×1.6 signed / ×1.25 any) replaces `ownJobsFactor`.
- the card leads with the anchor job (signed first, then newest):
  *"Your signed job at 1420 Oak St (Jun) — lead with the yard sign"*;
  `landmark` is the job's street and `name` its city.
- the plan title is *"Neighbours · Sep 3, 2026"*.

A storm-service failure in this mode does not fail the run: the streets
are ranked by the jobs alone and the notes say so. No jobs with
coordinates → the mode is disabled on the screen with a plain note.

---

## 3. Why these areas — what the research says

- **Verisk (2025 hail report):** in 16 states more than 20 % of roofs saw
  severe hail in a single year; roofs in poor condition carry ~60 % higher
  loss cost. Roof age and condition are the strongest non-weather
  predictors of a hail claim. → roof-age factor peaks at 19–36 years.
- **IBHS impact research:** smaller-than-expected hail (1"–1.25") damages
  aged and low-grade asphalt; laminates need larger stones. → the 1"
  boundary carries most of the hail weight; the roof-age factor multiplies
  the per-roof probability, not just the rank.
- **LexisNexis (home-claims trends):** CO, NE, KS, TX lead hail-claim
  frequency; April–June is the peak. → the finder does not hard-code any
  state; it reads the live reports. Seasonality is in the data.
- **Claims-filing behaviour:** most homeowner policies require prompt
  notice (many carriers, one year); Texas allows suit within two years of
  the loss. → the recency table.
- **Brown, Pogorzelski & Giammanco (2015), "Evaluating Hail Damage Using
  Property Insurance Claims Data", *Weather, Climate & Society*:** claim
  rates rise steeply with hail size; the paper's exact rate-by-size table
  was not retrievable in this session (paywalled), so §4's base rates are
  **documented model assumptions**, shaped to that finding and to field
  experience, and are the first thing to calibrate against the roofer's own
  results (the learning loop can log expected vs found per stop).

---

## 4. "Knock N doors, find at least M" — the statement

### 4.1 Per-roof probability

```
p = base(worst hail in cell) × roofAge × (direct ? 1 : 0.6) × remaining(months) × newRoof(share) , clamped [0.01, 0.75]
```

`base` is the table below **or the roofer's calibrated rate for that hail
class when they have one** (§8). `newRoof` is §4.5. The product of the
factors after `base` is the street's *modifier* (`hitModifier`) — the
calibration weighs doors by it.

**Base rate by worst reported hail** (`DEFAULT_BASE_RATES`, bucketed by
`hailClassOf` in `knockCalibration.ts`; `baseHitProbability` reads the
table through the same buckets so the two can never disagree) — the share
of asphalt roofs under that hail that carry claim-grade damage (8+
functional hits per test square):

| Worst hail | base p |
|---|---|
| ≥ 2.00" | 0.65 |
| 1.50–1.99" | 0.50 |
| 1.25–1.49" | 0.35 |
| 1.00–1.24" | 0.22 |
| 0.75–0.99" | 0.10 |
| < 0.75" | 0.03 |
| hail, no size | 0.10 |
| wind only ≥ 86 / ≥ 70 / ≥ 58 mph | 0.16 / 0.10 / 0.06 |

### 4.2 Already replaced (`remainingFactor`)

After a big storm the market moves: `remaining = max(0.5, 1 − 0.5 × months / 24)`
— three months out, ~94 % of damaged roofs are still on; a year out, 75 %;
two years out, half.

### 4.3 The binomial

Over `n = 40` doors with per-roof `p`:

- **Expect** = `n × p`.
- **At least M (80 %)** = the largest M with `P(X ≥ M) ≥ 0.8`, `X ~ Binomial(n, p)`.
- **P(≥ 5)** = `P(X ≥ 5)`.
- **Doors for 5** = the smallest n with `P(X ≥ 5) ≥ 0.8` (null beyond 600).

Worked example — 2.00" hail three months ago, 1998 median build, report in
the cell: `p = 0.65 × 1.0 × 1 × 0.94 ≈ 0.61` → 40 doors: expect ~25, at least
22 at 80 %, P(≥ 5) ≈ 1, 10 doors for 5. And 0.75" hail twenty months ago on
national-prior housing: `p = 0.10 × 0.9 × 1 × 0.58 ≈ 0.05` → expect ~2, at
least 0 at 80 %, P(≥ 5) ≈ 5 %.

### 4.5 Known new roofs (`newRoofFactor`)

A home whose roof is at least as new as the strongest storm is not a claim
candidate. The app knows a roof year for a house when a cached Zillow
record (`propertyRecordStore`, filled by jobs, leads, the pin sheet and the
plan's recently-sold list) carries one — `roofYearFromRecord`: a stated
listing year ("new roof 2021"), a listing that says "new roof" with no
year (dated to the year the listing went up — `newRoofFromListing`,
evidence `listing_new_roof`), or a build year (a house built after the
storm has a roof newer than the storm). Per cell:

```
share    = roofs with roofYear ≥ year(strongest storm day) ÷ known roofs in the cell
newRoof  = 1 − 0.8 × share        (1 when fewer than MIN_KNOWN_ROOFS = 3 records)
```

Never to zero — a handful of listings is a sample of the street, not the
street. The card says *"2 of 5 homes on file here (Zillow) have a roof at
least as new as the storm — fewer claim candidates, 32 % off the per-roof
odds."* On the plan page the recently-sold list marks each such home
*New roof · 2024* / *New build · 2026*, mutes it and sorts it last, with a
line *"2 of 5 have a new roof since the storm"*. The same year autofills
roof age on a new job, the details sheet, the job's record card and the
lead's record card (`roofAgePrefill`, source `listing_new_roof`; a stated
year still wins, and an inspector's non-zero entry is never overwritten).

### 4.4 Why 40 doors and why 5

A knocker covers ~25 doors an hour on a suburban street; a 40-door stop is
~90 minutes, short enough to fit three or four stops in a day with the
drives. **Five** claim-grade roofs per stop is the bar a good day clears:
at a typical 20–30 % close rate on a confirmed-damage conversation, five
claim-grade roofs is one to two signed jobs, and one signed job (the
$10–50K approved claim in CLAUDE.md) pays for the day several times over.
The screen states P(≥ 5) so the roofer can see when a stop is a coin-flip
versus a sure thing.

The count is about **roofs**, not conversations: roughly a third of doors
answer and allow a look, but damage is on the roof whether or not anyone
is home — soft-metal dents (gutters, downspouts, AC fins, mailboxes) and
granule piles at downspout outlets show from the street. The brief tells
the roofer what to look for.

---

## 5. Trip plan

`planTrip`: greedy nearest-next from base over the ranked areas; each stop
40 doors (96 min at 25/h); drive at 35 mph + 5 min; a day ends when the
next stop plus the drive home would pass 8 hours; at most three days;
whatever does not fit is listed as unplanned. Per day: miles, minutes,
expected finds, and the sum of per-stop 80 % floors (conservative by
construction — the true 80 % floor of the day is higher).

"Start this day" aims the knock session at the first stop (the session
carries one `routeTarget` today; multi-stop `routeStops` is in BACKLOG).
"Directions" opens Google Maps with every stop as a waypoint.

---

## 6. The AI brief

`opportunityBrief.ts` hands Gemini the ranked areas **with their computed
facts** and the rule-based reasons, and asks for: a headline, a 2–3 sentence
rationale per area (why go, what to look for at the door, what to say), an
opener line, and a plan narrative — as JSON against a schema, at temperature
0.3, with the instruction to use only the numbers given. The screen prints
the engine's figures regardless of what the model wrote. No Gemini key →
the rule-based bullets, labelled *"AI brief is not set up on this build."*

---

## 7. Honest degradation (Drift #5)

| Missing | Behaviour |
|---|---|
| Storm service unreachable | "Storm history not available" — no list (neighbours mode: the jobs are ranked alone and the notes say so). |
| No jobs with coordinates (neighbours mode) | The mode is disabled on the screen with a plain note; the runner answers `unavailable` with the reason. |
| Base with no name (a dropped pin) | Reverse-geocoded once in the runner; last resort "Pinned spot · 33.02, −96.70". |
| No calibration data | The table, and the plan says so. |
| Fewer than 3 cached records in a cell | No new-roof factor; the card says nothing about new roofs. |
| No reports in a rankable cell | "No qualifying storms" with the report count. |
| No Census key / API down | National prior, reason on every card, note in the summary. |
| No Google key | Areas named by the reporting town; no street landmark. |
| No Gemini key / model down | Rule-based rationale, labelled. |

Nothing on the screen is synthesised; every degraded state says what is
missing.

---

## 8. Calibration — the roofer's doors refit the base rates

`lib/services/knockCalibration.ts` (pure) · `lib/stores/knockCalibrationStore.ts`
(persisted `roofwise.knockCalibration.v1`).

Owner: "doors, contacts, leads and signed per area feed back into the base
rates." Every plan is a prediction; every door knocked inside a planned
area is evidence about it.

**What is counted.** For each saved plan × each of its areas, the knocks
made after the plan was created within the area's 3-mile ring
(`areaPerformance` — the same counter the plan page's *Performance: 38
doors · 12 answered · 3 leads · 1 signed* line uses). A knock is attributed
to exactly one plan-area — the newest plan made before it that has an area
within the ring, and the nearest such area — because plans for the same
base repeat the same cells run after run and a Wednesday door must not
count for Monday's plan and again for Tuesday's (`attributeKnocks`).
Records are rebuilt wholesale from the live plans and sessions at every
Find (`refreshFromStores`); deleting a plan drops its records.

**What is a find.** `isFind`: `damageNoted === true` is a find whatever the
outcome (the roofer looked); `damageNoted === false` is not, whatever the
outcome (the strongest "no" there is); otherwise an outcome that means
someone said yes to a conversation about damage — interested, booked,
inspected, signed (`isWin`) — counts, and no answer / vacant / renter / not
interested / has a roofer / do not knock do not. Doors are every outcome
that `countsAsDoor` (all of them today).

**The posterior.** Per hail class (§4.1's buckets, `hailClassOf`):

```
posterior = (table × 20 + finds) / (20 + doors_w)      clamped [0.01, 0.75]
doors_w   = Σ doors × modifier                          modifier = the street's roofAge × direct × remaining × newRoof
```

A Beta-binomial posterior mean with the table worth 20 doors
(`PRIOR_STRENGTH_DOORS`): at 0 doors the table holds; 200 doors with 60
finds under 2.00" hail moves 0.65 to 0.33. Doors are weighted by the
modifier the formula applied on that street so a slow street after an old
storm (modifier 0.5) does not drag the base rate for a fresh one — the same
200/60 on a 0.5-modifier street gives 0.61, not 0.33.

**The market ratio.** Overall, found ÷ expected (expected = Σ doors × the p
each plan promised), shrunk toward 1 with the same 20-door prior and
clamped 0.4–2.0: *"your market runs 0.8× the table"*.

**Which rate a class uses** (`calibrateBaseRates` → `CalibratedRates`):

| Class has | Rate | Card says |
|---|---|---|
| ≥ 20 weighted doors | its posterior | *Your data: 0.33 per roof (200 doors under 2.00"+ hail) vs table 0.65.* |
| < 20 doors, roofer has data | table × market ratio | *Your market runs 0.8× the table — 0.18 vs 0.22 (7 doors in this class so far).* |
| no data at all | the table | *(nothing — the table is the table)* |

`confidence` per class = doors ÷ (doors + 20). The finder reads the
snapshot at ranking time (`calibrationForRun`), passes it to
`rankAreas` / `roofHitProbability`, stamps every area with
`calibration: { hailClass, tableRate, usedRate, doors, method, note }`, adds
the note to the rule rationale when a calibrated rate was used, and the
plan's notes say *"Base rates calibrated from 207 doors on 2 plans"* or
*"Base rates are the table — calibration starts after your first plan is
knocked."* The planner screen's *Your calibration* card lists table → yours
per class with doors, and **Reset** (confirm sheet) goes back to the table
and starts the count over from that moment (`resetAt` — earlier knocks no
longer feed it; plans and knocks themselves stay).

Every record also keeps contacts, damage seen, leads, appointments and
signed per area (`AreaPerformance`) — the conversion funnel behind the
posterior, for the next thing the owner asks.

---

## 9. Estimated time (`knockRunEstimate.ts`)

Owner: "some sort of estimated time on the screen as the app is looking for
doors." The runner times every step (`activeRun.stepStartedAt`,
`stepSeconds`) and records the last 10 runs (`knockFinderStore.runHistory`).
`estimateRemainingSeconds` = the rest of the current step (typical − elapsed,
never below a quarter of typical) + every step still to come, where a
step's typical seconds is the median of successful history normalised to
25 mi — storm pull and scoring scale with the area of the circle
(radius²), housing with the areas enriched (cap 6), naming flat, the brief
capped at its 20 s timeout — or, with no history, the defaults 4 / 1 / 3 /
2 / 8 s labelled *"first run, a guess"*. The screen prints *"About 30 s
left"* under the step list.
