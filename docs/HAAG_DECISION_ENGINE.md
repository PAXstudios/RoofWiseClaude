# HAAG Decision Engine — Authoritative Specification

> **Source of truth.** Reconstructed verbatim from the owner's Google Drive:
> - *"Haag's full Protocol for Assessment of Hail-Damaged Roofing"* (prompt doc)
> - *"🟧 RoofWise Prompt for HAAG: DECISION ENGINE SYSTEM"*
> - *"Quadrant — AI Roof Inspection App (Insurance-Grade)"* technical spec
>
> Anything in code that contradicts this document is a bug. Do not "simplify"
> these thresholds — they are what carriers argue against.

---

## 1. Functional damage — the load-bearing concept

**Functional damage** reduces the roof's water-shedding capability **or** its
expected service life. Everything in this engine keys off it.

For asphalt shingles, functional damage is:
- Bruises or soft spots **with mat fracture**
- **Punctures** through the shingle mat
- Granule loss **sufficient to expose** the underlying bitumen or mat

**Not** functional damage (cosmetic only):
- Minor surface marks
- Granule loss **without** substrate exposure
- Thermal blisters
- Footfall / foot-traffic damage
- Natural weathering, manufacturing defects

> Hail damage = *mechanically-caused* loss of granules **with substrate exposure
> or mat fracture**. Wind damage = creased, torn, flapped, or missing shingles.
> Wear and tear **must be ruled out** before a finding counts.

A slope carries two independent booleans: `functional_damage_present` and
`cosmetic_only`. They are the authoritative indicators — never re-derive them
from raw counts at report time.

---

## 2. Replacement thresholds — per material

| Material | Threshold for replacement |
|---|---|
| **Asphalt — laminate / architectural** | **> 8 hail hits per 100 sq ft test square** |
| **Asphalt — 3-tab** | **> 5 hits per 100 sq ft test square** |
| **Asphalt (any) — wind** | **> 5% of shingles wind-damaged on the slope** |
| **Wood shake / shingle** | ≥ 5 hits per square, or ≥ 3 broken shakes |
| **Metal panel** | **> 25% of panels dented**, or seam disengagement. Cosmetic dents: note only |
| **Tile (clay / concrete)** | **> 10% broken tiles**, or underlayment exposure. Clay: ≥1 broken per square |
| **Commercial flat (TPO/EPDM)** | Membrane displacement/punctures, or **> 12% puncture density per square**. Adhesion failure |

Additional asphalt triggers: multiple creased courses, or widespread
discontinuity → replacement.

> ⚠️ **Correction notice.** An earlier implementation used 8 hits for 3-tab and
> 10 for architectural. Both were wrong. The correct values are **5** and **8**.

---

## 3. Repairability gates — any one forces replacement

These override hit counts entirely. A roof can be under threshold and still
require replacement because it cannot be repaired:

| Gate | Condition | Result |
|---|---|---|
| **Discontinued material** | `is_discontinued == true` **and** damage exists | Replacement **required** — cannot match |
| **Brittleness test** | `FAIL` or `BORDERLINE` | Repairs not feasible → replacement |
| **Layer count** | `layers >= 2` | Repairs often not permitted by code → replacement |
| **Appearance** | Repair would alter appearance via granular variation | Partial replacement |

---

## 4. Roof-level decision tree

Evaluate in this exact order — first match wins:

```
IF  no functional damage AND no weather event      → NO_STORM_DAMAGE
ELSE IF functional_damage AND is_discontinued      → FULL_REPLACEMENT
ELSE IF hail_hits_per_square >= 8                  → FULL_REPLACEMENT
ELSE IF wind_creased_shingles >= 3 AND multi_slope → FULL_REPLACEMENT
ELSE IF hail_hits_per_square BETWEEN 4 AND 7       → PARTIAL_REPLACEMENT
ELSE IF isolated single-slope wind damage          → PARTIAL_REPLACEMENT
ELSE                                               → REPAIR
```

Additional FULL_REPLACEMENT triggers:
- `functional_damage_present == true` **and** spans **> 2 slopes**
- `mat_transfer == severe`

PARTIAL_REPLACEMENT also applies when damage meets threshold but is isolated to
1–2 slopes, or roof age < 7 years with isolated damage.

REPAIR requires **all** of: hail < 4/square, creased ≤ 2, missing ≤ 1, damage
isolated, shingles active, **no substrate exposure**.

---

## 5. Repair-vs-replacement cost math (Haag RC formula)

```
RC = D × U × R × A
```

| Symbol | Field | Meaning |
|---|---|---|
| D | `damaged_units_per_square` | Damaged units per test square |
| U | `unit_repair_cost` | Cost per damaged unit |
| R | `repair_difficulty_factor` | Access / complexity multiplier |
| A | `area_squares` | Slope area in squares (1 square = 100 sq ft) |

Compare `repair_cost_slope` against `replacement_cost_slope`. When repair cost is
comparable to or exceeds the practical threshold relative to replacement,
recommend replacement of that slope.

**The engine computes RC once and stores it.** Report generation must restate the
relationship in words but must never recalculate or contradict the stored values.

---

## 6. Claim Viability engine

*(This is the claimability scoring protocol. It is qualitative, not a 0–100
score — the engine returns a band, not a number.)*

**HIGH** — all of:
- Verified hail/wind event within **±72 hours** of reported date of loss
- Meets HAAG replacement thresholds
- Functional damage confirmed
- Material is discontinued
- Policy is **RCV** (replacement cost value)
- Deductible ≤ **2% of home value**

**MEDIUM**:
- Weather event exists but falls just outside the DOL window
- Borderline damage counts
- Carrier known for strict approvals (State Farm, Allstate, USAA)

**LOW**:
- DOL matches no weather event
- Wear-and-tear only
- Prior claim within last 3 years
- **ACV-only** policy
- High deductible
- Carrier with high denial rate

> **Two-year rule.** Collateral damage must corroborate the storm event, with a
> **two-year maximum since the weather incident**. Beyond that window the
> correlation is not defensible.

---

## 7. Safety engine (pre-inspection go/no-go)

Evaluated from the forecast before the inspector climbs.

| Rating | Conditions |
|---|---|
| **SAFE** | Wind < 20 mph, gusts < 25 mph, no rain, temp 40–90 °F |
| **USE CAUTION** | Wind 20–30 mph, gusts < 40 mph, slight rain (< 20% chance) |
| **UNSAFE** | Gusts ≥ 40 mph, any precipitation expected, temp < 35 or > 95 °F, thunderstorm watch |

---

## 8. Carrier-specific behavior

| Carrier | Known behavior |
|---|---|
| **State Farm** | Denies borderline hail; requires extreme documentation |
| **Allstate** | Requires functional-bruise confirmation |
| **USAA** | Heavy emphasis on wind uplift |
| **Farm Bureau** | More permissive on hail claims |
| **Erie** | Strict on date-of-loss matching |

---

## 9. Engine output contract

```jsonc
{
  "roofwise_recommendation": "FULL_REPLACEMENT" | "PARTIAL_REPLACEMENT" | "REPAIR" | "NO_STORM_DAMAGE",
  "claim_viability": "HIGH" | "MEDIUM" | "LOW",
  "roofer_safety_rating": "SAFE" | "USE_CAUTION" | "UNSAFE",
  "policy_notes": "...",
  "carrier_specific_requirements": ["..."],
  "evidence_required": ["..."],
  "detailed_explanation": "..."
}
```

Per slope:

```jsonc
{
  "slope": "Front",
  "hail_hits_per_square": 0,
  "wind_creased_count": 0,
  "missing_shingles": 0,
  "brittleness_result": "PASS" | "FAIL" | "BORDERLINE",
  "collateral_damage": ["..."],
  "haag_threshold_triggered": true,
  "recommended_action": "Full Replacement" | "Partial Replacement" | "Localized Repairs" | "No Storm-Related Work",
  "justification": "Reasoning citing HAAG thresholds and evidence."
}
```

Every response must include: slope-by-slope evaluation, roof-level
recommendation, insurance-adjuster narrative, homeowner summary, the list of
HAAG thresholds triggered, and a list of uncertainties / recommended follow-up.
**When data is missing, say which data is missing and how it affects
confidence** — never silently assume.

---

## 10. Required engine inputs

**Structural** — `hail_hits_per_square`, `wind_creased_shingles`,
`missing_shingles`, `functional_damage_present`, `mat_transfer`,
`granule_loss_level`, `number_of_slopes`, `age_of_roof`, `material_type`,
`is_discontinued`, `layers`, `pitch`, `square_footage`

**Weather** — `historical_hail_events`, `historical_wind_events`,
`max_gust_speed`, `day_of_loss_from_user`, `open_meteo_current_conditions`,
`hailtrace_verification`

**Insurance** — `carrier_name`, `ACV_or_replacement_policy`, `deductible`,
`previous_claims`, `estimate_total`

These must be collected in the New Job / Edit Job flow, and auto-populated where
the app already knows them (weather history, photos, address).

---

## 11. Capture methodology (accuracy foundation)

From the Quadrant technical spec — this is how the numbers above get measured
honestly:

- **Four 10×10 ft capture squares**: front, back, left, right — matching HAAG
  test-square methodology
- **AR overlay** frames the 10×10 ft area and doubles as a **measurement
  constraint** that stabilizes scale when LiDAR is unavailable
- **2–3 photos per square** at roughly a 30° baseline, enabling two-image
  geometry for real-world scale
- **On-device quality gates** before a photo is accepted: blur, exposure,
  framing, baseline angle

**Accuracy targets:**

| Metric | Target |
|---|---|
| Damage type accuracy (top-1) | ≥ 85% |
| Segmentation IoU (macro) | ≥ 0.55 |
| Area error | ≤ ±10% vs. ground truth |

On-device inference is for **preview only and is non-authoritative**. The
authoritative result comes from the full analysis pass.
