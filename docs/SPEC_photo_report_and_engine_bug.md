# Wave — Per-photo damage report + non-roof subject identification + ENGINE-VERDICT bug

Owner (2026-09-02, with 5 screenshots of the current analysis screens): "Each photo, after
being analyzed should be able to be selected and have a page that shows a short damage
report. Like how many hits and type of damage. Type of shingle/roof. What side. And if it's
not a roof it should be able to identify what has been captured and the type of damage."
Plus: keep the existing analysis screens (claim packet, composite damage map, per-slope
grid, AI findings) — "I like the functionality and layout" — make the NEW page's UI great
and modern, its own design, consistent with the app.

## A. Per-photo damage report page (the explicit ask) — `app/photo-report/[...]`

Tap any analyzed photo (from the per-slope grid, the composite map, or capture review) →
a dedicated page (distinct from edit-detection's marker editor) showing a SHORT report for
that ONE photo, from data already on the analysis result:
- The photo with its AI overlay (reuse the marker overlay component).
- **Header:** which slope / side (areaTag → "Front Slope, Street-Facing"), capture mode
  (Test Square / Single Shingle), shingle/roof type + confidence.
- **Damage summary:** total hits/markers on this photo, broken down by category with
  severity + count + confidence (Hail Hits ×18 severe 93%, Granule Loss ×3 …), and the
  per-photo hits-vs-square read (e.g. "18 hits in this test square — above the >5 3-tab
  threshold"). Use the real per-photo marker data (markers carry category/severity/bbox).
- **Shingle scale** (the in-photo ruler estimate) when present.
- Actions: edit markers (→ edit-detection), re-analyze this photo, delete this photo
  (photo-mgmt wave), add a voice/text note.
- Honest states: analyzing (spinner), failed (reason + retry), no findings ("No damage
  detected in this photo").

## B. Non-roof / collateral identification (new AI capability + UI)

Today `gemini.ts` returns `no_roof_detected: boolean`. Extend it: when the subject is NOT a
roof field, identify WHAT it is and its damage — this is HAAG collateral corroboration and
strengthens the claim, so it's high-value, not a nicety.
- Prompt: add a `subject` classification with a fixed enum aligned to the 19 area tags /
  collateral zones (AC condenser / fins, gutter / downspout, fascia / soffit, siding,
  window / screen, garage door, fence / gate, roof vent / soft metal, skylight, chimney,
  vehicle, other) + a free-text `subjectDetail`, and a `collateralDamage` finding list
  (dents, bent fins, spatter, cracks) with severity/confidence. Keep the 13 roof categories
  for roof photos. `no_roof_detected` stays for truly-unidentifiable frames.
- The per-photo report renders the collateral case: "AC condenser — hail spatter + bent
  fins (medium)" with the markers, and it counts toward the collateral checklist / claim
  evidence, not the per-square roof threshold (Drift #7 — collateral ≠ roof hits).
- Additive types only; `analyzeSlope` stores `subject`/`collateralDamage` on the photo.

## C. ENGINE-VERDICT CONTRADICTION — high-priority correctness (found in the screenshots)

The screenshots show a **self-contradicting claim packet** that would lose real claims:
- Claim Packet: **"No Functional Damage / Repair-Monitor / 6.5 affected squares"** and the
  homeowner-safe "supplement not advised" — WHILE the same inspection shows **62 hail hits,
  Hail Hits = SEVERE (93%)**, and the Recommended-Next-Step text itself says "62 hail hits …
  8+ per 100 sq ft is replacement territory." The verdict contradicts the evidence.
- Suspects to trace in `decisionEngine.ts` + `analyzeSlope.ts`:
  1. **Per-square bucketing**: 62 total hits across 9 test-square photos ≈ 6.9 hits/square;
     3-tab threshold is >5 → should MEET it. Verify `hail_hits_per_square` is actually the
     per-100-sq-ft value (squareHitCount / test-square count), not total-across-all-photos
     or a mis-divided number that lands below threshold.
  2. **`functional_damage_present` is a separate flag** (decisionEngine.ts:410
     `anyFunctional = some(functional_damage_present === true)`); is it ever DERIVED from the
     AI hit counts, or does it default false so a 62-hit slope reads "no functional damage"?
  3. **`§4 step 3: hail_hits_per_square >= 8`** (line 500) is hardcoded 8 while the 3-tab
     material threshold is >5 — a 6.9-hits/square 3-tab roof would pass the material rule but
     fail the step-3 gate. Reconcile against `docs/HAAG_DECISION_ENGINE.md` §4 (do NOT loosen
     a documented threshold without the owner-decision process; if the doc says 8, the bug is
     elsewhere; if step-3 should use the material threshold, fix it).
- Also visible / to fix while here:
  - **Deprecated "Damage Score 27/100 — Wear consistent with age"** still renders on the
    analyze hero (screenshot 5) though #51 removed it from reports — remove from the analyze
    screen too; the band (Borderline / 39%) is the real signal.
  - **Duplicate "Shingle Type · None" rows** in the claim packet's Documented Findings
    (screenshot 1) — de-dupe the per-slope findings list.
  - **Pitch 58°** (screenshot 2) is implausible (≈19:12, near-vertical) — validate/label the
    pitch input (likely the pitch-gauge-not-persisted bug #1 or a bad default); clamp/flag
    absurd pitch.
This is the #1 credibility issue: the app must not tell a roofer "no damage" on a severely
hail-struck roof. Trace with a scratch reproduction using the real counts before changing
any threshold.

## Non-negotiables
Keep the existing analysis screens; the new per-photo page is its own modern design in the v3
system; tokens/≥56pt; NO fabricated findings; collateral never counts as roof hits (Drift #7);
engine stays sourced from docs/HAAG_DECISION_ENGINE.md; web export green; republish.
