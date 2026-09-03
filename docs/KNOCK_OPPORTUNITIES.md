# Where should I knock? — the opportunity formula

`lib/services/knockOpportunities.ts` (pure) · `lib/services/knockFinder.ts` (I/O) · `lib/services/censusHousing.ts` · `lib/services/opportunityBrief.ts` · `app/knock-finder.tsx`

One button. The roofer should not have to think about where to go. This
document is the authority on the formula, its constants, and why each one
is what it is. Change the code and this file together.

---

## 1. What it answers

> Within 100 miles of my base, which neighbourhoods are most likely to have
> hail- or wind-damaged roofs right now, why, how many claim-grade roofs
> should I expect to find if I knock there, and in what order should I drive?

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
100 mi, look-back 24 months, hail + wind. Each report is a point; hail falls
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

- `accessFactor`: 1.0 within 25 mi, falling linearly to 0.6 at 100 mi. A
  100-mile drive is a committed day.
- `canvassedFactor`: 1 − 0.0075 × (your knocks in this cell in the last 60
  days), floor 0.7. Ground you covered last month is worth less this month.
- `ownJobsFactor`: 1.05 when you already have a job in the cell — a yard
  sign and a referral base.

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
p = base(worst hail in cell) × roofAge × (direct ? 1 : 0.6) × remaining(months) , clamped [0.01, 0.75]
```

**Base rate by worst reported hail** (`baseHitProbability`) — the share of
asphalt roofs under that hail that carry claim-grade damage (8+ functional
hits per test square):

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
| Storm service unreachable | "Storm history not available" — no list. |
| No reports in a rankable cell | "No qualifying storms" with the report count. |
| No Census key / API down | National prior, reason on every card, note in the summary. |
| No Google key | Areas named by the reporting town; no street landmark. |
| No Gemini key / model down | Rule-based rationale, labelled. |

Nothing on the screen is synthesised; every degraded state says what is
missing.

---

## 8. Calibration (next)

Log `expected` vs `found` per stop from the knock session (interested /
damage-confirmed outcomes) and refit §4.1's base rates per hail class —
the learning loop already stores corrections; this is the same pattern.
Until then, the base rates are assumptions, stated as such here.
