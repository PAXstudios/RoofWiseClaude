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

### Research basis
- **HAAG test square** = 100 sq ft (10×10), ≥1 per roof direction; slopes assessed
  separately (haagglobal.com, Test Square Method).
- **HAAG protocol** includes comparative analysis of other surfaces (collateral) to
  establish hailfall, recency, size, hardness, directionality.
- **Carrier norms** cluster at 6–10 functional hits/square (IBHS 8; Allstate 10) — context
  only. `docs/HAAG_DECISION_ENGINE.md` §2 thresholds (3-tab **>5**, architectural **>8**)
  are the authority and are stricter.
- **§1**: `functional_damage_present` / `cosmetic_only` are authoritative booleans —
  the score MUST consume them, never re-derive them from counts.

---

## Step 1 — Band from the §4 decision-tree outcome

The recommendation sets the range. This guarantees score↔verdict agreement.

| §4 recommendation | Band label | Range |
|---|---|---|
| `NO_STORM_DAMAGE` (no functional damage) | **Sound** | 86–100 |
| `REPAIR` | **Serviceable — repair** | 61–85 |
| `PARTIAL_REPLACEMENT` | **Compromised — partial replacement** | 31–60 |
| `FULL_REPLACEMENT` | **Failed — full replacement indicated** | 0–30 |

## Step 2 — Position within the band by severity (0 = least severe → band top)

`severity = Σ(weight × component)`, each component 0..1, clamped. Cosmetic-only slopes
contribute **0** (§1: cosmetic never counts).

| # | Component | W | Definition (all from engine inputs/outputs) |
|---|---|---|---|
| S1 | **Threshold exceedance** | .35 | `max over slopes(hail_hits_per_square ÷ material_threshold)`; mapped so 1.0× = 0.5 and ≥2.0× = 1.0; below threshold scales 0→0.5. Cites §2 + the material rule. |
| S2 | **Breadth across slopes** | .25 | `slopes_meeting_threshold ÷ slopes_documented`. §4 escalates to FULL when functional damage spans >2 slopes; storms hitting every elevation are worse. |
| S3 | **Repairability gates** | .20 | `gates_triggered ÷ 4` (discontinued material, brittleness FAIL/BORDERLINE, layers ≥2, appearance/granular mismatch). §3 — these remove any repair path. |
| S4 | **Functional severity** | .15 | Presence of §1 hard markers: mat fracture, punctures, substrate exposure, `mat_transfer == severe`, missing shingles. Fraction of markers present. |
| S5 | **Other perils** | .05 | Wind: `wind_damaged_pct ÷ 5%` threshold, creased courses vs 3, missing vs 1; metal/tile/flat use their §2 percentages. |

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
    { points: 39, rule: '§2/§4', reason: 'Hail 6.9 hits per test square exceeds the 3-tab >5 threshold (1.4×)' },
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
