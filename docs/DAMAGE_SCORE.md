# RoofWise Damage Score (RDS) — methodology

**Owner directive (2026-09-02):** "Figure out the best way to score a damaged roof with
100 being a roof that doesn't need repair or replacement and is perfect, and 0 being the
worst damaged roof — all based on how Haag calculates a roof replacement need using
Insurance."

**Scale:** 0–100. **100 = sound roof, no storm work indicated. 0 = worst.**
Matches the Kanban PRD's inverted bands (1–30 red / 31–60 orange / 61–100 green).

---

## Design principle: the score is DERIVED, never parallel

The previous `damageScore()` invented its own weights (`hail×1.5 + missing×4.0 …`), ran in
the **opposite direction**, and could disagree with the HAAG determination — which is how a
roof with 62 severe hail hits displayed "27 of 100 — wear consistent with age."

**A carrier rejects a black-box number** (`docs/PRODUCT_SYNTHESIS.md` §"show its work"). So:

> **The RDS is a presentation of the HAAG decision-engine result, not a second opinion.**
> It cannot contradict the recommendation, because it is computed *from* it, and every
> point deducted cites the HAAG rule that caused it.

The authoritative outputs remain `roofwise_recommendation` (§4) and `claim_viability`
(§6 HIGH/MEDIUM/LOW). The RDS exists to communicate severity at a glance and to sort/filter
pipeline cards.

### Research basis (owner confirmed no formula was ever provided — this is researched, not invented)

**The 0–100 condition index is an established engineering convention, not a RoofWise idea.**
The US Army Corps of Engineers (ERDC-CERL) Condition Index family — Pavement (PCI,
ASTM D6433), Building (BCI), and Roof (RCI) — all use **0–100 where 100 is "free from
observable distress"**, and the roofing industry uses the same scale, where **70–100 means
the asset retains good remaining life and is worth investing in**. Anchoring to that
convention means the number is legible to anyone who has seen a facility condition report.

**HAAG's own damage definition is a service-life argument**, which is what makes a condition
score defensible rather than decorative: HAAG counts granule loss that exposes bitumen as
damage precisely **"due to the potential loss of remaining service life"** (haagglobal.com).
Damage is scored because it costs life, so a remaining-condition scale is the natural
expression of a HAAG finding.

Also load-bearing:
- **HAAG test square** = 100 sq ft (10×10), ≥1 per roof direction; slopes assessed
  separately (haagglobal.com, Test Square Method).
- **HAAG protocol** includes comparative analysis of other surfaces (collateral) to
  establish hailfall, recency, size, hardness, directionality.
- **HAAG thresholds derive from decades of controlled impact testing** (the UL 2218
  impact-resistance lineage) — they are empirical, which is why the score must key off them
  rather than off invented weights.
- **Age drives repairability, not damage**: roofs <10 yrs repair cleanly; 15–25 yrs commonly
  fail matching and brittleness; >25 yrs are often replacement cases. This enters the score
  through the §3 repairability gates, never as a hidden deduction (see "Age" below).
- **The hit count is a carrier convention, not a HAAG figure** — HAAG publishes none
  (`docs/THRESHOLD_PROVENANCE.md`). `docs/HAAG_DECISION_ENGINE.md` §2 now carries the
  carrier standard, **≥ 8 functional hits per test square for every asphalt family**, by
  owner decision (2026-09-03).
- **§1**: `functional_damage_present` / `cosmetic_only` are authoritative booleans —
  the score MUST consume them, never re-derive them from counts.

### Age: deliberately NOT a silent deduction

A condition index would normally decay with age. This one does not, and the reason matters:
the score exists to communicate **storm-damage severity for a claim**. If a 25-year-old
undamaged roof scored 40 on age alone, the app would imply a claim where HAAG requires wear
and tear to be **ruled out** (§1). Age therefore enters only where HAAG itself puts it —
through the §3 repairability gates (brittleness, matching/discontinued) — and is surfaced as
a labelled context line ("Roof age 22 yrs — brittleness likely; test before repair"), never
as points quietly removed. State this in the UI so nobody mistakes the score for a
whole-life condition index.

---

## Step 1 — Band from the §4 decision-tree outcome

The recommendation sets the range. This guarantees score↔verdict agreement.

| §4 recommendation | Band label | Range |
|---|---|---|
| `NO_STORM_DAMAGE` (no functional damage) | **Sound** | 86–100 |
| `REPAIR` | **Serviceable — repair** | 61–85 |
| `PARTIAL_REPLACEMENT` | **Compromised — partial replacement** | 31–60 |
| `FULL_REPLACEMENT` | **Failed — full replacement indicated** | 0–30 |

**One documented refinement.** `NO_STORM_DAMAGE` is a strong claim: §4 step 1 fires only
when there is no functional damage **and** a storm search actually ran and found nothing.
A pristine roof whose storm search never ran therefore exits the tree as `REPAIR` with the
matched rule *"No qualifying storm damage found."* Scoring that roof 61–85 would imply
repairs on a roof with nothing to repair, so **`REPAIR` with zero documented damage on every
countable slope maps to Sound**. Everything else follows the table.

**Not-assessed is a state, not a score.** With no slope documented there is nothing to score;
`computeDamageScore` returns `{ assessed: false }` and the UI shows "Not assessed" (Drift #5 —
an absent determination is stated, never synthesized). A score of 100 for an uninspected roof
would be a fabrication.

## Step 2 — Position within the band by severity (0 = least severe → band top)

`severity = Σ(weight × component)`, each component 0..1, clamped. Cosmetic-only slopes
contribute **0** (§1: cosmetic never counts).

| # | Component | W | Definition (all from engine inputs/outputs) |
|---|---|---|---|
| S1 | **Threshold exceedance** | .35 | `max over slopes(hail_hits_per_square ÷ material_threshold)`; mapped so 1.0× = 0.5 and ≥2.0× = 1.0; below threshold scales 0→0.5. Cites §2 + the material rule. |
| S2 | **Breadth across slopes** | .25 | `max(slopes meeting the §2 threshold, slopes flagged functional under §1) ÷ slopes documented`. §4 escalates to FULL when functional damage spans >2 slopes; storms hitting every elevation are worse. |
| S3 | **Repairability gates** | .20 | `gates_triggered ÷ 4` (discontinued material, brittleness FAIL/BORDERLINE, layers ≥2, appearance/granular mismatch). §3 — these remove any repair path. |
| S4 | **Functional severity** | .15 | Fraction of these five §1 hard markers present: `functional_damage_present` on any countable slope, `substrate_exposure`, `mat_transfer == severe`, `missing_shingles > 0`, and a material-specific breach (membrane puncture, underlayment exposure, or metal seam disengagement). |
| S5 | **Other perils** | .05 | Wind, per countable slope: `max(wind_damaged_pct ÷ 5, creased ÷ 3, missing ÷ 1)`, clamped. The material's own §2 rule is already carried by S1. |

When a material's §2 rule fired but its magnitude was never quantified — a membrane
puncture recorded as a boolean, say, with no puncture-density percent — S1 takes **0.75**
(threshold met, magnitude unknown) and the unrecorded measurement is named in `missing`.
Placing it below 1.0 keeps an unquantified finding from scoring as the worst case.

`score = band_top − severity × (band_top − band_bottom)`, rounded, clamped to the band.

**Non-asphalt materials** substitute their §2 rule into S1 (metal: dented-panel % ÷ 25%;
tile: broken % ÷ 10%; flat: puncture density ÷ 12%; wood: hits ÷ 5 or broken ÷ 3).

## Step 3 — Confidence (qualifies the number; never changes it)

A score from one slope and no test square is not the same as a score from four. Emit
`score_confidence: high | moderate | low` + the missing inputs, from:
- slopes documented vs 4 elevations (HAAG: ≥1 test square **per direction**)
- test squares recorded per slope (`captureMode === 'square_10x10'`)
- brittleness test recorded (§3 gate is otherwise unknown)
- verified weather event within the DOL window (§6)

The UI must show the confidence next to the score. **Never present a confident number
from thin evidence** (Drift #5).

## Step 4 — Explainability payload (required)

```ts
{ score: 22,
  band: 'Failed — full replacement indicated',
  deductions: [
    { points: 39, rule: '§2/§4', reason: 'Hail 9.6 hits per test square meets the asphalt threshold of 8 or more (1.2×)' },
    { points: 25, rule: '§4',    reason: 'Functional damage on 3 of 4 documented slopes' },
    { points: 14, rule: '§3',    reason: 'Brittleness BORDERLINE — repairs not feasible' },
  ],
  confidence: 'moderate',
  missing: ['No test square recorded on the rear slope'] }
```
Every report/pipeline surface renders the score **with its band label** and, on tap, the
deduction list. The number never appears without its label — that pairing is what the old
bug got wrong.

## Guardrails
- Consumes `functional_damage_present` / `cosmetic_only`; never re-derives them (§1).
- Cannot contradict `roofwise_recommendation` — the band is taken from it.
- Thresholds come from `haagThresholds.ts` (the §2 table); the score never hardcodes one.
- Pure function, no I/O, deterministic; lives beside the engine and is unit-tested against
  worked examples (incl. the 62-hit / 9-photo 3-tab case that must land deep in the red).
- Replaces the deprecated `damageScore()`; `claimWorthiness()` retires with it.
