# RoofWise Product Synthesis — the complete Drive read

> **Provenance.** Produced 2026-08-16 from a 9-agent deep read of the owner's
> complete Google Drive folder (20+ documents: Pitch Deck FINAL 5.6.26, camera
> tech architecture, Roofwise Camera prompt, Prompt Master, App prompt/Rork,
> Professional Report spec, Long Report HAAG prompt, Kanban Mini-PRD, Dashboard
> Design Spec, 3 market-research reports, 6 launch-communications docs, Quadrant
> Deck/Jira/SOW), cross-checked against this repo.
>
> **Authority order** (highest wins): `PROMPT_LOG.md` Drift Warnings >
> `docs/HAAG_DECISION_ENGINE.md` > `docs/SPEC.md` > this document > newest Drive
> doc > older Drive doc. The Quadrant artifacts (Nov 2025) and the camera
> architecture doc are lineage; the June 2026 build prompt and this repo are the
> current line of intent.
>
> **One correction to the machine synthesis is baked in below:** the original
> ledger marked the HAAG engine "BUILT." Verified against source: it is not —
> `haagThresholds.ts` still has 3-tab at 8 (spec: >5) and architectural at 10
> (spec: >8), and `decisionEngine.ts` contains no Claim Viability engine, no
> Safety engine, and no repairability gates. The engine rewrite is priority #2.

---

## 1. NEW PRODUCT TRUTHS (not previously captured in the repo)

### Workflow & speed contracts
- **The 10–15 minute SLA with per-step budgets**: Capture 5 min, Analyze <1 min, Correct (swipe) 2 min, Report <1 min, Train in background — replacing a 6–8 hour manual HAAG inspection. This is a public, investor-committed performance contract, not aspiration. (Pitch Deck Slide 4)
- **"Minutes, not hours" is a published marketing commitment** for HAAG report generation, repeated across the press release, Product Statement, and social posts. (Launch Communications, Product Statement)
- **Latency targets exist for the analysis pipeline**: P50 ≤60s, P95 ≤180s for four squares. (Quadrant Deck + SOW §7 — lineage, but the only latency numbers anywhere)

### Capture (beyond the established Quadrant spec)
- **Swipe-review gesture semantics**: right = accept, left = reject, **up = correct**, plus a five-star confidence rating from the contractor on corrections. (Pitch Deck Slides 4, 8)
- **19-area slope/subject tagging** (Left Slope → Fence/Gate, incl. Windows, Garage, roof metals, siding), with the selected label shown in the HUD and **burned into each photo as an overlay**. (Roofwise Camera prompt; Prompt Master)
- **Two capture modes — "Single Shingle" and "10x10 Square" — whose damage counts must be aggregated separately** in reports. (Roofwise Camera prompt)
- **The square gate is soft**: if a full 10x10 square can't be confirmed, the user may still capture and analyze; accuracy protection lives in the analysis layer, not in blocking the shutter. (Roofwise Camera prompt)
- **Anti-fabrication guard**: analysis must never produce findings when no roof/shingle is present in frame. (Roofwise Camera prompt)
- **Live phone-position coaching**: an on-screen indicator reacts to device attitude and coaches the user into optimal capture position. (Roofwise Camera prompt)
- **Photo import** from iOS library/Dropbox as an alternative input path; multi-photo thumbnail strip with slope labels, shutter count badge, Done → parallel analysis with per-photo progress + ETA. (Roofwise Camera prompt)
- **Known vision failure modes to design against**: ridge caps mistaken for hail hits (false positives on ridge lines), and QA flakiness in low light → mitigate with exposure heuristics + a flashlight prompt. QA error copy is specified: `BaselineTooSmall`, `BlurDetected`, `CoverageInsufficient`. (Quadrant Jira CSV)

### AI analysis
- **Scale-aware detection is canonical**: the Gemini prompt must first estimate pixels-per-inch using the standard asphalt shingle (12"×36") as an in-photo ruler, return it as `shingleScaleEstimate` for calibration logging, and size all detections by pixel extent relative to that scale — **never hardcoded physical hail sizes** (the earlier "1/4"–2" circular bruises" instruction is explicitly deprecated in-source). (Roofwise Camera prompt; repo `gemini.ts` already references scale)
- **Metal/collateral damage detection (vents, flashing, gutters, drip edge) is wanted but conditional**: drop it if it degrades shingle-damage accuracy. (Roofwise Camera prompt)
- **Confidence-graded review**: detections under a confidence threshold auto-queue for human review; the Dashboard Spec pins the threshold at **<80%**. (Pitch Deck Slide 8; Dashboard Design Spec)
- **Triple-Check discrepancy rule**: if AI finds hail but weather history shows no storm near the claimed date, flag the inspection for review. Concrete, adoptable logic absent from the current decision engine. (Dashboard Design Spec)
- **Virtual chalk**: user-drawn circles on the roof focus a secondary, more detailed Gemini pass on that region. (Roofwise Camera prompt — the non-AR version is portable to 2D photo annotation)

### HAAG / claims logic
- **Insurance Claim vs General Inspection toggle**: selecting "Insurance Claim" makes questionnaire sections VI–IX mandatory; Storm Damage Protocols (VII) activate only when Wind or Hail is the Primary Cause of Loss. (Professional Report doc)
- **Cause-of-Loss enum (7 values)**: Wind Damage, Hail Damage, Debris Impact, Wear and Tear/Age, Installation Defect, Manufacturer Defect, Maintenance Neglect. (Professional Report doc §VI)
- **Every observation carries a required `causation` field** linking the finding to the cause of loss ("This crack is consistent with hail impact") — the crucial schema addition. (Professional Report doc)
- **Carrier norm distinct from HAAG threshold**: insurers *typically* require **8–12 confirmed impacts per test square** to total a slope. This is negotiation context for report language, NOT a detection threshold — must never overwrite the material-specific HAAG values. (Professional Report doc §VII-A)
- **Brittleness test field protocol**: lift shingle corners in an undamaged area; the test process and result must be *photographed*; a Fail justifies full replacement because spot repairs cause further damage. (Professional Report doc §VII-C)
- **Collateral evidence checklist**: gutters/downspouts (dents, not blockage), HVAC condenser fins, siding/window screens, soft-metal roof vents — each photographed. Repo already models collateral in `types.ts`/`haagPdf.ts`; the checklist-driven capture flow is the new part. (Professional Report doc §VIII)
- **Inspector credentials + local building-code compliance notes** (ventilation, ice/water shield) belong in the report because they expand covered scope and add carrier credibility. (Professional Report doc §IX)
- **"Show its work" doctrine**: every report must cite the *specific* HAAG rule triggered (e.g., "Bruise diameter >0.75 in with visible mat fracture"), because black-box AI scores are rejected by carriers and courts. Deterministic rules layer, explainable output. (ConTech Market Analysis; Roofing Tech report)
- **Human confirmation is mandatory before report finalization** — the inspector confirms or overrides every AI finding, keeping legal liability with the human and preserving adjuster trust. (ConTech §7.3; all marketing docs' "override or refine" commitment)

### Reports
- **Long Report contract**: the report layer is purely presentational. It reads one `{{inspection_json}}` (schema: `job`, `event`, `roof`, `slopes[]` with D/U/R/A + recommendation booleans, `collateral`, `summary`), never recalculates RC = D×U×R×A, never contradicts the precomputed booleans, and outputs a fixed **8-section** structure (Report Info → Executive Summary → Weather & Event → Roof System → Slope-by-Slope → Collateral → Conclusions → Inspector Certification). Confirms the decision engine feeds the report generator, not raw findings. (Long Report doc)
- **Two report variants**: General and Insurance; the Insurance variant has a **6-section** required structure with hail test squares rendered as a table (Slope | Count | Size) and the brittleness result narrated into a repairability conclusion. (Professional Report doc Part 3)
- **Tamper-evidence**: signed PDF with embedded SHA-256 hash and a verification endpoint; schema-versioned JSON export. (Quadrant Deck/Jira/SOW; echoed by Roofing AI Market Analysis)

### CRM / pipeline
- **11-column job pipeline** (New Lead → Contacted → Inspection Scheduled → Inspection Complete → Estimate Sent → Approved/Signed → Scheduled for Install → In Progress → Completed → Invoiced → Paid), drag-to-change-status, full card spec (name, address, status pill, Damage Score badge, carrier/claim, rep chip, photo/report/estimate icons), filters (rep, carrier, score range, search), per-column sorting, mobile column-picker pattern. (Kanban Mini-PRD)
- **RoofWise Damage Score is 1–100 and INVERTED**: 1–30 = red/high severity/likely full replacement, 31–60 = orange/moderate, 61–100 = green/likely repair. It's a roof-health score; do not "fix" the direction — reconcile with `DamageScoreBar` semantics explicitly. (Kanban PRD)
- **Every inspection must flow into the CRM pipeline** — inspections are never standalone artifacts. (Product Statement; ConTech: "40% of leads go to the first responder")

### Storm intelligence & leads
- **Storm-matched lead clustering is the "killer feature"**: cross-reference the CRM/contact book against storm swaths to surface warm leads ("3 leads within 2mi of Apr 18 hail core"; Storm-Impacted KPI = contacts within 72h swath). (Pitch Deck Slides 5, 8; Dashboard Design Spec)
- **Time Travel storm slider**: 3–4 years of hail/wind history browsable by address and on the map, with a canvassing use case of neighborhoods hit ~18 months ago (statute-of-limitations window). Lookback stated as 3 years (Camera prompt) and 4 years (App prompt, Dashboard Spec) — take **4 years as ceiling, 3 as floor**.
- **Hail ≥0.25" is the published storm-validation floor** for the storm-match feature. (Press Release, Product Statement, Launch Communications — quoted identically in all three)
- **Weather tile has three alert states** (benign / watch / active-warning with alert styling + "View Radar" deep link to the map), and exists partly for **safety**: real-time wind speed matters because high winds make steep-slope work unsafe. (Dashboard Design Spec)

### Learning loop (extends the established 6-step local loop)
- **Trust-weighted corrections**: Haag-certified inspectors' corrections weigh more than junior estimators' in retraining. (Pitch Deck Slide 8)
- **Weekly (Sunday) cloud retraining cadence** on accumulated corrections — the *post-raise, custom-model* version of the loop; the repo's local calibration (±20% cap) + Gemini prompt-prefix approach is the current implementation. (Pitch Deck Slide 8)
- **Custom-trained model replacing the Gemini dependency is a hard 12-month post-raise milestone**; data targets: 50K labeled examples at 6 months, 100K at 12 months = defensible moat. (Pitch Deck Slides 8, 15)

### Business model & platform (roadmap truth, not v1 scope)
- **Pricing converges at $79–299/mo + $12–15 per AI report** (deck) with research benchmark $149–299/mo + $25–45/report; $300–500/mo is the ceiling. No tier structure is defined anywhere — an open product decision. (Pitch Deck Slide 10; three market-research docs)
- **Freemium wedge**: free photo organization, paywalled HAAG report. (ConTech §6.1)
- **Phase 2+ platform**: carrier API ($5–15/inspection + $10–50K integration), web desk-adjuster portal, Guidewire/Duck Creek/Xactimate integrations, data licensing ($50–200K/dataset), white-label, DJI drone ingestion, Solar Readiness upsell. (Pitch Deck Slide 10; ConTech §6; Roofing Tech §5.3)
- **Product KPIs to instrument now**: claim acceptance rate without re-inspection, field-scan-to-signed-PDF time, post-storm-season churn. (ConTech, KPIs to Watch)
- **Launch domain is roofwise.app** (deck says roofwise.io — treat .app as operative since it's in the API config doc). Founder: Derrick Robinson.

---

## 2. CONTRADICTIONS (resolved rulings)

**A. Docs vs the established base (Drift Warnings win unless noted):**

1. **LiDAR/ARKit** — nearly every Drive doc makes ARKit/LiDAR central, and the Pitch Deck publicly sells "±1cm LiDAR." **Drift Warning #10 (camera-only v1) governs** — it postdates all of them. LiDAR/AR capture is the highest-conviction v2 item; v1 marketing must not repeat the LiDAR claim.
2. **HAAG thresholds** — ConTech's flat `hailHitsPerSquare >= 8 → Full Replacement`, and the Professional Report doc's "8–12 impacts to total a slope," conflict with the material-specific thresholds. **`docs/HAAG_DECISION_ENGINE.md` wins.** Keep 8–12 only as carrier-norm *context text* in reports.
3. **Brittleness states** — Professional Report doc is binary Pass/Fail; repo uses FAIL/BORDERLINE gates. **Repo wins**; the *field protocol + mandatory photos* from the doc are new and adopted.
4. **Damage taxonomy** — Quadrant: 5 types; Long Report JSON: 9; marketing: 5; Pitch Deck: 10 + "and more." **The 13 canonical categories (Drift #6) win**; the Long Report schema needs an explicit 13→9 mapping layer.
5. **Gemini model** — Camera prompt says `gemini-1.5-flash`; **Drift #9's `gemini-2.5-pro` wins**.
6. **Navigation** — App prompt and Dashboard Spec mandate an 8-module sidebar; Kanban PRD assumes a "Job Status tab." **Drift #2's 5 tabs win**; Kanban lands inside an existing route, Storm Intel folds into Map, Reports/Inspections stay as routes.
7. **Dashboard hero** — App prompt + Dashboard Spec put a 5-KPI card row first. **Drift #3 wins**: Quick Inspection + New Job hero CTAs; KPIs below the fold at most.
8. **Mock data** — Rork prompt and Dashboard Spec require mock mode; Camera prompt's service falls back to mock findings on placeholder key. **Drift #5 (no mocks, boots empty) wins** — verify `gemini.ts` fails friendly, never synthesizes.
9. **Theme tokens** — Kanban PRD and Dashboard Spec are full of inline hex and px sizes. **Drift #11 wins**: anything adopted maps into `theme/tokens.ts`. The Dashboard Spec's *principle* (light, high-brightness surface for sunlight readability) validates the repo's direction.
10. **Touch targets** — Kanban PRD's 12–14px text, hover states, drag-and-drop conflict with ≥56pt glove targets. **Drift #1 wins**; the Kanban is re-specced mobile-first (its own mobile section — column picker + full-width cards — is the usable part).
11. **Stack** — tRPC, Node/Postgres/AWS/Auth0/FastAPI/TorchServe, CoreML/TFLite are all lineage. **Expo + Supabase + Gemini REST wins.**
12. **Accuracy targets lineage** — ≥85% top-1 / IoU ≥0.55 / ±10% area originate in Quadrant's *custom-model* plan. Applying them to Gemini is a carry-over: treat as acceptance goals to *measure*, not claims to make.
13. **Persona** — marketing gives adjusters equal billing. **Drift #1's gloved roofer wins for v1**; the adjuster is a *report consumer* (share link `app/p/[id]`); the adjuster portal is Phase 2.

**B. Docs vs docs:**

14. **Photos per square** — deck says 4; Quadrant says 2–3. **Quadrant SOW (2–3, ~30° parallax) is the engineering spec**; "4" is marketing rounding.
15. **Report time** — "<1 min" (Slide 4 table) vs "five minutes later" (talking points). Hold the product to <1 min for queued generation; never publish "5 minutes."
16. **Retraining architecture** — Sunday cloud retrain vs the June prompt's local loop. **June prompt wins now**; Sunday cloud retrain belongs to the post-raise custom-model milestone.
17. **Damage color coding** — three incompatible schemes across docs. No canonical mapping exists; **decide once in `theme/tokens.ts`** (recommend severity-based, not peril-based — 13 categories outgrew 3 colors).
18. **Storm lookback** — 3 yr vs 4 yr vs "multiple years" vs the 2-year corroboration max. These are different things: **map/canvassing history = up to 4 years; claim corroboration window = 2 years per HAAG_DECISION_ENGINE.md**. Don't merge them.
19. **Confidence ≠ accuracy** — "90–100% confidence" (Slide 5) vs "88%+ accuracy" (Slide 6) vs "90%+" as a *future* milestone (Slide 15). The product must never render model confidence as an accuracy claim in reports.
20. **Market figures** disagree across the three research docs (denial rate 24% vs ~30% vs 47%-TX; market $49.5B vs $31.4B). Marketing numbers only — none are product logic. The Roofing AI Market Analysis has **blank/corrupted threshold values**; thresholds come from HAAG_DECISION_ENGINE.md, never that doc.
21. **Off-target/placeholder docs** — the Influencer Messaging doc is for a *physical shingle product*: excluded. Press release has placeholder CEO "John Smith" + stale Jan 31 2026 date. Pitch deck Slide 13 has `[Founder Name]`. Long Report's sample JSON (RW-2025-0001, Jane Doe) is fixture data — never seed it (Drift #5).
22. **Marketing scope vs build** — public docs promise video, drone, and satellite imagery inputs; the repo is camera-photo-only. Either build photo-library import (cheap, already specced) or correct the marketing before launch. Conversely, the press release calls cost estimation "future roadmap" while `costEstimator.ts` already exists.

---

## 3. LAUNCH BLOCKERS

1. **Google API key configuration** — API restrictions ON for the client key (Weather, Maps JS, Geocoding, Places, Static Maps, optional Elevation); application restrictions OFF until deployment (premature restriction → `REQUEST_DENIED`); **two-key architecture** with a separate server-only, IP-restricted key for historical weather + report generation. Reconciliation needed: the doc assumes a web app; the repo uses per-platform native keys (`EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY/ANDROID_KEY/WEB_KEY`) which need bundle-ID / package+SHA-1 restrictions. The server-only key follows the `SUPABASE_SERVICE_ROLE_KEY` rule: never in the client bundle.
2. **Supabase project unreachable** — auth, sync, and backup are dead until restored or recreated. Local-first design keeps the app running, but "built-in CRM with cloud history" is a launch commitment.
3. **`requireAuth` must flip to true** (Drift #12; false for dev).
4. **No-mocks audit of `gemini.ts` and all IO services** — the Camera-prompt lineage had a mock-findings fallback; Drift #5 requires friendly "Not available," never synthesized findings. Enforce the anti-fabrication guard before any carrier sees a report.
5. **Speed commitment must be real** — "minutes, not hours" and "<1 min report" are published. Measure scan-to-signed-PDF before shipping.
6. **Expo Go ceiling** — Apple Sign In, background analysis/upload, mileage geofencing, true voice input all need a dev build. Decide dev-build-vs-Expo-Go before launch; email/password is the working auth path today.
7. **Storm-validation floor** — ≥0.25" hail threshold and multi-year lookback are public commitments; `stormMatch.ts`/`stormWatch.ts` don't visibly enforce 0.25" — unverified.
8. **Key hygiene** — rotate any key ever pasted in chat/docs before restricting.

---

## 4. FEATURE LEDGER (repo-verified)

**BUILT** = exists in repo · **PARTIAL** = surface exists, doc-specified behavior incomplete/unverified · **MISSING** = no repo trace.

### Capture & camera
| Feature | Source | Status |
|---|---|---|
| Quadrant wizard: 4×10x10ft squares, guided flow | Quadrant; Pitch Deck | **PARTIAL** (`quick-inspection.tsx`, `CameraHUD.tsx`; 4-square wizard fidelity unverified) |
| 2–3 angled photos/square, ~30° baseline indicator | Quadrant | **PARTIAL** (`deviceMotion.ts`; baseline indicator unverified) |
| QA gates w/ actionable error copy + flashlight prompt | Quadrant Jira | **PARTIAL** (`photoQuality.ts`; error copy/low-light prompt unverified) |
| Live pitch (° + X:12) & elevation HUD | Prompt Master; Camera prompt | **BUILT** (`pitch-gauge.tsx`, `deviceMotion.ts`, `CameraHUD.tsx`) |
| 19-area slope/subject dropdown, label burned into photo | Camera prompt | **MISSING** |
| Single Shingle vs 10x10 Square mode, separate counts | Camera prompt | **MISSING** |
| Perspective-corrected shingle grid overlay | Camera prompt | **MISSING** |
| Phone-position coaching indicator | Camera prompt | **MISSING** |
| Photo import (library/Dropbox) | Camera prompt | **PARTIAL** (pickers installed; inspection wiring unverified) |
| Thumbnail strip, parallel analysis + progress/ETA | Camera prompt | **PARTIAL** (`analysisQueue.ts` exists; per-photo ETA UI unverified) |
| AR/LiDAR: grid anchor, depth map, 3D markers, AR chalk | Camera prompt; Quadrant | **MISSING — deliberately** (Drift #10, v2) |
| Video / drone / satellite input | Press Release, Product Statement | **MISSING** (see Contradiction 22) |

### AI analysis
| Feature | Source | Status |
|---|---|---|
| Gemini bbox detection, 13 categories, severity + confidence | Established | **BUILT** (`gemini.ts`, `edit-detection`, `DamageMarkerLayer`) |
| Scale-aware detection (12"×36" ruler, `shingleScaleEstimate`) | Camera prompt | **PARTIAL** (scale referenced; calibration logging unverified) |
| Anti-fabrication guard (no roof → no findings) | Camera prompt | **PARTIAL** (unverified in prompt) |
| Collateral hail detection (conditional) | Camera prompt | **PARTIAL** (modeled in types/report; detection-side unverified) |
| Confidence-graded auto-queue (<80%) for review | Pitch Deck; Dashboard Spec | **PARTIAL** (`confidenceTiers.ts`, `trainingQueueStore.ts`; 80% rule unverified) |
| Triple-Check discrepancy flag | Dashboard Spec | **MISSING** |
| Ridge-cap false-positive mitigation | Quadrant Jira | **MISSING** |
| Circle-to-focus secondary analysis (2D virtual chalk) | Camera prompt | **MISSING** |
| Dual-model fusion (Gemini + YOLO) | Camera prompt | **MISSING — superseded** (Drift #9; revisit at custom-model milestone) |

### HAAG engine & claims
| Feature | Source | Status |
|---|---|---|
| Material-specific thresholds per HAAG_DECISION_ENGINE.md | Established | **WRONG IN CODE** — `haagThresholds.ts` has 3-tab 8 (spec >5), architectural 10 (spec >8); wood/metal/tile/flat rules missing (BACKLOG Now #1) |
| Repairability gates (discontinued / brittleness / layers) | Established | **MISSING** from `decisionEngine.ts` (BACKLOG Now #1) |
| Claim Viability engine (HIGH/MEDIUM/LOW) | Established | **MISSING** (BACKLOG Now #2 — replaces invented `damageScore()` weights) |
| Safety engine (SAFE/USE_CAUTION/UNSAFE) | Established | **MISSING** (BACKLOG Now #3) |
| Brittleness result captured w/ FAIL/BORDERLINE | Established | **PARTIAL** (captured in `new-job.tsx`/`inspectionStore.ts`; not yet a decision gate) |
| Brittleness *field protocol* (photograph process + result) | Professional Report doc | **MISSING** (photo evidence requirement) |
| Insurance Claim vs General toggle; sections VI–IX | Professional Report doc | **PARTIAL** (carrier/claimNumber fields exist; questionnaire structure missing) |
| 7-option Cause-of-Loss enum; per-observation `causation` | Professional Report doc | **PARTIAL** (`causation` only in `haagPdf.ts`; not modeled through capture) |
| Collateral evidence checklist | Professional Report doc | **BUILT** (types/store/report) — checklist-driven capture flow missing |
| Inspector credentials + code-compliance notes | Professional Report doc | **PARTIAL** (`inspectorProfileStore.ts`; code-compliance capture unverified) |
| "Show its work" rule citations per finding | ConTech; Roofing Tech | **PARTIAL** (rule strings exist in thresholds; per-finding citation in report unverified) |
| Mandatory human confirm/override before finalize | All docs | **BUILT** (swipe-review + `edit-detection`) |

### Reports
| Feature | Source | Status |
|---|---|---|
| HAAG Certified Report PDF (12 sections, every photo by slope, homeowner summary) | Established | **BUILT** (`haagPdf.ts`) |
| Long Report 8-section LLM narrative from inspection JSON | Long Report doc | **MISSING** (June prompt's "Haag report revision" hook) |
| Insurance-variant 6-section report (test-square table, brittleness narrative) | Professional Report doc | **PARTIAL** |
| Signed PDF + SHA-256 + verification endpoint | Quadrant; research | **MISSING** (needs Supabase edge function) |
| Proposal generation + share link + signature | Repo/SPEC | **BUILT** |
| Weather validation (≥0.25" hail, multi-year) | Marketing; Long Report | **PARTIAL** (0.25" floor unverified) |
| 3D GLB export / viewer | Quadrant | **MISSING — deliberately** (v2) |

### CRM / pipeline / dashboard
| Feature | Source | Status |
|---|---|---|
| Leads, jobs, detail screens, lead→job flow | Prompt Master | **BUILT** |
| 11-column Kanban pipeline (mobile-first re-spec) | Kanban PRD | **MISSING** |
| Damage Score 1–100 inverted semantics | Kanban PRD | **PARTIAL** (`DamageScoreBar.tsx`; direction reconciliation required) |
| Dashboard hero CTAs, storm alert, recent jobs, activity | Drift #3/#4 | **BUILT** |
| Weather tile 3 alert states + radar deep link | Dashboard Spec | **PARTIAL** |
| Calendar sync + Running Late SMS | Dashboard Spec | **MISSING** (optional) |
| AI analytics panel | App prompt; Dashboard Spec | **PARTIAL** (`AICalibrationCard.tsx`) |
| Search across name/address/claim | Dashboard Spec | **BUILT** (`app/search.tsx`) |

### Maps & storm intel
| Feature | Source | Status |
|---|---|---|
| Map with pins, unified abstraction | June prompt | **BUILT** |
| HailTracer heat map | June prompt | **BUILT** (`hail-tracer.tsx`) |
| Storm history by address (3–4 yr), per-job storm view | Camera/App prompts | **PARTIAL** (lookback depth + per-job view unverified) |
| Storm-matched lead clustering ("N leads within Xmi") | Pitch Deck; Dashboard Spec | **PARTIAL** (contact×swath cross-reference missing) |
| Time-travel storm slider | Dashboard Spec | **MISSING** |
| Swath severity legend (hail-size bands) | Dashboard Spec | **PARTIAL** (keep distinct from HAAG thresholds) |

### Learning loop
| Feature | Source | Status |
|---|---|---|
| 6-step local loop (corrections → profile → ±20% calibration → prompt prefix @20+) | June prompt | **BUILT** (`learning/`, `correctionsStore/Sync`, Train tab) |
| Swipe up = correct + 5-star confidence rating | Pitch Deck | **PARTIAL** (`swipe-review.tsx`; up-gesture + stars unverified) |
| Trust-weighted corrections | Pitch Deck | **MISSING** (add field now, weight later) |
| Weekly cloud retraining / custom model | Pitch Deck | **MISSING — deliberately** (post-raise) |

### Tools & platform
| Feature | Source | Status |
|---|---|---|
| Pitch gauge, cost estimator, mileage, door-knocking, safety check, solar | Various | **BUILT** |
| Mileage auto drive-detection | Prompt Master | **PARTIAL** (manual built; auto needs dev build) |
| Voice notes / transcription | Repo | **BUILT** |
| Offline-first + pending upload queue | Dashboard Spec; Quadrant | **BUILT** |
| Backup/export | Repo | **BUILT** |
| Adjuster portal; carrier APIs; data licensing; white-label; DJI; pricing tiers | Quadrant; ConTech; Pitch Deck | **MISSING — roadmap** (Phase 2/3) |

---

## 5. BUILD PRIORITIES (corrected order)

The June 2026 build-prompt order (maps → overlay editor → analysis-on-demand →
learning loop → HailTracer → Solar estimator → Haag report revision) is
substantially done. What remains is sequenced by claim-winning value:

1. **Launch-blocker sweep** — Google API two-key/per-platform reconciliation, Supabase restore, no-mocks audit of `gemini.ts`, `requireAuth` flip, key rotation. *Everything else is unshippable until the app talks to its backends legally and honestly.*
2. **HAAG engine rewrite** — `haagThresholds.ts` + `decisionEngine.ts` to `docs/HAAG_DECISION_ENGINE.md`: corrected material thresholds, repairability gates, exact decision-tree order, RC = D×U×R×A stored once, **Claim Viability engine** (replaces `damageScore()`), **Safety engine**. *The engine is upstream of everything the report says; wrong thresholds in front of a carrier are fatal.*
3. **Haag report revision → Long Report + Insurance variant** — the 8-section Long Report contract and 6-section insurance structure (causation fields, test-square table, brittleness narrative, rule-citation strings). *The report IS the product — "the only automated Haag-compliant reporting system" is the entire pitch.*
4. **Insurance Claim mode (sections VI–IX)** — claim toggle, Cause-of-Loss enum, per-observation causation, collateral checklist capture, brittleness photo protocol, credentials/code notes. *Converts an inspection into a winnable claim.*
5. **Detection hardening** — scale-aware `shingleScaleEstimate` logging, anti-fabrication guard, ridge-cap false-positive instruction, <80% auto-queue wiring into Train. *Accuracy failures in front of an adjuster destroy the trust product permanently.*
6. **Storm validation to the public spec** — ≥0.25" hail floor, 3–4-year address lookback, per-job storm view, Triple-Check discrepancy flag. *Weather corroboration is the "Cause" leg of the claim packet and a published commitment.*
7. **19-area slope tagging + Single-Shingle/Square modes** with separate counts — extend `CameraHUD` + inspection model. *The report aggregation contract is broken without it, and it's cheap.*
8. **Damage Score reconciliation + mobile-first pipeline board** — fix score semantics against the inverted 1–100 bands; ship the 11-column pipeline as a glove-friendly column-picker inside Leads. *"Every inspection flows into the CRM" is a core commitment.*
9. **Swipe-review completion** — up-to-correct gesture, 5-star confidence, trust-weighting field on the correction profile. *The 2-minute Correct step is the flywheel's intake and the demo's signature moment.*
10. **Report integrity** — SHA-256 hash + verification (Supabase edge function), signed-PDF metadata. *Tamper-evidence makes the PDF carrier-grade evidence rather than a contractor brochure.*
11. **Speed instrumentation** — scan-to-signed-PDF, claim-acceptance-without-reinspection, analysis P50/P95 vs ≤60s/≤180s. *"Minutes not hours" is published; the KPIs need data from day one.*
12. **Photo-library import into the inspection flow.** *Cheapest way to honor the non-camera-input marketing promise.*
13. **Deferred, explicitly (do not quietly resurrect)**: AR/LiDAR, 3D/GLB, custom model + Sunday retraining, adjuster portal, Guidewire/Duck Creek/Xactimate, DJI, calendar sync/SMS/gamification, pricing tiers/freemium — v2/post-raise per Drift #10, the 12-month custom-model milestone, and Phase 2/3 GTM.
