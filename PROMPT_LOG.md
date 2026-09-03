# RoofWise — Prompt Log

A structured context engineering log for the RoofWise project. Every meaningful prompt, decision, and implementation step is captured here so that future agents (and humans) can quickly reconstruct intent, scope, and history.

The full feature spec lives at [`docs/SPEC.md`](./docs/SPEC.md). This log captures *intent, drift warnings, and per-prompt history* — the spec captures *the product*.

---

## How to use this log

- **Append, don't rewrite** the Prompt History section.
- Re-summarize the **Context Summary** at the top every 5 new entries.
- Reference the spec by section, don't duplicate it.

### Entry template

```md
## [YYYY-MM-DD] #NN — Short title

**Prompt:**
> ...

**Intent / Goal:**
- ...

**Decisions:**
- ...

**Files touched:**
- ...

**Follow-ups:**
- ...
```

---

## Context Summary

> Last refreshed: 2026-09-03 (after entry #75).

**Product in one line:** RoofWise is the objective layer between roofing contractors and insurance carriers — AI vision + HAAG-protocol-compliant claim packets on a mobile device.

**Codebase:** Expo SDK 54 / RN 0.81 / React 19 / TypeScript, New Architecture ON, Reanimated 4, expo-router 6. Source-of-truth spec is `docs/SPEC.md`; HAAG logic is `docs/HAAG_DECISION_ENGINE.md`; the damage score is `docs/DAMAGE_SCORE.md`; threshold provenance is `docs/THRESHOLD_PROVENANCE.md`.

**Persona we build for:** A roofer in gloves on a hot roof — ≥56pt targets, sticky 88pt CTAs, sun contrast, voice on free text, confirm sheets on destructive actions, no precision gestures.

**Where we are today (entry #75):**
- **Distribution:** EAS Update → Expo Go on the owner's iPhone (`runtimeVersion` policy `sdkVersion`, keys in the EAS `preview` environment). Every session ends with `eas update`. A ⚡ standing trigger in BACKLOG fires the TestFlight/native-capability sequence the moment an Apple Developer account exists.
- **The determination chain, end to end (#65–#75):** capture → per-photo Gemini analysis (`gemini.ts`: 13 categories, 0–1000 bboxes, scale calibration, **per-hit HAAG §1 evidence class**, **non-roof subject + collateral damage**, shingle count, test-square coverage; capture context sent with every frame) → `analyzeSlope` persists per-photo state and **derives `slope.functional` from mat-fracture / exposed-substrate evidence on test-square photos** (nothing ever set it before #75) → `decisionEngine.ts` (pure): `hail_hits_per_square` is a RATE — slope total ÷ test squares shot, single-shingle and **non-roof photos excluded from the denominator** (#65, #72) → §2 asphalt threshold **≥ 8 functional hits per test square for every family — the carrier standard, owner decision #69** after research showed HAAG publishes no hit count; §2 and §4 now agree → `damageScore.ts` (#66): 0–100, 100 = sound, band from the §4 verdict so it cannot contradict it, every deduction cites its rule, confidence separate, `assessed:false` when nothing is documented.
- **Property intelligence (#67):** every job measures its roof on creation (Google Solar, verified live on the owner's key); `roofPlanes()` clusters imagery facets into real planes (fixed a S/SW boundary split that read 2.9 sq for a 6.9 sq slope); engine `square_footage` / per-slope `area_squares`, proposal, estimator and report all read one number; an unmeasured roof says so in the proposal instead of pricing a 1-square placeholder.
- **Capture (#68, #70, #73):** "Next" on Analyze never waits on the pass (remainder goes to the background queue; `analyzeSlope` has an in-flight guard so a screen pass + queue pass cannot double-attach markers). The slope tag follows a **real compass** (`Location.watchHeadingAsync` — the old HUD read DeviceMotion yaw, which is relative to an arbitrary start frame, so every photo filed as South); auto/pinned modes; the tag is never a silent default (no-compass first shot asks; >1-octant mismatch asks; cancel drops); compass-rose `SlopePickerSheet`; job import asks. **Guided capture coach**: the HAAG walk (4 slopes → 4 collateral zones → brittleness on a claim) as a step strip; progress derived from photos; collateral photos fill their claim-evidence zone.
- **Reading the damage on the phone (#72):** `app/photo-report.tsx` per photo (side, mode, shingle type read from the photo, categories with severity/confidence, test-square read vs threshold, HAAG §1 tally, shingle count, coverage, scale, provenance; non-roof photos identified as collateral corroboration); `DamageDetailSection` on the job screen (every category, per-slope chips → the photo). `DamageScoreCard` + `PropertyIntelCard` (with the satellite overhead) + `DamageScoreBar` (§6 viability band) under Assessment.
- **Storm Tracer (#71):** ONE map — the Map tab. Storms **follow the viewport** through a merged browse cache (both maps used to fetch once around a fixed centre); overlay selection is **quantised** so a pan inside a screen-quarter keeps the same native children (the inferred Expo Go pan-crash cause — unconfirmed on device); address search + my-location; the tracer's range / peril / magnitude / legend; `/hail-tracer` redirects; Home says "Storm Tracer".
- **Estimator (#74):** satellite overhead with a coloured rectangle per measured roof face (Solar per-face `boundingBox`, carried solar → intel → saved estimate); `app/estimate/[id]` shows a saved estimate as itself (the Home tile used to open a fresh wizard); Save lands there; Re-estimate prefills.
- **Storm data:** `lib/noaa.ts` per-point IEM `lsrs_by_point.geojson` with `begints`/`endts` (the only date params that endpoint honours — `sdate`/`sts` are silently ignored and return everything since 2006); `stormMatch.ts` validation floors; `stormWatch.ts` alerts + lead clustering. Typed `unavailable` everywhere (Drift #5).
- **Visual system:** iOS × Instagram redesign, glass surfaces, theme tokens only (Drift #11). **Web preview:** the web export boots headless from a Claude session — necessary, not sufficient (no camera, no native map, multi-button `Alert` does not render).
- **Auth/backend:** Supabase project `epghfumtuxrhonbpnbmr` (the owner's "roofwise claude"), schema applied (#61); email/password works; `requireAuth` false in dev; Apple Sign In parked.

**Verified live vs inferred (be honest about which):** Solar measurement, IEM per-point storm fetch, and the Places/geocoding paths were exercised live from the container. **Not** verified live: any Gemini call since #72 (no API key in this container — the new schema fields are parsed defensively and degrade to absent), the Map pan-crash fix, and the compass on a device. All three are BACKLOG "Now" items for the owner's phone.

**Known environment gotchas:**
- Multi-agent workflows in this session repeatedly died on an infrastructure fault (permission handler stripping subagent tool parameters); every wave since #65 was built in the main thread.
- `.env.local` here carries Maps/Weather/Geocoding/Supabase and the Gemini MODEL name but not the Gemini API key; the phone build gets it from EAS `preview`.
- User's Mac: working clone is `~/Documents/RoofWiseClaude`; a stale clone at `~/RoofWiseClaude` may hold Metro on 8081 — `pkill -f expo` before testing.
- Every API key and token pasted in chat is exposed — rotate before production (BACKLOG ⚡ PRE-LAUNCH trigger).

**What's mocked / placeholder:**
- Nothing. App boots empty per Drift Warning #5.

**What's parked:**
- LiDAR + ARKit native implementation (Drift #10 — buttons exist, honest copy), Apple Sign In, true background execution, geofenced mileage auto-tracking, native voice-to-text — full list in `CLAUDE.md` "Known parked items". The traced roof outline (Solar `dataLayers` mask) and the §3 matching gate (`appearance_match_impossible`, never populated) are BACKLOG "Now".

---

## Drift Warning

The following constraints are hardened and **must not silently drift**. If a prompt contradicts any of these, surface it explicitly before changing it.

1. **Persona is a gloved roofer in sun.** Glove rules from `docs/SPEC.md` apply to every view: ≥56pt touch targets, ≥12pt spacing between tappable elements, sticky 88pt primary CTAs in thumb zone, high contrast, voice input on free-text fields, chips/steppers/segmented-controls over text inputs where possible, confirm on destructive actions, no precision-only gestures, one-handed reachable controls.
2. **5 bottom tabs:** Home, Leads, Map, Plan, Train. (Settings is a route reached from Home/profile, not a tab.) The earlier 8-tab scaffold is being removed.
3. **Quick Inspection is the hero feature.** Dashboard CTAs are "Quick Inspection" and "New Job", side by side. No KPI buttons in their place.
4. **Storm Alert hero hides when there is no active alert.** Never show a stale "Severe Hail" placeholder.
5. **No mocks, no seeded sample data.** App boots to an empty state. When a service can't reach its API, show a friendly "Not available" state — never synthesize fake data.
6. **Damage taxonomy is 13 canonical categories** per `docs/SPEC.md` "13-Category AI Damage Taxonomy": Hail Hits, Bruising, Granule Loss, Wind Damage, Wind Creasing, Blistering, Cracking, Flashing Damage, Algae/Moss, Missing Shingles, Splitting, Lifted Shingles, Structural Sagging. Each finding has severity (None/Minor/Moderate/Severe) and confidence (0-100).
7. **HAAG functional-damage thresholds are material-specific.** Lookup table in `lib/services/haagThresholds.ts`, defined by `docs/HAAG_DECISION_ENGINE.md` §2. Asphalt (every family) = **≥ 8 functional hail hits per 100 sq ft test square** — the **carrier standard**, set by owner decision 2026-09-03 after research showed HAAG publishes no hit count at all (`docs/THRESHOLD_PROVENANCE.md`); never lower it without a sourced reason. Wood ≥5/sq or ≥3 broken; metal >25% panels dented or seam disengagement (cosmetic dents note-only); tile >10% broken or underlayment exposure (clay ≥1/sq); membrane displacement/punctures or >12% density. Repairability gates (§3) override hit counts. *(History: this line originally said 8/10; a later "correction" moved code and CLAUDE.md to >5/>8 without updating it here — so the two contracts disagreed for months, and the log, which wins, had the number closer to practice.)*
8. **Decision Engine is pure logic.** Given a populated Inspection, it returns per-slope + roof-level verdict + reasoning. No I/O.
9. **Gemini model:** `gemini-2.5-pro` via Google AI Studio direct REST call (upgraded from `gemini-2.5-flash` with explicit user approval, entry #29). **There is no `gemini-3-flash` / `gemini-3.5-flash`** (neither exists; prior attempt was a hallucination). Do not change the model or provider without an explicit prompt that acknowledges this constraint.
10. **No LiDAR / ARKit in v1.** Camera-only Quick Inspection. Live AR overlay parked until a custom native module is justified by user need (and Android equivalents are sorted).
11. **Theme tokens everywhere.** Never inline hex. Never inline font sizes. Always go through `colors.<token>`, `fontSize.<token>`, `radii.<token>`, `spacing.<token>`, `motion.<token>`.
12. **Auth bypass flag** is wired from day one. `requireAuth` is false during dev so the app is usable without sign-in; flip to true when ready to ship.
13. **Append, don't rewrite** the Prompt History section. Existing entries are immutable.

---

## Constraint Verification Protocol

Before completing any change, the agent must:

1. Re-read the Context Summary, Drift Warning, and the last 3 prompt entries.
2. State which Drift Warning items the request touches and confirm any intentional changes.
3. Verify damage taxonomy, HAAG threshold table, Claim Worthiness badges remain intact.
4. Verify Dashboard hero CTAs are still Quick Inspection + New Job.
5. Verify Quick Inspection flow still: camera → slope selector → multi-photo capture → Gemini analysis → results with damage score + claim worthiness → HAAG Claim Packet (once built).
6. Verify no mocks were reintroduced.
7. Append a new prompt entry.
8. Refresh the Context Summary if this is the 5th entry since the last refresh.

---

## Project Overview

**Name:** RoofWise
**Type:** Mobile CRM + AI inspection tool for roofing contractors
**Platform:** Expo SDK 51, React Native 0.74, TypeScript — iOS + Android
**Backend:** Supabase (project `mzsabjegtxmzlfpxmmfm`) — auth + Postgres + storage
**AI Vision:** Gemini 2.5 Flash via Google AI Studio direct REST

### One-line pitch (from spec)
> The objective layer between roofing contractors and insurance carriers.

### The wedge
A single denied claim costs the contractor $5K-$20K. A single approved claim is worth $10K-$50K. RoofWise pays for itself with one additional approval per month.

### The moat
The recursive learning loop (Phase 9). Tinder-swipe inspector review → corrections → trust-weighted training data → weekly retraining → accuracy compounds.

---

## Information Architecture

**5 bottom tabs:** Home / Leads / Map / Plan / Train.

**Cross-cutting routes:**
- `/welcome` — sign in / create / reset (gated entry)
- `/settings` (under tabs initially, may move under Home header)
- `/new-job` — full-screen 4-step wizard (modal-style)
- `/quick-inspection` — full-screen camera flow
- `/job/[id]` — JobDetailView
- `/inspection/[id]` — InspectionDetail (per slope, etc.)

---

## Feature Backlog & Status

Aligned to spec phases. Status is current state in *this* Expo repo, not the rork Swift repo.

> **Status audited 2026-07-22 (entry #40).** The previous version of this table
> was ~15 entries stale and listed shipped features as "Not started" — it caused
> a real near-miss where Phases 6 and 9 were about to be re-commissioned. "Built"
> below means the code exists and typechecks; it does **not** mean field-verified.

| Phase | Feature | Status | Where |
|---|---|---|---|
| 0 | Brand theme tokens | Built | `theme/tokens.ts` |
| 0 | Supabase auth + Welcome screen + gate | Built | `lib/auth/`, `app/welcome.tsx` |
| 0 | 5-tab IA migration | Built | `app/(tabs)/`, `components/shell/` |
| 1 | Home dashboard (Storm hero, hero CTAs, KPI, Recent Jobs, Pipeline, Plan) | Built | `app/(tabs)/index.tsx` |
| 2A | Data foundation (Inspection model + store + NewJobWizard) | Built | `lib/models/types.ts`, `app/new-job.tsx` |
| 2B | Quick Inspection camera + Gemini + DecisionEngine | Built | `app/quick-inspection.tsx`, `lib/services/{gemini,decisionEngine}.ts` |
| 3 | HAAG PDF report + signatures | Built | `lib/services/haagPdf.ts`, `components/SignaturePad.tsx` |
| 4A | Map (react-native-maps + NOAA pins + filters + Storm Detail) | Built | `app/(tabs)/map.tsx`, `components/map/` |
| 4B | Weather tile (Google Weather API) | Built | `lib/services/weather.ts`, `components/WeatherTile.tsx` |
| 4C | NOAA auto-event-fill on inspection save | Built | `lib/services/stormMatch.ts` |
| 4D | Solar API roof measurement | Built | `lib/services/solar.ts` |
| 4E | Cost Estimator wizard | Built | `app/estimator.tsx`, `lib/services/costEstimator.ts` |
| 5A | Inspection.originEstimateId traceability | Built | `lib/models/types.ts` |
| 5B | Activity Feed | Built | `app/activity.tsx`, `lib/stores/activityStore.ts` |
| 5C | AI Training Queue | Built | `lib/stores/trainingQueueStore.ts` |
| 6A | Service Area (zips/cities) | Built | `app/settings/service-area.tsx`, `lib/stores/serviceAreaStore.ts` |
| 6B | Storm Watch polling | Built | `lib/services/stormWatch.ts` |
| 6C | Push notifications for storm alerts | Built | `lib/services/pushNotifications.ts` |
| 6D | Dynamic Storm Alert hero (consumes alert store) | Built | `app/(tabs)/index.tsx` + `lib/stores/stormAlertStore.ts` |
| 6E | Door Knocking Mode | Built | `app/door-knocking.tsx`, `lib/stores/knockSessionStore.ts` |
| 7 | Proposals + PDF export + send sheet | Built | `lib/services/{proposalGenerator,proposalPdf}.ts`, `app/proposal/` |
| 8 | Structured Gemini confidence (flag-gated) | Built | `gemini.ts`; `EXPO_PUBLIC_USE_STRUCTURED_CONFIDENCE` |
| 9 | Recursive Learning Loop (SwipeReview + OverlayEditor + LocalLearningEngine + sync) | Built | `app/{swipe-review,edit-detection}.tsx`, `lib/services/learning/`, `correctionsSync.ts` |
| 10 | Corrections backend (separate Next.js project) | N/A here | out of repo |
| — | Voice notes (expo-av recording) | Built | `components/VoiceNoteRecorder.tsx` |
| — | Voice *commands* / native speech-to-text | Parked | needs dev build |
| — | Offline mode + sync queue | Partial | `lib/services/analysisQueue.ts` + `*Sync.ts`; no full offline story |
| — | Photo Quality scoring | Not started | — |

**Open work is tracked in `BACKLOG.md`, not here.** This table records what
exists; the backlog records what's next.

---

## Key Technical Decisions

- **Framework:** Expo SDK 51, React Native 0.74, TypeScript.
- **AI Vision:** Gemini 2.5 Flash via direct REST. Key in `EXPO_PUBLIC_GEMINI_API_KEY` (gitignored `.env.local`).
- **Backend:** Supabase JS SDK. Auth + Postgres + storage. RLS per user.
- **State:** Zustand for client state; Supabase for synced data.
- **Sensors:** `expo-sensors` (accelerometer/gyroscope for pitch + roll), `expo-location` (altitude + GPS).
- **Camera:** `expo-camera` with custom HUD overlays.
- **Map:** `react-native-maps` (Apple MapKit on iOS, Google Maps on Android). Reuse existing `lib/noaa.ts`.
- **Storage:** AsyncStorage for sessions, Zustand for in-memory, Supabase for sync. (Long-term: consider WatermelonDB or `expo-sqlite` for richer offline.)
- **No LiDAR/ARKit in v1.** Camera-only.
- **Theme tokens everywhere.** No inline hex / font sizes.

---

## Prompt History

### [2026-06-09] #01 — Migrate from rork Swift app to this Expo repo as the active codebase

**Prompt (summarized):**
> The user is moving away from the native Swift rork app to this Expo React Native repo. Wants Android support, found many features in the rork app non-functional. Asked to bring the rork product spec, APIs, and component intent into the Expo app. Also requested upgrading from Gemini 1.5/2.5 Flash to Gemini 3 Pro for vision.

**Intent / Goal:**
- Pin this Expo repo as the active codebase going forward.
- Carry the rork project's product spec, drift warnings, and context engineering discipline into this repo.
- Lock the AI model decision at Gemini 3 Pro via direct Google AI Studio API (no third-party proxy).
- Park LiDAR/ARKit features for v1.

**Decisions made:**
- Adopted `CONTRIBUTING.md` and `PROMPT_LOG.md` from the rork repo, adapted for Expo.
- Drift Warning #9 set to Gemini 3 Pro (reverted in #03 — see below).
- Drift Warning #10 parks LiDAR/ARKit for v1.

**Files touched:**
- `CONTRIBUTING.md` — created.
- `PROMPT_LOG.md` — created.

**Open questions / Follow-ups:**
- Set up Supabase JS client + persistent session storage (#02).

---

### [2026-06-09] #02 — Supabase auth foundation + email sign-in gate

**Prompt (summarized):**
> Begin work on the migration. Start with the foundation — Supabase auth + the Welcome / sign-in screen.

**Decisions made:**
- Installed `@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `react-native-url-polyfill`.
- Supabase URL + anon key in `lib/env.ts` with safe public fallbacks.
- Auth state is Zustand store (`lib/auth/authStore.ts`).
- Welcome screen at `app/welcome.tsx` toggles between sign-in / create / reset.
- Auth gate via redirects in `app/index.tsx` + `app/(tabs)/_layout.tsx`.
- Settings tab now shows account row + Sign Out.

**Files touched:**
- `package.json`, `package-lock.json`, `lib/env.ts`, `lib/supabase.ts`, `lib/auth/authStore.ts`, `app/_layout.tsx`, `app/index.tsx`, `app/welcome.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/settings.tsx`, `.env.local.example`, plus minor cleanups.

**Open questions / Follow-ups:**
- Apple Sign In (deferred).
- Email confirmation flow.

---

### [2026-06-09] #03 — Absorb full RoofWise spec; rebuild brand + IA + Drift Warnings

**Prompt:**
> You might want to check this out. I don't want you to copy this exactly into our app. But I do want you to ensure the FEATURES are included in our app. [Attaches `RoofWise_ClaudeCode_Spec.md`, 2680 lines.] Now continue doing the entire app. Wake me when you're done.

**Intent / Goal:**
- Treat `docs/SPEC.md` (the attached spec) as the product source of truth from here on.
- Realign the codebase: brand palette, type ramp, motion tokens, IA, Drift Warnings, glove rules, damage taxonomy, HAAG thresholds, no-mocks/no-seed-data discipline.
- Build the Tier 1 MVP as far as I can in a single autonomous session.

**Decisions:**
- **Spec wins on conflicts.** Reverted Drift Warning #9 from "Gemini 3 Pro" to `gemini-2.5-flash` per spec's explicit rule that there is no `gemini-3-flash`.
- Brand palette is now navy `#0C183C` + orange `#FC6018` + cream `#F0F0E4` + slate `#546078`. No raw hex anywhere else. Cream is the bg; navy is text/primary; orange is accent/CTA; slate is muted text.
- Type ramp from spec adopted as named tokens in `fontSize`.
- Added `touchTarget` (44/56/64/88) and `motion` tokens (quick/standard/gentle/bouncy + stagger).
- IA collapses from 8 tabs to 5 (Home / Leads / Map / Plan / Train). Settings moves under tabs initially.
- Damage taxonomy refined to spec's 13 categories (Hail Hits, Bruising, Granule Loss, Wind Damage, Wind Creasing, Blistering, Cracking, Flashing Damage, Algae/Moss, Missing Shingles, Splitting, Lifted Shingles, Structural Sagging).
- HAAG threshold lookup table will live in `lib/services/haagThresholds.ts`.
- DecisionEngine will live in `lib/services/decisionEngine.ts` (pure logic).
- No mocks. Empty states everywhere. `lib/mock/` retained as reference but no longer flows into tabs.
- Full spec committed to repo at `docs/SPEC.md` so future agents can reference it.

**Files touched (this entry):**
- `docs/SPEC.md` — full 2680-line spec committed for reference.
- `theme/tokens.ts` — replaced with brand palette + type ramp + touch targets + motion tokens.
- `PROMPT_LOG.md` — Context Summary, Drift Warning, IA, Feature Backlog, Key Tech Decisions rebuilt; this entry appended.

**Follow-ups:**
- Build data model types (`lib/models/`).
- Build Gemini service (real API, real error on missing key).
- Build Decision Engine + HAAG thresholds.
- Restructure tabs to 5-tab layout.
- Build Home dashboard, NewJobWizard, Quick Inspection scaffold.
- Strip web-only deps (`react-native-web`, `react-dom`, `react-leaflet`, `leaflet`) in a follow-up pass.
- Confirm Gemini model choice once user is back (revisit #9 if user still wants Gemini 3 Pro).

---

### [2026-06-09] #04 — Tier 1 MVP build: persistence, hero flows, pitch gauge, dead-code purge

**Prompt:**
> Now continue doing the entire app. Thanks. Wake me when you're done.

**Intent / Goal:**
- Push the Tier 1 MVP as far as I could autonomously while the user slept: real data model, hero flows (New Job + Quick Inspection), persistence, Job Detail, Pitch Gauge, Activity + Storm Alert stores.
- Strip the old web-only scaffold and dead components so the codebase next session is honest about its real surface.

**Decisions:**
- **Persistence:** Inspections, Activity events, and Storm Alerts each get their own Zustand store with AsyncStorage persistence (`lib/stores/inspectionStore.ts`, `activityStore.ts`, `stormAlertStore.ts`). Inspection store auto-mints `RW-YYYY-####` report IDs.
- **Hero flows:**
  - `app/new-job.tsx` — 4-step wizard. On Save: writes Inspection + logs ActivityEvent(`job_created`) + alerts the user. Glove-friendly 88pt sticky CTA, big chips and steppers, pencil-edit jump-back on Review step.
  - `app/quick-inspection.tsx` — camera scaffold with slope chip selector, multi-photo strip, Gemini analysis call (real REST), results view with summary card + per-photo findings. Surfaces a friendly warning when `EXPO_PUBLIC_GEMINI_API_KEY` is missing — never fakes detections.
  - `app/pitch-gauge.tsx` — full-screen live pitch readout in degrees + X/12 ratio + bullseye level + GPS altitude. Uses `expo-sensors` DeviceMotion + `expo-location` watch position via `lib/services/deviceMotion.ts`.
  - `app/job/[id].tsx` — Job Detail. Reads the inspection, runs Decision Engine + damage score + claim worthiness, surfaces HAAG verdict, exposes Start Quick Inspection CTA and a delete action.
- **Home dashboard polish:**
  - Storm Alert hero (Drift #4) is wired to `useStormAlertStore.alerts.find(status==='new')`. In `__DEV__` builds, a small "Inject demo storm alert" pill lets you preview the hero without a real Storm Watch service.
  - Recent Jobs carousel binds to the InspectionStore.
  - Pipeline counts derive from inspection statuses.
  - Recent Activity surfaces the latest 5 ActivityEvents.
- **Map:** Switched off `PROVIDER_GOOGLE` so iOS uses MapKit (spec preference). Filter chips updated to Leads / Jobs / Storms / Knocks. Storm data continues to load from NOAA via `lib/noaa.ts`.
- **Dead-code purge:** Removed `components/dashboard/`, `components/ui/`, `components/shell/Sidebar.tsx`, `TopBar.tsx`, `HeaderGreeting.tsx`, `StubScreen.tsx`, `components/map/StormFilters.tsx`, `StormLegend.tsx`, `theme/useResponsive.ts`, `lib/mock/`. Removed web-only deps (`react-native-web`, `react-dom`, `react-leaflet`, `leaflet`, `@types/leaflet`) plus the `.web.tsx` map shim. Web target dropped from `app.json` earlier.

**Files touched (this entry):**
- `lib/stores/inspectionStore.ts`, `lib/stores/activityStore.ts`, `lib/stores/stormAlertStore.ts` — created.
- `lib/services/deviceMotion.ts` — created (DeviceMotion + altitude hooks).
- `app/new-job.tsx` — wired to Inspection + Activity stores.
- `app/quick-inspection.tsx` — pitch-gauge entry point added.
- `app/pitch-gauge.tsx` — created.
- `app/job/[id].tsx` — created.
- `app/(tabs)/index.tsx` — Storm Alert hero, real Recent Jobs, real Pipeline counts, Recent Activity section.
- `app/(tabs)/settings.tsx` — Integrations section with Gemini + Supabase status.
- `package.json` / `package-lock.json` — removed web-only deps, no others added in this entry.
- Removed: `components/dashboard/*`, `components/ui/*`, `components/shell/{Sidebar,TopBar,HeaderGreeting,StubScreen}.tsx`, `components/map/{StormFilters,StormLegend}.tsx`, `components/map/StormHistoryMap.web.tsx`, `theme/useResponsive.ts`, `lib/mock/*`.

**What's working end-to-end now:**
- Sign in / create account / reset password (Supabase).
- Auth gate forces the Welcome screen until a session exists.
- 5-tab nav: Home, Leads, Map, Plan, Train.
- New Job Wizard creates an inspection that persists locally and shows up on Home + Job Detail.
- Quick Inspection: take photos with slope tags, attempt Gemini analysis, see structured findings + summary (or a clean "AI not connected" state).
- Pitch Gauge: live readout backed by real device sensors.
- Storm Alert hero appears on demand in dev, hides when no active alert in prod (Drift #4).
- Settings shows the signed-in account + integration status, with a confirm-on-sign-out.

**Follow-ups (Tier 1 still owed):**
- HAAG PDF report generation (`expo-print`).
- Save Quick Inspection results back to an Inspection (currently standalone).
- Photo quality scoring before Gemini send.
- Activity Feed full screen.
- Apple Sign In (Supabase Apple provider + `expo-apple-authentication`).

**Follow-ups (Tier 2+):**
- Service Area + Storm Watch background service + Push Notifications.
- Door Knocking Mode.
- Proposals + Send Sheet + PDF.
- Solar API roof measurement + Cost Estimator.
- Weather tile.
- Training Queue + SwipeReview + LocalLearningEngine (recursive learning loop).
- Voice command service.
- Offline sync queue.

---

### [2026-06-09] #05 — Wire Quick Inspection ↔ Job; HAAG PDF; Activity full screen; Pitch from Train

**Prompt (continuation of #04 — keep building until done):**
> [implicit] keep pushing the Tier 1 MVP further

**Decisions:**
- `inspectionStore.attachPhotos(jobId, captures)` creates or extends per-orientation Slope records, increments per-category counts so the Decision Engine reflects new findings immediately.
- Quick Inspection now accepts `?jobId=` and, on successful analysis, writes the captures into the inspection and logs `analysis_ran`. Surfaces a green "Photos attached" banner.
- Job Detail's Start Quick Inspection now passes `jobId`; the screen renders captured slopes with photo strips + detected damage findings.
- HAAG PDF generator (`lib/services/haagPdf.ts`) builds a styled HTML report (cover + 8 sections) and runs it through `expo-print`. Job Detail exposes a "Generate HAAG report (PDF)" CTA that produces the file, shares it via the native share sheet, and logs `pdf_generated`.
- New `/activity` full-screen view (with Clear button + empty state). Home "Recent Activity" header is now tappable and routes to it.
- Train tab now has a "Field tools" group with the Pitch Gauge tool wired up.

**Files touched (this entry):**
- `lib/stores/inspectionStore.ts` — added `attachPhotos` + slope creation helpers.
- `lib/services/haagPdf.ts` — created.
- `app/quick-inspection.tsx` — `jobId` plumbing + attached banner.
- `app/job/[id].tsx` — slope photo strips, generate-PDF CTA.
- `app/activity.tsx` — created.
- `app/(tabs)/index.tsx` — Activity header tap → `/activity`.
- `app/(tabs)/train.tsx` — Field tools row with Pitch Gauge.

**End-to-end verticals now working:**
1. **Onboard:** Welcome → sign up → enter app.
2. **Lead-to-claim:** New Job Wizard → Inspection persisted → Job Detail → Start Quick Inspection → photos analyzed by Gemini (when key set) → Decision Engine runs → HAAG PDF generated and shared.
3. **Field tool:** Train → Pitch Gauge → live accelerometer + altitude readout.
4. **Activity:** All key events logged and surfaced on Home + full-screen `/activity`.
5. **Storm Alert hero:** Hides when nil; injects a demo alert in dev for preview.

**Still owed (Tier 1):**
- Photo quality pre-check before sending to Gemini.
- Brittleness test field in NewJobWizard Step 3.
- Storm event auto-fill on inspection save (NOAA + 5mi/±30d window).
- Apple Sign In.

**Still owed (Tier 2+):**
- Proposals + send sheet + signature canvas.
- Solar API + Cost Estimator.
- Service Area + Storm Watch background + Push Notifications + Door Knocking Mode.
- Training Queue + SwipeReview + LocalLearningEngine.
- Mileage tracker.
- Voice commands.
- Offline sync queue.

---

### [2026-06-09] #06 — Next Build Prompt absorbed (Steps 0, 1, 2, 4, 6, 5-polish)

**Prompt:**
> [attached `RoofWise_Next_Build_Prompt.md`] Continue.

Plus the canonical `.env.local` was provided via attachment with the new
Google Maps key (`AIza…YSBM` rotated → `AIza…tYU`), Gemini model pinned
at `gemini-2.5-flash`, Corrections endpoint, and feature flags.

**Drift Warning changes:**
- #11 was "MapKit on iOS, Google Maps on Android" — replaced with
  "Google Maps everywhere via `provider: PROVIDER_GOOGLE`". The unified
  `components/map/Map.tsx` is the single point that switches providers.
- The `.env.local` is provided locally and gitignored; keys never enter
  the repo. `app.json` was converted to `app.config.js` so the Google
  Maps key is read from `process.env` at build time and never committed.

**Step 0 — Maps foundation:**
- `lib/env.ts`: extended reader covers Maps base + iOS/Android/Web, Places,
  Solar, Geocoding, Weather, Corrections endpoint, NOAA user-agent, and
  feature flags (`USE_LIVE_AR`, `USE_STRUCTURED_CONFIDENCE`, `REQUIRE_AUTH`).
- `app.json` → `app.config.js` (dynamic): Google Maps key read from env at
  build time. Native bridging done via `ios.config.googleMapsApiKey` +
  `android.config.googleMaps.apiKey`.
- `components/map/Map.tsx`: unified Map + MapPin + MapPolyline + MapPolygon
  + MapCircle + MapHeatmap. `PROVIDER_GOOGLE` always set. Provider switch
  is now a one-file change.
- `lib/services/places.ts`: Google Places (New) `searchText` + place
  details client with `X-Goog-FieldMask` trimming, location bias,
  `PlacesNotConfiguredError` / `PlacesError`.
- `components/AddressAutocomplete.tsx`: debounced 250ms search, 56pt
  input, dropdown of predictions, place select captures lat/lng. Surfaces
  a friendly "key missing" hint when the key isn't configured.
- `NewJobWizard Step 1`: real address autocomplete replaces the manual
  textarea; lat/lng captured into the Inspection on save.

**Step 4 — Manual damage overlay editor (Drift #4 / spec hero):**
- `lib/stores/correctionsStore.ts`: Zustand store with pending/syncing/
  synced/failed status, capped at 1000 entries, AsyncStorage persistence.
- `components/DamageMarkerLayer.tsx`: photo + absolute-positioned markers
  rendered against the photo's aspect-fit rect. Tap empty area → drop;
  tap marker → select. Confidence bubble + severity-tinted ring.
- `app/edit-detection.tsx`: full-screen editor. Category chip selector
  (13 chips), severity selector, add/edit via marker tap, save writes
  the new markers to the slope AND records a Correction with the
  original / corrected / delta payload. Discard confirms when dirty.
- JobDetail thumbnails now route to the editor with a pencil overlay
  badge.

**Step 6 — Recursive learning loop foundation:**
- `lib/services/learning/userCorrectionProfile.ts`: rolling stats over
  the last 100 corrections per category (accuracy, under_count,
  over_count, total).
- `lib/services/learning/localLearningEngine.ts`:
  - `effectiveThreshold(category)`: per-user confidence cutoff capped
    at ±20% from a 60 baseline.
  - `userStylePromptPrefix()`: small Gemini system-prompt prefix once
    20+ corrections are recorded.
  - `overallAccuracy()`: hidden until 5+ corrections.
- `lib/services/correctionsSync.ts`: best-effort POST to the corrections
  backend; marks records syncing → synced → failed; batch size 50.
- `inspectionStore.setSlopeMarkers(...)`: updates a slope's markers and
  recounts hail / wind / wear / missing / bruising per category.
- Quick Inspection: `analyzePhoto` now prepends the user-style prefix
  derived from the corrections profile.
- Gemini service: model now read from `env.GEMINI_MODEL`
  (default `gemini-2.5-flash`).
- `components/AICalibrationCard.tsx`: appears on Home once 5+
  corrections are recorded. Tap routes to Train tab.

**Step 1 — HailTracer:**
- `Map.tsx`: added `MapHeatmap` export.
- `app/hail-tracer.tsx`: full-screen Google-Maps heatmap of the last
  24 months of NOAA storms. 7d/30d/6m/24m range chips, hail/wind/both
  toggle, ≥1"/≥1.5"/≥58mph magnitude filter. Hail rendered as a
  weighted heatmap (intensity ∝ size²). Wind + severe hail also drop
  pins; tap → detail sheet.

**Step 2 — Roof Price Estimator (Solar API):**
- `lib/services/solar.ts`: Solar `buildingInsights:findClosest` client.
  Returns total squares, per-slope orientation/pitch/azimuth, imagery
  date + quality. Clear `SolarNotConfiguredError` / `SolarNotFoundError` /
  `SolarServiceError`. `imageryIsStale()` helper.
- `lib/services/costEstimator.ts`: pure cost-range engine — per-material
  + per-region pricing × scope factor (repair/partial/full), itemized
  line items (tear-off, underlayment, shingles, flashing, ventilation,
  permits).
- `app/estimator.tsx`: 4-step wizard — Address (Places autocomplete) →
  Roof detection (Solar API call, manual fallback with stepper) →
  Damage scope → Result card with Low/Mid/High range + line-item
  breakdown.

**Step 5 polish — Haag report data flow + UI:**
- JobDetail per-slope card now shows:
  - Verdict pill (Full replace / Partial / Verify / Repair).
  - HAAG test square block: hits observed vs material threshold + rule.
  - Detected-category list with severity-coded color.
  - Decision Engine reasoning + average confidence.
- Sets us up to revise the PDF in a follow-up — the data flow into
  `decision.perSlope` is now visible in the UI so any divergence is
  obvious.

**Files touched (this entry):**
- `lib/env.ts`, `.env.local.example` — env reader + template.
- `app.json` → `app.config.js`.
- `components/map/Map.tsx`, `components/map/StormHistoryMap.native.tsx`.
- `lib/services/places.ts`, `components/AddressAutocomplete.tsx`.
- `lib/stores/correctionsStore.ts`.
- `lib/services/learning/userCorrectionProfile.ts`,
  `lib/services/learning/localLearningEngine.ts`,
  `lib/services/correctionsSync.ts`.
- `lib/stores/inspectionStore.ts` — `setSlopeMarkers`.
- `components/DamageMarkerLayer.tsx`, `app/edit-detection.tsx`.
- `components/AICalibrationCard.tsx`, `app/(tabs)/index.tsx`.
- `lib/services/solar.ts`, `lib/services/costEstimator.ts`,
  `app/estimator.tsx`.
- `app/hail-tracer.tsx`.
- `lib/services/gemini.ts` — env-driven model name.
- `app/quick-inspection.tsx` — user-style prefix threaded into analyze.
- `app/new-job.tsx` — AddressAutocomplete + lat/lng capture.
- `app/job/[id].tsx` — slope verdict pills + test-square block +
  reasoning.

**Still owed (Tier 1 from Next Build):**
- Step 3: full Capture/Analyze split with background analysis via
  expo-task-manager. Capture today still calls `analyzePhoto` directly;
  splitting it requires a `lib/services/analysisQueue.ts` + a
  per-photo persistence model. Parked as a deliberate v1 simplification —
  the existing on-demand "Analyze" CTA already gives the user control
  over when analysis fires.
- Per-photo `photoIndex` tagging on `DamageMarker` so the editor only
  shows markers from the active photo (today it shows all slope markers).
- Pinch-zoom on the editor canvas with marker anchoring preserved.

**Still owed (Tier 2 from Next Build):**
- Per-correction toast + weekly Calibration push notification.
- Proposals (Step 7 in main spec).
- Door Knocking Mode (Phase 6E).
- Service Area + Storm Watch background polling + push (Phase 6A-C).
- Mileage tracker.
- Voice commands.
- Offline sync queue + corrections backend deployment.

---

### [2026-06-09] #07 — Capture/Analyze split, Service Area + Storm Watch + Push, Door Knocking, Proposals, Toasts, Auto-polling

**Prompt:**
> Do what you think is best. Finish the job and continue building.
> Don't stop to ask question[s].

**Decisions:**
- Per-photo marker tagging is now first-class: `DamageMarker.photoIndex`,
  `replacePhotoMarkers()` mutates only one photo's markers, and the
  editor filters to the active photo. Untagged legacy markers still
  surface so existing inspections aren't broken.
- Quick Inspection refactored to capture-only (no inline Gemini). Photos
  are stored as raw URIs via `attachRawPhotos`. AI analysis moved to a
  per-slope screen `/analyze`, with onProgress, retry, "AI not connected"
  banner, and Re-analyze-all / Analyze-new CTAs.
- `lib/services/analyzeSlope.ts` reads photos from disk via expo-file-
  system, runs Gemini with the user-style prefix from the learning
  engine, attaches markers tagged with `photoIndex`, and updates findings.
- Toast queue (`lib/stores/toastStore.ts` + `components/ToastHost.tsx`)
  mounted at the root. EditDetectionView fires a calibration toast on
  every save once 5+ corrections exist.
- Service Area store + screen + Storm Watch service. Adding the first
  area triggers `requestPushPermission()` and schedules a weekly
  calibration push every Monday 9am. "Scan storms now" CTA fires the
  foreground sweep.
- Auto polling: `lib/services/lifecycleHooks.ts` re-runs Storm Watch
  every 30 min and corrections sync every 5 min on app foreground,
  wired from the root layout via `useBackgroundJobs()`.
- Push notifications via `expo-notifications` (foreground + local
  scheduled).
- Door Knocking Mode (`app/door-knocking.tsx`): live route stats
  (knocks / interested % / minutes), Google Map with color-coded knock
  pins, 5 outcome chips in the thumb zone (Interested, Inspection,
  Follow up, Not home, No interest), Wrap-route confirm with summary
  toast. Backed by `lib/stores/knockSessionStore.ts` with active session
  + archive.
- Proposals end-to-end:
  - `lib/services/proposalGenerator.ts` turns an Inspection into a draft
    via Decision Engine + Cost Estimator + Solar squares (when available).
  - `lib/stores/proposalStore.ts` keyed by jobId with status transitions.
  - `lib/services/proposalPdf.ts` renders the branded HTML proposal to
    a PDF via expo-print.
  - `app/proposal/[jobId].tsx` renders the proposal, lets the inspector
    regenerate from inspection, then "Generate PDF & share" via native
    share sheet → status flips to `sent`.
  - Job Detail has a tap card surfacing status + total.
- Settings: Service Area entry, AI-calibration corrections count + a
  "Sync now" row that fires the backend POST and shows the result via
  toast.

**Files touched (this entry):**
- `lib/models/types.ts` — `photoIndex?` on DamageMarker.
- `lib/stores/{inspectionStore,correctionsStore,serviceAreaStore,knockSessionStore,proposalStore,toastStore}.ts`.
- `lib/services/{analyzeSlope,stormWatch,pushNotifications,proposalGenerator,proposalPdf,lifecycleHooks}.ts`.
- `components/{ToastHost,DamageMarkerLayer}.tsx`.
- `app/_layout.tsx` — ToastHost + useBackgroundJobs.
- `app/quick-inspection.tsx` — capture-only refactor.
- `app/analyze.tsx`, `app/edit-detection.tsx`, `app/door-knocking.tsx`,
  `app/proposal/[jobId].tsx`, `app/settings/service-area.tsx`.
- `app/(tabs)/{settings,map}.tsx` — knock-mode pill, service-area row,
  sync row.
- `app/job/[id].tsx` — proposal card + analyze CTA + verdict pills.

**Drift Warning changes:**
- None. The 13-category damage taxonomy, HAAG thresholds, Decision
  Engine, dashboard CTAs, and Quick Inspection hero ordering are all
  intact.

**Still parked (deliberate v1 simplifications):**
- Editor pinch-zoom + marker drag (gesture handler + Reanimated worklets
  with shared transforms).
- Background analysis via `expo-task-manager` — foreground analyze is
  already on-demand, which covers most of the value.
- Apple Sign In — needs provisioning + Supabase Apple provider config.
- Mileage tracker.
- Voice command mode.
- Brittleness test field in NewJobWizard Step 3.

**Open questions / Follow-ups:**
- Rotate the Google Maps key into the 3 platform-restricted keys
  (iOS / Android / Web) per the env file's "Production hardening
  checklist" before any public TestFlight.
- Deploy a real corrections backend at
  `EXPO_PUBLIC_CORRECTIONS_ENDPOINT` — today the sync POSTs to a
  Vercel placeholder and tolerates failure gracefully.

---

### [2026-06-09] #08 — Leads, mileage, brittleness, training queue + swipe review, damage explainer

**Prompt:**
> Okay. Seems like you've stopped?

(Continuation of #07's autonomous build.)

**Decisions:**
- Knock outcomes (`interested`, `inspection_scheduled`) now auto-create
  a Lead, stamping `Knock.createdLeadId` and emitting
  `ActivityEvent(knock_converted_to_lead)`. Closes the door-knock →
  CRM loop.
- Leads tab fully wired to `leadStore` with stage chip filter, tone-
  coded stage pills, and source attribution.
- Mileage tracker: full trip log with live GPS sampling (10 m noise
  filter), purpose chips, big live odometer in active mode, recent
  trip list with IRS deductible ($0.67/mi 2026 rate). Home utility row
  surfaced alongside Hail Tracer + Estimator.
- Brittleness test field is now first-class in NewJobWizard Step 3
  (not_tested / passed / failed), and propagates to Decision Engine +
  HAAG PDF.
- Plan tab rebuilt: today / week toggle, stats row (inspections +
  knocks + active route count), today's inspection cards routing to
  Job Detail, quick-action shortcuts.
- Training queue + auto-enqueue: `analyzeSlope` enqueues any photo
  whose AI markers average confidence < 60 OR have count > 10
  (suspicious uniformity).
- Train tab tiles now read real queue + accuracy data.
- SwipeReview screen: full Tinder card stack with Reanimated +
  GestureDetector. Right=accept, left=edit, up=skip, down=not_damage.
  Every swipe also has a 88pt button equivalent (glove rule: tap
  alternative for every gesture). Accept/Not-damage write structured
  Corrections so the learning engine sees them.
- DamageExplainer screen walks the 13 HAAG categories with visual
  characteristics, what-not-to-confuse-with, and coverage notes.
  Spec-aligned content the inspector can flip through on a roof.

**Files touched (this entry):**
- `lib/stores/{leadStore,mileageStore,trainingQueueStore}.ts` — created.
- `lib/models/types.ts` — `MileageTrip` type.
- `lib/stores/inspectionStore.ts` — accept `brittlenessTest` on create.
- `lib/services/analyzeSlope.ts` — auto-enqueue low-confidence outputs.
- `app/door-knocking.tsx` — lead creation + activity event on positive
  outcomes.
- `app/mileage.tsx` — new tracker screen.
- `app/new-job.tsx` — brittleness chips on Step 3.
- `app/(tabs)/{index,leads,plan,train}.tsx` — wired to real stores,
  utility row gains Mileage, leads list rebuilt, plan rebuilt with
  real stats + quick actions.
- `app/swipe-review.tsx` — created.
- `app/damage-explainer.tsx` — created.

**Still parked:**
- Editor pinch-zoom + marker drag (worklets refactor).
- Voice input on free-text fields (requires native module beyond Expo
  Go).
- Apple Sign In (needs provisioning).
- Signature canvas (needs `react-native-signature-canvas` or similar
  dep).
- Background analyze queue via `expo-task-manager`.

**Open questions / Follow-ups:**
- Hook SwipeReview's "edit" path to a richer single-photo editor that
  takes the marker history into account (today it routes to the
  existing EditDetectionView, which is fine but generic).
- Surface "lead converted from knock" badge on the Leads list when the
  source is `door_knock`.

---

### [2026-06-09] #09 — Signatures, weather, storm auto-match, storm-alert sheet, status toggle

**Prompt (continuation of #08):**
> Okay. Seems like you've stopped?

**Decisions:**
- SignaturePad component (react-native-svg + PanResponder, no extra
  dependency) emits a serializable SVG path string. Used on both the
  Proposal (homeowner) and Job Detail (inspector) screens.
- Captured signatures embed as inline `<svg><path/></svg>` inside the
  Haag report PDF and the Proposal PDF.
- Home gains a WeatherTile that pulls current conditions for the
  user's location via Google Weather API; silently hides when the key
  or location is missing.
- New Job Wizard fires `findMatchingStorm` after save: looks for a
  qualifying NOAA storm (≥0.75" hail or ≥58 mph wind) within 5 mi and
  ±30 days, stamps `Inspection.event`, and pushes a "Storm event
  matched" toast. Closes the loop for the HAAG report's weather
  section.
- Storm Alert hero card is now tappable; routes to
  `/storm-alert/[id]` — a full sheet with kind chip, area, fired-at,
  hail/wind stats, list of saved properties in-range, Open Map +
  Start knocking route CTAs.
- Job Detail header gains a Mark complete / Complete toggle; flips
  Inspection.status and logs an ActivityEvent.

**Files touched (this entry):**
- `lib/services/{weather,stormMatch}.ts` — created.
- `lib/services/haagPdf.ts`, `lib/services/proposalPdf.ts` — inline
  signature SVGs.
- `lib/models/types.ts` — `inspectorSignatureSvg`, `homeownerSignatureSvg`.
- `lib/stores/inspectionStore.ts` — `setEvent`, `setInspectorSignature`.
- `components/{SignaturePad,WeatherTile}.tsx` — created.
- `app/(tabs)/index.tsx` — WeatherTile + tappable storm hero.
- `app/storm-alert/[id].tsx` — created.
- `app/new-job.tsx` — storm auto-match on save.
- `app/job/[id].tsx` — status toggle + inspector signature card.
- `app/proposal/[jobId].tsx` — homeowner signature card.

**Still parked (deliberate v1 simplifications):**
- Editor pinch-zoom + marker drag (Reanimated worklets refactor).
- Voice input on free-text fields (requires native module beyond Expo Go).
- Apple Sign In (needs Supabase provider config + provisioning).
- Background analyze queue via `expo-task-manager`.
- CostEstimator → New Job "Convert" flow (would need an Estimate store).
- Inspector signature on the camera flow during Quick Inspection (live
  capture before each slope).
- Mileage auto-tracking via geofencing / Bluetooth car-connect.

---

### [2026-06-09] #10 — Editor pinch-zoom + Apple Sign In

**Prompt:**
> Do both.
> (Referring to editor pinch-zoom + Apple Sign In from the #09 status report.)

**Decisions:**
- **DamageMarkerLayer** refactored from `onTouchStart/End` to
  `GestureDetector` with Reanimated worklets. Photo + marker layer share
  a single Animated.View transform so markers stay anchored when the
  user zooms.
  - Composed gesture: `Race(doubleTap, Simultaneous(pinch, pan), tap)`.
  - Single tap → reverses the current transform to compute world coords,
    hit-tests markers, falls back to onTapPhoto with normalized (0–1)
    photo coords.
  - Pinch: `MIN_SCALE = 1`, `MAX_SCALE = 4`, clamps translate so the
    photo can't slide off-screen.
  - Pan: only active when zoomed > 1.01x.
  - Double-tap toggles between 1x and 2x (focal point = tap location).
  - Spring snaps back to 1x / 0,0 when zoom returns to ≤1.
- **Apple Sign In** wired end-to-end:
  - `expo-apple-authentication` installed; `usesAppleSignIn: true` on
    `ios` config and the plugin registered in `app.config.js`.
  - `authStore.signInWithAppleIdToken(idToken, nonce?)` calls
    `supabase.auth.signInWithIdToken({ provider: 'apple', token })`.
  - `components/AppleSignInButton.tsx` is iOS-only; hides on Android
    and when `AppleAuthentication.isAvailableAsync()` returns false.
    Cancels (`ERR_REQUEST_CANCELED`) are silent; other errors toast a
    clear "Apple Sign In failed — confirm provider enabled in
    Supabase" message.
  - Welcome screen shows the button above an "or" divider for the
    sign-in and sign-up modes.

**Files touched (this entry):**
- `package.json`, `package-lock.json` — `expo-apple-authentication`.
- `app.config.js` — `usesAppleSignIn` + plugin registration.
- `components/DamageMarkerLayer.tsx` — rewritten on Reanimated +
  GestureDetector.
- `components/AppleSignInButton.tsx` — created.
- `lib/auth/authStore.ts` — `signInWithAppleIdToken`.
- `app/welcome.tsx` — Apple button + "or" divider.

**Manual configuration still required for Apple Sign In:**
- Apple Developer account → register the app's bundle ID with the
  Sign in with Apple capability.
- Create a Services ID and Apple key (`.p8`) for Supabase.
- Supabase dashboard → Auth → Providers → Apple → paste the Services
  ID + Key ID + private key. Add the bundle ID to the allowed
  client IDs.
- Once those are set, the button works on a real iOS build. Expo Go
  cannot exercise Apple Sign In (no entitlement) — use `expo run:ios`
  or EAS for live testing.

---

### [2026-06-09] #11 — Conversion flows, voice notes, list/map polish, profile, push routing

**Prompt (continuation of #10):**
> I don't know. But yes keep going.

Multiple batches of features bundled into one log entry.

**Funnels closed:**
- Lead → Inspection conversion: a one-shot `wizardPrefillStore`
  populates the NewJobWizard from a lead row; the lead flips to
  `inspection_scheduled` automatically.
- Estimator → New Job: same prefill pipe, "Convert to job" button on
  the Estimator result step.
- Storm Match card on Job Detail surfaces the auto-matched NOAA event
  (size or wind, date, distance, source, event ID).

**Hardware-aware capture:**
- VoiceNoteRecorder (expo-av) on Job Detail. 88pt record button
  switches red while recording, live duration counter, per-note
  playback with play/pause, trash to delete. Microphone permission
  handled in-component. Inspection.audioNotes added to the model.

**Lists + search:**
- All-inspections list at `/inspections` with search (name / address /
  report ID) and status chip filter (all / in progress / scheduled /
  complete / lead). Decision Engine result rendered inline.
- Activity full-screen gains filter chips (All / Jobs / AI / Knocks /
  Storms / Proposals).

**Collateral checklist** on Job Detail (6 HAAG-spec items)
persisted into `Inspection.collateralChecklist`.

**Inspector profile** (`/settings/inspector-profile`): Zustand-backed
identity, HAAG certification (toggle gates the certification number
field), years experience, emergency contact. Surfaced in Settings →
Field with HAAG-certified badge.

**Map polish:** the Map tab now renders pins for every filter — jobs
(orange) with callout routing to the job, leads (info-blue), knocks
(tone-coded by outcome). Bottom stat bar replaces the empty-state
card.

**Push routing:** root layout subscribes to
`expo-notifications.addNotificationResponseReceivedListener`. Storm
Watch push → `/storm-alert/[id]`. Weekly calibration push →
`/(tabs)/train`. Closes the loop from server-fired alert to in-app
action.

**Location-biased Places:** `lib/services/locationBias.ts` caches the
user's last-known coords; AddressAutocomplete uses it as a default
bias when callers don't pass their own. Now NewJobWizard + Estimator
surface nearby suggestions first.

**Files touched (this entry, in batches):**
- Conversion: `lib/stores/wizardPrefillStore.ts`, NewJobWizard,
  Leads tab, Estimator.
- Collateral: `lib/stores/inspectionStore.ts` (`setCollateralItem`),
  Job Detail.
- Voice notes: `expo-av` install, types.ts (`AudioNote`),
  inspectionStore (`addAudioNote` + `removeAudioNote`),
  `components/VoiceNoteRecorder.tsx`, Job Detail.
- Inspections list: `app/inspections.tsx`, Home Recent-Jobs header.
- Activity filter: `app/activity.tsx` rebuilt with chips.
- Storm match card: Job Detail.
- Inspector profile: `lib/stores/inspectorProfileStore.ts`,
  `app/settings/inspector-profile.tsx`, Settings.
- Map pins: `app/(tabs)/map.tsx` rebuilt on the unified Map component.
- Push routing: `app/_layout.tsx`.
- Location bias: `lib/services/locationBias.ts`,
  `components/AddressAutocomplete.tsx`.

**Still parked:**
- Photo quality scoring before Gemini (limited cross-platform image
  primitives without a vision lib).
- Onboarding flow for first-launch users.
- Background analyze queue via `expo-task-manager`.
- Mileage auto-tracking via geofencing / Bluetooth.
- Camera HUD overlays (compass arrow + bullseye level + slope hint).
- Photo edit (crop / rotate) before analysis.

---

### [2026-06-09] #12 — Camera HUD, onboarding, real KPIs, estimates, notes, safety check, photo previews

**Prompt:**
> Keep going.

Multiple batches of polish + spec-aligned features.

**Hero camera polish:**
- `components/CameraHUD.tsx` — heads-up overlay on Quick Inspection.
  Bullseye level driven by current roll (success/cream/orange tone),
  compass needle + heading chip with auto-detected slope orientation
  and a "matches"/"expected X" hint vs the user's selected slope,
  pitch readout in degrees and X/12 ratio, GPS elevation. Backed by
  the existing `useDeviceMotion` + `useAltitudeFeet` hooks.

**Onboarding:**
- `lib/stores/onboardingStore.ts` + `app/onboarding.tsx` — 4-slide
  swipeable intro (forensic inspection, Storm Watch, claim packets,
  recursive learning). Sticky "Next/Get started" CTA. Skip button.
  `app/index.tsx` redirects signed-in but not-yet-onboarded users to
  `/onboarding` before the tabs.

**Score visualization:**
- `components/DamageScoreBar.tsx` — filled progress bar (0–100) with
  green/cream/orange/red tone tiers + Severity pill (No damage /
  Minor / Moderate / Severe). Replaces the single-cell damage stat
  on Job Detail; stats row keeps Slopes + Photos + Claim.

**Photo edit:**
- `expo-image-manipulator` installed.
- `inspectionStore.removePhoto` drops the photo + markers and
  renumbers higher photoIndex markers down by one.
- `inspectionStore.replacePhoto` swaps the URI for a slope's photo.
- AnalyzeView long-press → action sheet: Rotate 90° (manipulator
  JPEG re-save) or Delete photo.

**Estimate persistence:**
- `lib/stores/estimateStore.ts` — persisted Zustand store, capped at
  100 entries.
- Estimator result step adds a Save button next to Convert to job.
- Home gains a "Saved estimates" horizontal carousel above the
  activity section.

**Per-inspection notes + inspector data on the HAAG PDF:**
- `Inspection.notes` field. Job Detail multiline TextInput card
  persists on every keystroke via `inspectionStore.setNotes`.
- HAAG PDF cover meta-grid now shows the inspector profile when
  filled (name + HAAG cert + cert number). New section 4b
  "Inspector notes" renders the free-form notes.

**Photo quality + real KPIs + personalized greeting:**
- `lib/services/photoQuality.ts` — coarse heuristics (dimensions +
  on-disk size). AnalyzeView calls it before run and shows a
  confirm sheet listing flags (low resolution, unusual aspect
  ratio, very small file).
- Home KPI tiles read real data: Revenue YTD = signed-proposal
  totals this year; Leads = open leads; Pipeline = sent + viewed
  proposal totals. Shorthand formatter (1.2K / 1.2M).
- Welcome header uses the inspector profile name first, falling back
  to email-derived first name.

**Recent Jobs photo previews + safety check:**
- Recent Jobs cards lead with the inspection's first captured photo
  (or a placeholder when none).
- `lib/stores/safetyStore.ts` — persisted `preFlightEnabled` +
  `lastConfirmedAt`.
- `app/safety-check.tsx` — navy hero, 6 HAAG-spec items, sticky
  "I'm safe to climb" CTA unlocks only when all pass. "Stop showing
  this before camera" link flips the flag off.
- Quick Inspection redirects to /safety-check on mount when the
  flag is on and the last confirmation is older than 4h. jobId
  passed through.
- Settings: Safety section with the toggle row.

**Files touched (this entry):**
- `components/{CameraHUD,DamageScoreBar}.tsx` — created.
- `lib/stores/{onboardingStore,estimateStore,safetyStore}.ts` — created.
- `lib/services/photoQuality.ts` — created.
- `app/{onboarding,safety-check}.tsx` — created.
- `app/index.tsx` — onboarding redirect.
- `app/quick-inspection.tsx` — HUD + safety pre-flight.
- `app/analyze.tsx` — photo long-press + photo quality pre-check.
- `app/estimator.tsx` — Save / Convert pair.
- `app/(tabs)/index.tsx` — real KPIs, inspector greeting, saved
  estimates carousel, photo-preview recent jobs cards.
- `app/(tabs)/settings.tsx` — safety toggle row.
- `app/job/[id].tsx` — Damage Score bar + notes field.
- `lib/services/haagPdf.ts` — inspector profile + notes.
- `lib/stores/inspectionStore.ts` — `setNotes`, `removePhoto`,
  `replacePhoto`.
- `lib/models/types.ts` — `SavedEstimate`, `Inspection.notes`.

**Still on the parking lot:**
- Background analyze queue via `expo-task-manager`.
- Mileage auto-tracking via geofencing / Bluetooth car-connect.
- Voice input on free-text fields (still needs a native module beyond
  Expo Go).
- Bulk inspection export (PDFs in a ZIP).

---

### [2026-06-09] #13 — Share links, Reports, Backup, About, Homeowner preview, Global search

**Prompt:** Keep going. (#11 → #12 → #13 are one autonomous arc.)

**Tokenized share links:**
- `lib/stores/proposalLinkStore.ts` mints 8-char alphanumeric tokens
  and builds `https://roofwise.app/p/<token>` URLs. `markViewed` flips
  once on first open.
- Proposal screen surfaces a Share-link card: Generate → mints; Copy
  (`expo-clipboard`); Share (native sheet); Preview as homeowner.

**Homeowner preview at `/p/[token]`:**
- Read-only proposal view. Hero photo (first inspection photo) tears
  up into a white card with total + scope + line items + terms +
  inspector card + sign-here block. SignaturePad on accept → flips
  status to `signed`. After signing, swaps to a green confirmation.
- `markViewed` records first visit so the contractor can see the
  homeowner opened it.

**Reports (`/reports`):** YTD revenue (signed proposals) + open
pipeline (sent/viewed) + avg deal, funnel (inspections / proposals
sent / signed / conversion / open leads), mileage (miles / IRS
deductible / trips), AI calibration (overall accuracy / corrections /
top-5 most-corrected categories). Linked from Settings Business
section.

**Backup & Restore (`/settings/backup`):**
- `lib/services/backup.ts` snapshots every Zustand store (inspections,
  leads, proposals, links, estimates, service areas, storm alerts,
  knock sessions, mileage, activity, corrections, training queue,
  inspector profile) into one versioned JSON blob.
- Export writes to cache, shares via native sheet (`expo-sharing`).
- Restore uses `expo-document-picker` + confirm sheet (destructive
  warning) + per-store `setState` rehydration.

**About (`/settings/about`):** brand card with `Constants.expoConfig.
version`, feature list, external reference links (HAAG / NOAA /
Google AI Studio).

**Global search (`/search`):**
- Inspection (customer / address / report ID / claim / policy), Lead
  (customer / address), Proposal (joined to the underlying job +
  status + total). Results scoped to 50.
- Header gains a search icon (alongside profile) that routes here;
  autofocus, clear-x, two-character minimum.

**Files touched (this entry):**
- `lib/stores/proposalLinkStore.ts` — created.
- `lib/services/backup.ts` — created.
- `app/p/[token].tsx` — created.
- `app/reports.tsx` — created.
- `app/search.tsx` — created.
- `app/settings/backup.tsx`, `app/settings/about.tsx` — created.
- `app/proposal/[jobId].tsx` — Share link card + Preview as homeowner.
- `app/(tabs)/settings.tsx` — Business section with Reports, Backup,
  About rows.
- `app/(tabs)/index.tsx` — search icon in header.
- `expo-document-picker`, `expo-sharing`, `expo-clipboard` installed.

**Still on the parking lot:**
- Background analyze queue via `expo-task-manager`.
- Mileage auto-tracking via geofencing / Bluetooth car-connect.
- Voice input on free-text fields.
- Cloud sync of inspections to Supabase (requires backend schema
  rollout).
- Service area boundary overlay on Map (needs geocoded centroids).

---

### [2026-06-09] #14 — Leads cloud sync, service area circles, audio transcription, FAB, new lead

**Prompt:** Continue.

**Cloud sync of leads:**
- `Lead` gains `updatedAt` + `syncStatus`. `leadStore.create`/`setStage`
  stamp pending; `pending()` selector.
- `lib/services/leadSync.ts`: 2-way last-write-wins against Supabase
  `public.leads`. Pushes via upsert, pulls 500 rows for `auth.uid()`,
  merges by `updated_at`. Detects "missing table" errors so
  unprovisioned users see a friendly nudge.
- Lifecycle hook joins the foreground rotation at a 5-min cadence
  when a session exists.
- Settings AI calibration section: row renamed to "Sync corrections";
  new "Sync leads to cloud" row with pending count + toast result.
- About screen carries the canonical `LEADS_SQL` snippet (RLS +
  index) inside a navy code block with a Copy button.

**Service area circles on Map:**
- `lib/services/geocoding.ts`: thin Google Geocoding client.
- `serviceAreaStore.setCentroid(id, lat, lng)`.
- Service Area screen geocodes the label in the background on add.
- Map tab overlays a 5-mile `MapCircle` per area with a centroid
  (faint navy fill + navy border).

**Audio transcription:**
- `lib/services/transcribeAudio.ts`: reads audio URI as base64 via
  `expo-file-system` and asks Gemini for a verbatim transcript with
  punctuation. Reuses `env.GEMINI_MODEL` and the existing error types.
- `inspectionStore.setAudioNoteLabel` stamps the transcript on the
  note.
- `VoiceNoteRecorder` gains an optional `onTranscribe` handler.
  When provided AND the note has no label, a sparkles button appears
  next to the trash. Tapping shows an inline spinner.
- Job Detail wires the handler with friendly toasts and a clean fall-
  back when Gemini isn't configured.

**Pull-to-refresh + FAB + New Lead:**
- Home gets `RefreshControl` that fires leads sync + corrections sync
  + storm watch in parallel.
- Home gets a sticky 88pt orange FAB (lower-right) that opens an
  action sheet — Quick Inspection / New Job / New Lead / Cost
  Estimate.
- `app/new-lead.tsx`: minimal lead capture modal (name + phone +
  email + AddressAutocomplete). Save writes through `leadStore.create`
  with `source='manual'`, fires `lead_created`, toasts, routes to
  Leads.

**Files touched (this entry):**
- `lib/models/types.ts` — Lead.updatedAt / syncStatus.
- `lib/stores/leadStore.ts` — upsert, pending, markSynced, setStage
  bumps pending.
- `lib/services/leadSync.ts`, `lib/services/geocoding.ts`,
  `lib/services/transcribeAudio.ts` — created.
- `lib/services/lifecycleHooks.ts` — leads sync in the rotation.
- `lib/stores/serviceAreaStore.ts` — setCentroid.
- `lib/stores/inspectionStore.ts` — setAudioNoteLabel.
- `app/settings/{about,service-area}.tsx` — SQL snippet copy, geocode
  on add.
- `app/(tabs)/{settings,map,index}.tsx` — sync row, circles, refresh
  + FAB.
- `app/job/[id].tsx` — transcribe wire-up.
- `components/VoiceNoteRecorder.tsx` — sparkles transcribe button.
- `app/new-lead.tsx` — created.

**Still on the parking lot:**
- Background analyze queue via `expo-task-manager`.
- Mileage auto-tracking via geofencing / Bluetooth car-connect.
- Voice input on free-text fields (still needs a native module).
- Cloud sync of inspections (photos make this much heavier than leads).

---

### [2026-06-09] #15 — Inspections cloud sync, persisted analysis queue, lead follow-up reminders

**Prompt:** Yes keep going.

**Note on session state:** the working container had reset to commit
915348c while origin held four newer commits (#14's work). Recovered by
fast-forwarding to `origin/claude/wonderful-franklin-HuSTl` — nothing
was lost because every batch had been pushed.

**Inspections cloud sync (the "photos make this heavier" item, scoped to
metadata):**
- `lib/stores/inspectionSyncStore.ts` — persisted dirty map
  (id → dirtiedAt) + deleted list + lastSyncAt.
- `lib/services/inspectionSync.ts` —
  - `startInspectionWatcher()` subscribes to the inspection store once
    and diffs object identity per change. Any inspection whose
    reference changed is marked dirty; removals are marked deleted.
    This avoids stamping updatedAt in all 16 store mutations. Pulled
    remote changes apply behind a guard flag so they don't re-mark
    themselves dirty.
  - `syncInspections()` pushes deletes, upserts dirty rows (full
    Inspection as a jsonb `payload` column), then pulls the latest 200
    rows and merges — remote wins unless the record is locally dirty.
    Also bumps `nextOrdinal` past the highest pulled report ID to
    reduce RW-YYYY-#### collisions across devices.
  - Photo/audio URIs inside the payload are device-local; they sync as
    data, not binaries — documented v1 behavior.
  - `INSPECTIONS_SQL` exported; About's Cloud-sync-setup block now
    copies LEADS_SQL + INSPECTIONS_SQL together.
- Settings AI-calibration section gains "Sync inspections to cloud"
  with a pending count (dirty + deleted) and toast result.
- Lifecycle rotation runs it every 5 minutes when signed in.

**Persisted analysis queue (the honest Expo Go version of "run in
background"):**
- `lib/stores/analysisQueueStore.ts` — persisted jobs with
  queued/running/done/failed status, per-slope dedup, attempts counter.
  Jobs stuck in "running" from a killed app re-queue on rehydrate.
- `lib/services/analysisQueue.ts` — `drainAnalysisQueue()` runs jobs
  serially through `analyzeSlope(onlyNew)`, retries once with backoff,
  fires a local notification on completion ("Analysis complete — S
  slope · 4 photos") or terminal failure. Guarded against concurrent
  drains; skips entirely when Gemini isn't configured.
- AnalyzeView gains a subtle "Queue for auto-run instead" action under
  the Analyze buttons — enqueues, kicks the drain, navigates back.
- `components/AnalysisQueueChip.tsx` shows on Home while jobs are
  pending (orange-edged card, live "Analyzing X slope now…" line, tap
  to drain immediately).
- Lifecycle hook drains the queue on every app-foreground, so queued
  work survives restarts and resumes the moment the app is open.

**Lead follow-up reminders:**
- `pushNotifications.scheduleFollowUpReminder()` — one-shot local
  notification at 9am on the follow-up day ("Follow up today — reach
  back out to {name}"); fires in a minute if the date is already past.
- New Lead modal gains follow-up chips (None / Tomorrow / 3 days /
  1 week). Save stamps `Lead.followUpAt` + schedules the reminder; the
  toast confirms the date.
- Plan tab gains a "Follow-ups due" card — open leads with
  followUpAt ≤ end-of-today, sorted oldest first, overdue rows flagged
  red. Taps route to the Leads tab.

**Files touched (this entry):**
- `lib/stores/{inspectionSyncStore,analysisQueueStore}.ts` — created.
- `lib/services/{inspectionSync,analysisQueue}.ts` — created.
- `lib/services/lifecycleHooks.ts` — watcher start + inspections sync
  + queue drain joined the rotation.
- `lib/services/pushNotifications.ts` — scheduleFollowUpReminder.
- `components/AnalysisQueueChip.tsx` — created.
- `app/(tabs)/{settings,index,plan}.tsx` — sync row, queue chip,
  follow-ups card.
- `app/settings/about.tsx` — combined CLOUD_SQL.
- `app/analyze.tsx` — queue action.
- `app/new-lead.tsx` — follow-up chips + scheduling.

**Still on the parking lot:**
- True background execution (`expo-task-manager` — needs a dev build).
- Mileage auto-tracking via geofencing / Bluetooth car-connect.
- Voice input on free-text fields (native module).
- Photo binary sync (Supabase Storage upload pipeline).

---

### [2026-06-09] #16 — Photos in the HAAG PDF + photo binary upload to Supabase Storage

**Prompt:** (continuation of #15's arc)

**Photos embedded in the HAAG report (spec Half-A "photo references"):**
- `generateHaagReport` now runs a prepare pass: up to 3 photos per
  slope are downscaled to 700px / 0.55 JPEG via expo-image-manipulator
  and inlined as base64 data URIs.
- Section 4 slope cards render a 3-up photo row above the findings
  table. Missing files (restored backups, other devices) are skipped
  silently.

**Photo binary sync (closes the "payload URIs are device-local" gap):**
- `Slope.photoUploads?: Record<localUri, publicUrl>` — keyed by URI so
  removePhoto's index renumbering can't corrupt it, and rotate
  (replacePhoto → new URI) naturally re-uploads.
- `inspectionStore.setPhotoUpload(...)` mutation — which also marks the
  inspection dirty via the #15 watcher, so remote URLs ride along on
  the next inspection sync to other devices.
- `lib/services/photoSync.ts`:
  - `syncInspectionPhotos()` walks all slopes, uploads photos that have
    no remote URL yet — downscaled to 1600px / 0.7 JPEG — to the
    `inspection-photos` bucket at `userId/inspectionId/slopeId/…jpg`,
    capped at 8 uploads per run so a drain never hogs the foreground.
  - Includes a dependency-free base64 → bytes decoder (no atob).
  - Detects missing-bucket errors → "run the SQL snippet in About".
  - `PHOTOS_SQL` creates the bucket + RLS (owner-insert by first path
    segment = auth.uid(), public read).
- Lifecycle: photo sync chains after each inspections sync.
- Settings: "Upload photos to cloud" row with live pending count.
- About: CLOUD_SQL = leads + inspections + photos in one Copy button.

**Files touched:** `lib/services/{haagPdf,photoSync,lifecycleHooks}.ts`,
`lib/stores/inspectionStore.ts`, `lib/models/types.ts`,
`app/(tabs)/settings.tsx`, `app/settings/about.tsx`.

**Still parked:** true background execution (dev build), mileage
auto-tracking, voice input on free text, signed URLs / private bucket
hardening for photos.

---

### [2026-06-09] #17 — Lead detail screen with contact actions

**Prompt:** (continuation)

- `leadStore.setFollowUp(id, iso | undefined)` — stamps updatedAt +
  pending so the change syncs.
- `app/lead/[id].tsx`:
  - Contact action row — Call / Text / Email / Directions. Call and
    Text deep-link via tel:/sms: and auto-bump a `new` lead to
    `contacted`. Directions opens Apple Maps / geo: with a Google Maps
    web fallback. Buttons grey out when the lead has no phone/email.
  - Full stage chip selector (all 7 stages; Lost renders red).
  - Follow-up section: shows the scheduled date banner; Clear /
    Tomorrow / 3 days / 1 week chips reschedule the local reminder.
  - Convert to inspection (prefill pipe) + Delete with confirm.
- Leads list cards now open the detail screen (convert button still
  works inline); Plan's "Follow-ups due" rows route to the lead
  instead of the list.

**Files touched:** `lib/stores/leadStore.ts`, `app/lead/[id].tsx`
(created), `app/(tabs)/{leads,plan}.tsx`.

---

### [2026-06-09] #18 — Visual polish pass

**Prompt:**
> Make the app look better.

(Another container reset to 915348c at turn start — fast-forwarded to
origin b6e13cf before working; nothing lost.)

**Decisions:**
- `components/PressableScale.tsx` — reusable spring-press wrapper
  (Reanimated, scale 0.97 in / bouncy spring out per the spec's motion
  tokens). Applied to the storm hero, hero CTAs, field-tool tiles,
  recent-job cards, estimate cards, and the FAB.
- **Home rebuilt visually** (all behavior preserved — refresh, FAB,
  quick-add sheet, debug storm inject, queue chip):
  - Navy gradient hero header card: greeting + name in cream,
    translucent icon buttons, and the three KPIs inside a frosted
    band with dividers (orange numbers).
  - Quick Inspection CTA is now an orange gradient card with an icon
    chip; New Job mirrors it in white + navy. Both 150pt with press
    springs.
  - Field tools row became vertical icon-chip tiles.
  - Section titles get a 4pt orange tick bar.
  - Pipeline chips underline orange when non-zero; zeros render muted.
  - Empty states show the icon inside a soft-orange circle.
  - Activity rows get tinted icon circles.
  - Estimate cards get an orange top border.
  - Top-level sections stagger in with FadeInDown (60ms per index).
- **Floating navy tab bar**: rounded-pill navy bar with margin instead
  of the full-width white strip. Active tab = filled icon variant +
  orange tint + soft orange pill behind it; selection haptic on tap.
  Tabs layout now pads the bottom safe-area edge.
- **Welcome screen** moved from the orange gradient to the brand navy
  gradient; logo mark is now solid orange, primary button orange pill.
  Light status bar on Welcome + Onboarding (navy backgrounds).

**Files touched:** `components/PressableScale.tsx` (new),
`components/shell/BottomTabs.tsx`, `app/(tabs)/{index,_layout}.tsx`,
`app/{welcome,onboarding}.tsx`.

**Deliberately untouched:** per-screen headers on Leads/Plan/Train
(consistent but plain — candidate for a shared ScreenHeader later),
detail screens (Job/Lead) — they inherit the token changes.

---

### [2026-06-09] #19 — Shared ScreenHeader on Leads / Plan / Train

**Prompt:** Yes (extend the polish pass).

- `components/ScreenHeader.tsx` — unified header: orange tick accent +
  titleLg navy title + optional subtitle, optional back chevron in a
  white circle, right-slot for actions. Tab screens use it without
  back; detail screens can pass `back`.
- Leads: header replaced; the + button now routes to /new-lead (was
  /new-job — a lead list should mint leads) and is a PressableScale.
  Lead cards also press-spring.
- Plan + Train: headers replaced and lifted OUT of the padded
  ScrollViews (ScreenHeader carries its own padding) — root View →
  ScreenHeader → ScrollView.

**Next:** same treatment on Job / Lead / Proposal detail screens.

### [2026-06-12] #20 — CLAUDE.md fast-path onboarding file

**Prompt:**
> generate an updated: generate a CLAUDE.md

**Intent / Goal:**
- Add a top-level `CLAUDE.md` so any Claude Code (or other agent) session opening this repo gets fast onboarding without re-deriving stack, IA, drift warnings, secrets policy, and branch policy from scratch.
- Keep it short. Defer to the canonical sources (`PROMPT_LOG.md`, `docs/SPEC.md`, `CONTRIBUTING.md`) rather than duplicating them.

**Decisions:**
- File is the *short* contract; `CONTRIBUTING.md` + `PROMPT_LOG.md` remain the *long* contracts. If they disagree, the log wins.
- Captured the 13 Drift Warnings in short form (canonical list stays in `PROMPT_LOG.md`).
- Documented branch policy (`claude/wonderful-franklin-HuSTl` only), secrets policy (no hardcoded keys; `app.config.js` reads `process.env`; service-role key is server-only), and the `npx expo install` vs plain `npm install` rule for native modules (root cause of the AsyncStorage crash in entry #?).
- Listed parked items (Apple Sign In needs dev build, no LiDAR/ARKit, no background execution in Expo Go) so a future agent doesn't quietly resurrect them.

**Files touched:**
- `CLAUDE.md` — new.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- Refresh the Context Summary on the next change (this is past the 5-entry threshold since the 2026-06-09 refresh).

---

### [2026-06-12] #21 — Photo library upload in Quick Inspection

**Prompt:**
> the camera function should allow uploads. it should also actually use gemini to analyze shingle type, and damge type.

**Intent / Goal:**
- Add an upload-from-photo-library path to the Quick Inspection screen so the inspector can pull in existing photos, not just live-capture. Critical for testing the Gemini pipeline without being on a roof.
- Confirmed the Gemini pipeline is already wired end-to-end (`lib/services/gemini.ts` → `analyzePhoto`) against the canonical taxonomies (16 shingle types incl. "unknown", 13 damage categories). Gemini key is empty in `.env.local`, so analysis throws `GeminiNotConfiguredError` until the user pastes a key from https://aistudio.google.com/apikey.

**Decisions:**
- Used `expo-image-picker` (already in the SDK-51 install list per CLAUDE.md). `requestMediaLibraryPermissionsAsync` first, then `launchImageLibraryAsync` with `allowsMultipleSelection: true`, `selectionLimit: 12`, `quality: 0.7` (matches the live-capture quality).
- New `images-outline` icon button in the top-right group alongside the existing pitch-gauge button. Grouped under a `topRightGroup` row so the existing `space-between` layout in `topRow` still works with the centered photo-count pill.
- Uploaded photos inherit the currently-selected slope chip, same as live captures — so the same downstream wiring (`attachRawPhotos`, slope-conditioned analysis) applies.
- Did NOT change `gemini.ts` — taxonomies are already correct.

**Files touched:**
- `app/quick-inspection.tsx` — `ImagePicker` import, `pickFromLibrary` handler, new top-right button + `topRightGroup` style.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- User must paste a Gemini key into `EXPO_PUBLIC_GEMINI_API_KEY` in `.env.local` and restart Metro with `--clear` before AI analysis works.
- Context Summary refresh is now 2 entries overdue (last refreshed 2026-06-09 after #03; we're at #21). Refresh on the next change.

---

### [2026-06-12] #22 — Standalone Quick Inspection (no job required)

**Prompt:**
> you need to fix the app so that the camera and uploaded photos can be saved and dont have to be linked to a new job

**Intent / Goal:**
- Remove the hard requirement that Quick Inspection be launched from inside an existing Job. Previously, capturing/uploading from the Home shortcut hit a dead end ("Not linked to a job" alert) and the photos were discarded.
- Photos captured or uploaded standalone must be saved, never lost, and must flow into the same Analyze pipeline.

**Decisions:**
- On `finish()` with no `jobId`, auto-create a lightweight inspection via `inspectionStore.create` with placeholder defaults the inspector can edit later on the Job screen: customerName `Quick inspection`, address `Address pending`, material `architectural_asphalt` (most common modern covering), geometry `gable`, condition `good`, age 0. Then attach photos and navigate to that job's detail.
- Kept the existing path intact when `jobId` IS present (launched from a Job).
- Logs a `job_created` activity for the auto-created inspection so it shows in the activity feed, same as the wizard path.
- Did NOT touch the 4-step New Job wizard — user reported it "flips to a new page," which is the expected Step 1→2→3→4 advance on Next, not a bug. Standalone capture means the wizard is no longer on the critical path for testing AI.

**Files touched:**
- `app/quick-inspection.tsx` — `finish()` auto-creates an inspection when unlinked; added `create` selector.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- Consider an inline "edit details" affordance on the auto-created Quick inspection so the placeholder customer/address can be corrected without the full wizard.
- Context Summary refresh now 3 entries overdue (last 2026-06-09 after #03; now at #22).

---

### [2026-06-12] #23 — Fix Expo Go OOM crash on photo selection; downscale all photos

**Prompt:**
> when i go to quick inspection and select photos from my apple photo album, expo go crashes and the app closes

**Intent / Goal:**
- Stop Expo Go from being killed by iOS when selecting library photos. Root cause: `launchImageLibraryAsync` with `quality: 0.7` + `allowsMultipleSelection` forces a full-resolution re-encode of every selected HEIC asset in memory simultaneously → out-of-memory → native crash (app closes, no JS redbox).

**Decisions:**
- Removed `quality` from the picker call so the native picker returns original asset URIs without an in-memory re-encode pass. Lowered `selectionLimit` 12 → 10.
- Added a `downscale()` helper (expo-image-manipulator, already a dependency) that resizes to max 1600px width + JPEG compress 0.7. Applied to BOTH camera captures and each picked library asset, processed sequentially in a `for` loop so only one image is in memory at a time.
- Bonus: smaller stored images mean smaller base64 payloads to Gemini (`analyzeSlope` reads each file as base64), so analysis is faster and avoids request-size limits.
- `downscale` falls back to the original URI on failure so a photo is never silently dropped.
- Also flagged to the user: there are TWO project clones + two Metro instances on their Mac (`~/Documents/RoofWiseClaude` new vs `~/RoofWiseClaude` old on port 8081) — source of "which code is running" confusion.

**Files touched:**
- `app/quick-inspection.tsx` — `ImageManipulator` import, `downscale()` helper, capture + pickFromLibrary downscale each photo, dropped `quality` from picker.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- If the crash persists after this, capture is likely iCloud-photo download or a deeper native issue — would need the device crash log.
- Context Summary refresh now 4 entries overdue.

---

### [2026-06-12] #24 — Fix SIGABRT picking iCloud album photos (preferredAssetRepresentationMode)

**Prompt:**
> nope the app shut down when i selected photos from my apple photo album and pressed the blue checkmark. please fix this. [attached full Expo Go crash report: SIGABRT, Thread 19, NSItemProvider-callback-queue]

**Intent / Goal:**
- After #23's OOM fix, picking photos that live in the Apple Photos album (iCloud-backed) still hard-killed Expo Go with no JS error. Make library upload reliable for iCloud assets.

**Decisions:**
- Crash-report diagnosis: the abort is a native C++ exception thrown in expo-modules-core `callPromiseSetupWithBlock`, reached from `ImagePickerModule.didPickMultipleMedia` → `MediaHandler.handleImage` → PhotosUI `loadDataRepresentationForTypeIdentifier`. iOS fails to produce a JPEG representation of iCloud/HEIC assets ("Cannot load representation of type public.jpeg"); when more than one selected asset fails, the native module settles its promise twice and the second rejection throws an uncatchable exception → SIGABRT.
- An interim attempt (commit 2ca7a20) added `quality: 0.3` to force iCloud download — wrong call: `quality` is exactly what forces the failing native JPEG transcode, so it reproduced the crash. Reverted in the same file.
- Real fix: `preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current` — the documented PHPicker remedy for this error. The picker hands back each photo's original file with no native conversion. JS-side `downscale()` (#23) then converts each to ≤1600px JPEG sequentially, where failures are catchable per-photo instead of fatal.
- Kept `selectionLimit: 5` (was 10) to bound concurrent NSItemProvider loads.
- Standing rule reaffirmed: never pass `quality` to `launchImageLibraryAsync` in Expo Go — it triggers both the OOM (#23) and the double-reject abort (#24) failure modes.

**Files touched:**
- `app/quick-inspection.tsx` — picker options: removed `quality: 0.3`, added `preferredAssetRepresentationMode: Current`, rewrote the rationale comment.
- `PROMPT_LOG.md` — this entry + Context Summary refreshed (rule 3; was 5 entries overdue).

**Follow-ups:**
- `Current` mode can return HEIC originals; expo-image-manipulator converts them to JPEG. If a format ever fails conversion, `downscale()` falls back to the original URI — Gemini analysis of that photo may then fail, but it's caught per-photo in `analyzeSlope` (counted as `failed`), not fatal.
- The double-reject crash is an Expo Go native bug; a custom dev build with a patched expo-image-picker would remove the constraint entirely.

---

### [2026-06-12] #25 — Force single-selection picker to dodge expo-image-picker's double-reject bug

**Prompt:**
> nope the app crashed again

**Intent / Goal:**
- After #24's `preferredAssetRepresentationMode: Current` fix, Expo Go still hard-killed when picking iCloud-album photos. Make library upload genuinely uncrashable, even at the cost of UX taps.

**Decisions:**
- Root-caused the SIGABRT by reading `node_modules/expo-image-picker/ios/MediaHandler.swift`. `handleMultipleMedia`'s per-asset failure branch is `return completion(.failure(exception))` — it fires the JS-bridge completion on every failure, never short-circuits the remaining loads, and never debounces. Two failures → `promise.reject(error)` is invoked twice in `ImagePickerModule.swift:225` → uncatchable Obj-C++ exception in `expo::callPromiseSetupWithBlock` → SIGABRT. This matches the crash report stack frame-for-frame.
- `preferredAssetRepresentationMode: Current` reduces the failure rate but does not fix the underlying double-reject bug. As long as multi-select is on AND ≥2 assets fail to load, the process dies.
- Switched to `allowsMultipleSelection: false`. That routes the picker to `didPickMedia` → `handleMedia`, which only ever calls completion once. Removed `selectionLimit` (irrelevant when multi-select is off). The picker now returns at most one asset per invocation; the user taps the library button again to add another.
- Kept `preferredAssetRepresentationMode: Current` belt-and-suspenders for the iCloud "Cannot load representation of type public.jpeg" path on single picks.
- Updated the button's accessibility label to "Add a photo from library (tap again for more)" so the new flow is discoverable.

**Files touched:**
- `app/quick-inspection.tsx` — `pickFromLibrary` switched to single selection; library button accessibility label updated.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- If/when we ship a custom dev build, we can either patch `expo-image-picker` (debounce the multi-select completion call in `handleMultipleMedia` after first failure) or use the PHPicker directly via a small Swift module — then re-enable batch selection. Filed mentally as a v2 polish, not a blocker.
- This is the third photo-picker crash mitigation in one day; the underlying lesson is that **Expo Go's bundled native modules are not patchable from JS, and any native double-resolve bug WILL be fatal until we leave Expo Go**.

---

### [2026-06-12] #26 — Fix HEIC read failure on library upload (Compatible representation mode)

**Prompt:**
> the camera upload photo from album still fails see attached error. clean up the code and fix the bug
> [screenshot: "Upload failed / Failed to read picked image → Caused by: Cannot load representation of type public.heic"]

**Intent / Goal:**
- #25 stopped the SIGABRT (single-selection), turning the fatal crash into a catchable "Upload failed" alert. But the picked photo still couldn't be read. Make the read actually succeed.

**Decisions:**
- Read `MediaHandler.swift:126`: Expo reads the asset via `itemProvider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier)`. With `preferredAssetRepresentationMode: Current` (set in #24), iOS hands back the **original HEIC bytes**; the simulator (and not-yet-downloaded iCloud photos) can't materialize them → `FailedToReadImageException` caused by "Cannot load representation of type public.heic".
- Switched `Current` → `Compatible`. That makes iOS transcode HEIC → JPEG on its own side before handing the data over; iOS's image pipeline can decode the HEIC even when passing raw HEIC to a third party fails. This is the documented fix for that exact error string. Single-selection (#25) means the one-photo transcode has no OOM risk.
- Cleaned up `pickFromLibrary`: trimmed the multi-paragraph archaeology comment down to two focused notes (why single-select, why Compatible). No behavior change beyond the representation-mode swap.

**Files touched:**
- `app/quick-inspection.tsx` — `preferredAssetRepresentationMode: Compatible`; comment cleanup in `pickFromLibrary`.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- Full picker crash/read saga is now four entries (#23 OOM → #24 Current mode → #25 single-select/SIGABRT → #26 Compatible). The clean end state: single-select + Compatible + JS-side downscale. Batch upload returns only with a custom dev build that can patch expo-image-picker's double-reject.

---

### [2026-06-12] #27 — Actionable photo-read error + jump straight to Gemini analysis

**Prompt:**
> i am getting the same error mesage. i need you to redo the code that takes a photo and analyzes the photo for damage using the gemini

**Intent / Goal:**
- After #26 the library upload still failed on the simulator with "Cannot load representation of type public.heic". Make the failure understandable, and make the capture→analyze→Gemini loop a single continuous flow so it's testable the moment a readable photo exists.

**Decisions / root cause (confirmed from native source):**
- `ImagePickerModule.swift:94` routes every photo-library pick to `launchMultiSelectPicker` (PHPickerViewController) unless `allowsEditing == true`. PHPicker reads via `MediaHandler.swift:126` `loadDataRepresentation(forTypeIdentifier: UTType.image.identifier)`. The iOS **Simulator's** stock photos are HEIC placeholders that can't be materialized this way, so the read throws regardless of `preferredAssetRepresentationMode` (Current OR Compatible). This is an Apple Simulator limitation, not app code — the same code reads fine on a real device and for fully-downloaded iCloud photos.
- The only picker path that avoids it is the legacy `UIImagePickerController`, reachable solely via `allowsEditing: true`, which forces a square crop — unacceptable for roof photos (corner/edge damage lives at the margins). So we do NOT force editing. Kept PHPicker + `Compatible` + single-select (the production-correct combination).
- Verified `lib/services/gemini.ts` is correct and complete (Gemini 2.5 Flash, base64 inlineData, strict-JSON schema, 13-category normalize). No change needed — the AI half of the loop was never the problem.
- Changes made instead:
  1. The `pickFromLibrary` catch now detects read failures (`/load representation|failed to read/i`) and shows an actionable message naming the simulator/iCloud cause and the fixes (screenshot test image, different photo, real device) instead of the cryptic native string.
  2. `finish()` now navigates straight to `/analyze` for the slope that just received photos (was `/job/[id]`), making capture→analyze one continuous flow. Falls back to the job screen if no slope has photos.
  3. Updated the capture hint to "Capture or upload, then tap Done to run AI damage analysis."

**Files touched:**
- `app/quick-inspection.tsx` — actionable read-failure alert; `finish()` routes to `/analyze`; hint text.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- Immediate simulator unblock for the user (no code): take a screenshot in the simulator (Device ▸ Trigger Screenshot, saved as PNG) and pick THAT — PNGs read fine through PHPicker. Or drag a JPEG onto the simulator. Or run on a real iPhone via the Expo Go QR.
- Batch upload + guaranteed simulator HEIC read both require leaving Expo Go for a custom dev build (patch expo-image-picker or use PHPicker directly). v2.

---

### [2026-06-12] #28 — Don't request PROVIDER_GOOGLE in Expo Go on iOS (AirGoogleMaps redbox)

**Prompt:**
> [screenshot of redbox: "react-native-maps: AirGoogleMaps dir must be added to your xCode project to support GoogleMaps on iOS. Component Stack:" ... ExceptionsManager.js:11:14 ... decorateMapComponent.js:25:18]
> this is the error message i am getting when the app tries to analyze damage on a shingle/roof photo.

**Intent / Goal:**
- Diagnosis: the redbox is NOT the analyze pipeline failing. It's `components/map/Map.tsx` hardcoding `provider={PROVIDER_GOOGLE}`. Expo Go's iOS shell does not bundle the AirGoogleMaps SDK, so any mount of MapView with PROVIDER_GOOGLE throws. The Map tab is one of the 5 tab roots and gets pre-mounted by the tab navigator, so the redbox can surface during any later navigation (including the analyze flow).
- Make the app run cleanly in Expo Go on iOS without removing Google Maps for the production build.

**Decisions:**
- `Map.tsx` now picks the provider at module load: `PROVIDER_DEFAULT` (Apple Maps / MapKit) when running in Expo Go on iOS; `PROVIDER_GOOGLE` everywhere else (Android always uses Google natively; iOS custom dev builds will bundle AirGoogleMaps via the `react-native-maps` config plugin and get Google there too).
- Detection: `Constants.executionEnvironment === ExecutionEnvironment.StoreClient` from `expo-constants` — the documented way to detect Expo Go vs a dev/standalone build. Combined with `Platform.OS === 'ios'`.
- Single-file change as documented in the `Map.tsx` header — every feature screen (HailTracer, DoorKnocking, Leads, Jobs, JobDetail, Map tab) is fixed by this one edit.
- Did NOT add a runtime warning or a "Google Maps requires a dev build" banner: it would be noise for the contractor's eventual production app where Google IS available, and the silent MapKit fallback is functionally fine for testing every feature in Expo Go.

**Files touched:**
- `components/map/Map.tsx` — provider chosen via `expo-constants` + `Platform.OS`.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- For Apple-Maps-vs-Google-Maps parity testing of features that lean on Google-specific styling (e.g. hybrid imagery for roof outlines), the user must build a custom dev client. Add to "Known parked items" in `CLAUDE.md` next time we touch that file.

---

### [2026-06-12] #29 — Upgrade Gemini default to gemini-2.5-pro (with drift-warning surfacing)

**Prompt:**
> please use gemini 3.5 flash instead of the current version.

**Intent / Goal:**
- User asked for "gemini 3.5 flash". Per CLAUDE.md Drift Warning #9 and `docs/SPEC.md` (line 26, 464), there is no `gemini-3-flash` or `gemini-3.5-flash` at the Google Generative Language API. Verified Flash variants: 1.5, 2.0, 2.5. Surface the drift, present real options, then apply the choice.

**Decisions:**
- Surfaced the drift with `AskUserQuestion`. Offered: keep 2.5-flash; upgrade to 2.5-pro; switch to 3-pro (newest, no Flash variant). User chose **gemini-2.5-pro**.
- Updated the three model-ID touchpoints:
  - `lib/env.ts:27` — fallback default `gemini-2.5-flash` → `gemini-2.5-pro`.
  - `.env.local.example:14` — template likewise.
  - User's own `.env.local` on the Mac: must manually update `EXPO_PUBLIC_GEMINI_MODEL=gemini-2.5-pro` and restart Metro with `--clear`. (We don't ship `.env.local` — it's gitignored.)
- Refreshed CLAUDE.md (the AI vision stack line + Drift Warning #9 short form) so future sessions see "2.5 Pro" as the canonical default and the warning now blocks both `gemini-3-flash` AND `gemini-3.5-flash` names.
- Did NOT touch `docs/SPEC.md` — spec language ("`gemini-2.5-flash` model") is descriptive of the prior default; rather than rewrite the spec, the runtime override (`.env.local`) + CLAUDE.md update express the active choice. If we want SPEC.md to be the canonical record of the deployed model, that's a separate spec edit decision.
- `lib/services/transcribeAudio.ts:42` and `lib/services/gemini.ts:136` both read `env.GEMINI_MODEL` — no code change needed; they automatically pick up the new default.

**Files touched:**
- `lib/env.ts` — default model.
- `.env.local.example` — template default.
- `CLAUDE.md` — AI vision line + Drift Warning #9 short form.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- Cost change: 2.5-pro is roughly 5× per call vs 2.5-flash and ~2× slower. For batch slope analysis (a slope can be 8–20 photos) this is material. If billing becomes a concern, override back via `EXPO_PUBLIC_GEMINI_MODEL=gemini-2.5-flash` in `.env.local` without any code change.
- Decide whether `docs/SPEC.md` should be edited to reflect 2.5-pro as the deployed default, or whether the spec stays generation-agnostic and only CLAUDE.md/.env track the active choice.

---

### [2026-06-16] #30 — Defer native MapView mount until host screen is focused (AIRMapManager SIGSEGV)

**Prompt:**
> it cant analyze and when any button is press, the app shuts down expo: [crash report attached]
> EXC_BAD_ACCESS at 0x10, Thread 0:
>   -[AIRMapManager mapViewWillStartRenderingMap:] + 64
>   -[MKMapView mapLayerDidChangeSceneState:withState:] + 408

**Intent / Goal:**
- User reports "any button press" shuts down Expo. Crash report shows the actual fault is in react-native-maps' AIRMapManager delegate callback firing while the JS-side manager has a stale reference. This happens during app init / tab pre-mount, not when the user touches the Map tab. So the Map tab is killing whatever foreground screen the user is on.

**Decisions / root cause:**
- The Map tab (`app/(tabs)/map.tsx`) is one of the 5 tab roots. React Navigation pre-mounts tab routes so the screens are ready when the user swipes/taps to them. On iOS Simulator with `PROVIDER_DEFAULT` (Apple Maps, the fallback we set in #28 because Expo Go has no Google SDK), MKMapView fires `mapViewWillStartRenderingMap` into AIRMapManager almost immediately on init. AIRMapManager dereferences a not-yet-fully-attached pointer → KERN_INVALID_ADDRESS at 0x10 → SIGSEGV → the whole process dies, taking the analyze screen (or whatever was foreground) with it.
- This is a well-known react-native-maps + iOS Simulator bug. It's also reproducible in tabbed Expo apps on real devices when the Map tab is pre-mounted.
- Three call sites import the unified `Map` component: `app/(tabs)/map.tsx`, `app/door-knocking.tsx`, `app/hail-tracer.tsx`. Patching at the source = one edit fixes all three.
- Added a `useIsFocused()` gate inside `components/map/Map.tsx`. The native `<MapView>` only renders when its host screen is focused. When the Map tab is pre-mounted but the user is on Home/etc., the placeholder View renders instead — the crashy native delegate never fires.
- This is also the right long-term behavior: the native map is memory-heavy, and not mounting it on pre-mounted tab routes saves RAM. Re-mount on focus is sub-second and fine UX-wise.

**Files touched:**
- `components/map/Map.tsx` — `useIsFocused` gate on the native `<MapView>`.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- Tracks the same fundamental issue as #28 (Google provider) and #23–26 (image picker): Expo Go's bundled native modules have brittle iOS Simulator behavior we can't patch from JS. Custom dev build resolves these — re-evaluate once the user is ready to leave Expo Go.
- If the Map tab is the active tab on first launch (cold boot), the gate doesn't help — the focus event fires basically simultaneously with mount. Hasn't been reported, but if it crashes on cold-boot to the Map tab, we'd need to add a brief `useEffect`-based delay or a "Tap to load map" placeholder.

---

### [2026-06-16] #31 — Stop Gemini damage-marker grid hallucinations (prompt rewrite + post-filter)

**Prompt:**
> [screenshot of /edit-detection: shingles photo with 19 hail-hits markers at 90–95% confidence stair-stepped down the shingle joints in a clearly artificial vertical grid pattern]
> i dont like the way that this is populating. this isnt accurately spotting the hail damage its just a generic line of damage. i need you to think and ensure the damage overlay actually only goes over where deamge is found.

**Intent / Goal:**
- The model was hallucinating spatial coordinates: many high-confidence markers (90–95%) placed in evenly-spaced vertical columns tracing the architectural shingle's shadow joints, not the actual roof damage. Make markers correspond to real damage at real pixel locations, with zero markers being a valid common answer.

**Decisions / root cause:**
- LLMs are weak at producing precise normalized image coordinates from freeform JSON. Gemini in particular drifts into "grid bias": rounded numbers (.1, .2, .3...), evenly-spaced sequences, alignment to image structure (shingle joints, edges, courses). The previous prompt asked the model to "mark each visible damage instance individually" — under that instruction the model pattern-matches on the shingle layout instead of the actual damage and produces a stair-step grid.
- Two-layer fix: tighten the prompt to forbid the failure mode; backstop with a client-side filter that rejects suspicious spatial outputs even when the prompt fails.

**Files touched:**
- `lib/services/gemini.ts`
  - **SYSTEM_PROMPT rewrite.** Demands a unique pixel-level observation in each marker's `note` field ("what color/shape/texture at THIS pixel"). Explicitly forbids: evenly-spaced grids, alignment to shingle edges/joints/tabs, stacking markers vertically/horizontally at the same coordinate, round-number coordinates. States that zero markers is the most common correct answer and >6 is almost certainly a hallucination. Adds an explicit "shingle features are NOT damage" callout for architectural asphalt shadow bands. Raises the confidence-floor below which the model must not emit a marker (50 → 50 with stricter rubric).
  - **Lower temperature** 0.2 → 0.1. Spatial coordinate generation is the failure-prone path; high determinism dampens grid drift.
  - **`sanitizeMarkers()` post-filter** in `normalize()`. Four-stage:
    1. Drop markers below 60% confidence (hard client floor).
    2. **`isGridHallucination()` reject**: if ≥3 markers cluster on the same x column or y row within ±3% tolerance, OR ≥50% of markers land on round (.0/.1/.2/.5) coordinates, throw out the WHOLE batch and emit zero markers — better than misleading the inspector.
    3. **`dedupNearbyMarkers()`**: collapse same-category markers within ±4% spatial distance, keeping the highest-confidence one.
    4. Cap at 6 markers per photo, ranked by confidence.
- `PROMPT_LOG.md` — this entry.

**Trade-offs noted:**
- The grid-reject heuristic will occasionally false-positive on a genuinely close-cluster of real impacts (a tight hail concentration). The product tradeoff favors zero markers over fake markers on inspector trust grounds. If we see real false-reject, we can relax the cluster threshold.
- The 6-marker cap is conservative. Real severe-storm photos can show >6 distinct impacts; for those we'd rely on the second photo or an inspector adding markers manually in /edit-detection (already supported).
- For long-term spatial accuracy, Gemini's native bounding-box detection mode (`return bounding boxes [ymin, xmin, ymax, xmax] normalized 0–1000`) outperforms freeform coordinate JSON. That's a deeper rewrite parked for a later iteration.

**Follow-ups:**
- Tell the user to re-analyze the existing slope (Analyze → Re-analyze all) after pulling — the photos already in the store won't be re-evaluated automatically.
- Consider adding an inspector-visible "AI flagged this batch as low-confidence / suspicious pattern" toast when `sanitizeMarkers` rejects everything, so the user knows the AI ran but produced nothing trustworthy (currently it'd look indistinguishable from a clean roof).

---

### [2026-06-16] #32 — Switch Gemini damage detection to native bounding-box mode

**Prompt:**
> is claude better at analyzing damaged shingles and overlaying the correct damage?
> [follow-up] yes. please futher explain. and why wouldnt you automatically come to this solution yourself withoiut me asking?

**Intent / Goal:**
- Solve the actual root cause of the grid-hallucination problem (entry #31) by changing the request shape to the format Gemini was specifically trained on for spatial grounding. Prompt-tightening + post-filter (#31) was a backstop; this is the real fix.

**Self-critique (the second user question):**
- Bbox mode was listed as a "follow-up parked for a later iteration" in #31. That was the wrong call — I picked the smaller change because the user had been through a lot of crash-debugging that day and I wanted a fast ship. Spatial accuracy IS the product for the overlay; should have surfaced both options explicitly in #31 and let the user choose. Going forward: when a problem has a known-better architectural fix, propose it alongside the patch — not buried as a follow-up.

**Decisions:**
- Restructured the Gemini request to use the documented native bounding-box detection format. The model now returns `detections: [{ box_2d: [ymin, xmin, ymax, xmax], label, severity, confidence, note }]` on the 0–1000 integer scale. This is the data path Gemini's vision training reinforces for object localization; freeform decimal (x,y) coords aren't.
- The integer 0–1000 scale also defeats the rounded-number bias (the model can't lazy-default to .1/.2/.3 anymore — it has to commit to "437" vs "438").
- Kept the existing `DamageMarker` (center + radius) data model and the overlay renderer unchanged. `normalize()` converts each box to `(x = center, y = center, radius = max(width,height)/2)` so the whole detection fits inside the rendered circle. Trade-off: we lose the rectangle shape information; circles still convey "damage here" but a future overlay rewrite to draw real rectangles would be more faithful.
- Kept `damage_markers` as a fallback parse path so an in-flight stale response or a model regression doesn't drop the data on the floor. If the new `detections` field is populated we use it; otherwise fall back to legacy.
- `sanitizeMarkers()` (#31) still runs over the bbox-derived markers. Less likely to fire on bbox output (the integer scale + native training kill most grid patterns), but it's harmless and remains a belt-and-suspenders for any remaining hallucinations.
- Strengthened the user-message text alongside the system prompt — bbox mode performs noticeably better when the user message also frames the task as detection with bounding boxes.

**Files touched:**
- `lib/services/gemini.ts` — system prompt schema swap (damage_markers → detections with box_2d on 0–1000); user message rewrite; new `bboxFrom()` validator + `bboxToCircle()` converter; `normalize()` now reads `detections` first and falls back to `damage_markers` only if missing.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- Render detections as actual rectangles (or oriented to the bbox aspect ratio) instead of converting to circles. Requires a `DamageMarker` model addition (`width, height` or `bbox`) and a `DamageMarkerLayer` update. Defer until we see how the bbox accuracy compares.
- A/B Claude vision as a second provider remains the parked follow-up if bbox results are still unsatisfactory.
- Re-analyze: the user must run "Re-analyze all" on existing slopes — old markers won't auto-replace.

---

### [2026-06-16] #33 — Re-calibrate damage detection: stop under-detecting, cover all 13 categories

**Prompt:**
> this int a victory. the app failed to assess the opther da,age some, that are clearly hail da,age. be sure the app is picking up al ypes of damage. i need the confidence level and accuracy to be increased

**Intent / Goal:**
- #31's anti-grid prompt language ("zero markers is common; >6 is hallucinating") plus #31's aggressive client filter (cap 6, min confidence 60, batch reject if 3+ aligned) had over-corrected: bbox-mode output came back sparse, uniformly 75% confident, and visibly missing real damage. Re-tune for honest comprehensive detection now that bbox mode solves the spatial accuracy problem at the model level.

**Self-critique:**
- I tuned for the failure mode in the screenshot in front of me (grid hallucination) instead of the production goal (find every real impact). The prompt language explicitly biased the model toward zero — the model dutifully complied. Lesson: when a structural fix (bbox mode) addresses a failure mode, remove the prompt-side scar tissue that was compensating for it.

**Decisions:**
- **System prompt rewrite.**
  - Removed "zero detections is common" / ">6 is hallucinating" framing. Replaced with calibrated volume guidance: 0–2 for clean, 2–6 for light weathering, 5–20 for confirmed storm damage, 15–30 for severe.
  - Added an explicit "ALL 13 DAMAGE CATEGORIES ARE IN SCOPE" section listing each category by name. The model was treating it as a hail-only detector by inference.
  - Calibrated bbox size expectations per category (hail strikes 20–60 on 0–1000 scale, granule patches 80–250, missing shingles 100–300).
  - Confidence rubric explicitly says "use 90+ freely when warranted" and "do not default every detection to 75 — uniform confidences mean you are hedging, which is itself dishonest." Direct fix for the uniform-75 output in the previous screenshot.
  - Soft anti-grid language preserved but de-escalated: "real damage is mostly random; a few coincidental alignments are fine."
  - Added hail-bruise diagnostic checklist (circular shape, exposed mat, granule displacement, faint sheen) — gives the model a positive identification template instead of just don'ts.
  - Strengthened user message to explicitly enumerate all 13 categories and say "the inspector trusts you to flag everything they would."
- **Client-side filter relaxed.**
  - `MARKER_MIN_CONFIDENCE`: 60 → 45 (matches the prompt floor; lets the inspector see borderline calls and judge).
  - `MARKER_HARD_CAP`: 6 → 30 (severe-hail roofs legitimately exceed 6 visible impacts).
  - `DUP_DISTANCE`: 0.04 → 0.02 (don't collapse multiple real impacts that happen to fall near each other).
  - `isGridHallucination()`: now requires ≥10 markers in the batch AND ≥6 aligned on a single axis within 1.5% (was 4-marker minimum, 3 aligned within 3%). Round-number bias check removed — bbox mode uses integer 0–1000 scale, so the lazy-decimal failure mode doesn't apply.

**Files touched:**
- `lib/services/gemini.ts` — SYSTEM_PROMPT rewrite, user-message rewrite, `sanitizeMarkers` + `isGridHallucination` re-tune.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- Re-analyze: user must run "Re-analyze all" on the existing slope. Old markers won't auto-replace.
- Watch for the inverse failure mode returning. If we see another grid hallucination in the wild, the right next move is to draw real rectangles in `DamageMarkerLayer.tsx` instead of converting to circles — bbox shape is informative for distinguishing real damage (irregular shapes) from grid hallucinations (uniform squares).
- Context Summary in PROMPT_LOG is 9 entries overdue (last refreshed at #24, now at #33). Refresh next change.

---

### [2026-07-04] #34 — App-wide motion layer: animations, count-ups, live pulses, skeletons

**Prompt:**
> Revamp this entire app to be maximally attractive, efficient, and so all of its components work. Add additional components that you think of. You are the master of this app. Make it an award winning app. Also I need lots of animations.

**Intent / Goal:**
- Bring the whole app up to the dashboard's polish level with a cohesive, token-driven motion system — "award-winning" interpreted through the Drift #1 lens: gorgeous *and* usable by a gloved roofer in sun. No animation reduces a touch target, hides state, or requires precision.

**Decisions:**
- **New `components/motion/` library** (4 primitives + barrel):
  - `FadeSlideIn` — the app-standard entrance (fade + slide-up, staggered by index × `motion.staggerDelayMs`). Replaces the dashboard's local `enter()` helper so every screen enters with the same rhythm.
  - `AnimatedCounter` — rAF-driven ease-out count-up for KPIs/stat tiles; counts from 0 on mount and re-rolls on value change. Accepts a `format` fn (e.g. `$12.3K`).
  - `PulseRing` — dot + endlessly expanding halo, the "live" indicator. Mounted ONLY when the thing it announces is live (storm hero chip when an alert is active — Drift #4 intact; Plan's "Active route" tile when a knock session is running).
  - `SkeletonBlock` — shimmer placeholder for async tiles.
- **New motion tokens** (Drift #11): `enterMs: 360`, `countUpMs: 800`, `pulseMs: 1600`, `shimmerMs: 1100`. All new animation timing goes through tokens; zero inline durations/hex.
- **BottomTabs**: active tab icon pops with a two-stage spring (`quick` → `bouncy`); active pill cross-fades instead of snapping. Haptics already present, kept.
- **DamageScoreBar**: fill now springs from 0 to score (`motion.gentle`) and the number counts up — the analysis payoff moment.
- **WeatherTile**: skeleton state while the fetch is in flight, so the tile no longer pops the layout when weather lands. Error/unconfigured still hides entirely (friendly-absent per Drift #5).
- **Dashboard**: KPIs + pipeline counts use `AnimatedCounter`; storm chip gets `PulseRing`; FAB enters with `FadeInUp` after the sections; light haptic on the two hero CTAs and FAB. Hero CTAs unchanged in content/position (Drift #3).
- **Leads / Plan / Train**: staggered `FadeSlideIn` entrances on all sections/cards; every plain `Pressable` row/chip/segment upgraded to `PressableScale` for consistent press feedback; Plan stat tiles count up; Train tiles count up. All touch-target dimensions untouched (Drift #1).
- **Map tab deliberately untouched** — #30 just stabilized the native MapView lifecycle; not stacking animation churn on it this pass.
- Maintenance: Drift Warning #9 text in this log was stale (`gemini-2.5-flash`) vs. the user-approved upgrade documented in #29 and already reflected in CLAUDE.md — updated to `gemini-2.5-pro` citing #29. Fixed pre-existing lint error in `metro.config.js` (`/* eslint-env node */`).

**Files touched:**
- `theme/tokens.ts` — 4 new motion tokens.
- `components/motion/{FadeSlideIn,AnimatedCounter,PulseRing,SkeletonBlock,index}.ts(x)` — new.
- `components/shell/BottomTabs.tsx` — spring icon pop + pill fade.
- `components/DamageScoreBar.tsx` — animated fill + count-up.
- `components/WeatherTile.tsx` — skeleton loading state.
- `app/(tabs)/{index,leads,plan,train}.tsx` — entrances, counters, pulses, PressableScale sweep, FAB entrance + haptics.
- `metro.config.js` — eslint env fix.
- `PROMPT_LOG.md` — this entry + Context Summary refresh (was 10 entries overdue) + Drift #9 text sync.

**Verification:**
- `npm run typecheck` — clean. `npm run lint` — 0 errors (14 pre-existing warnings in unrelated files left as-is).
- Constraint Verification Protocol: Drift #1/#3/#4/#5/#11 checked — touch targets preserved, hero CTAs intact, PulseRing only renders inside the `activeAlert` branch, no mocks introduced, all styling/timing via tokens.

**Follow-ups:**
- Device pass in Expo Go: confirm 60fps on the dashboard stagger with a long inspection list, and that `AnimatedCounter`'s per-frame `setState` stays cheap (it's bounded at ~48 frames per roll-up; if it ever shows up in profiling, move to reanimated + `runOnJS` batching).
- Settings tab and detail screens (Job/Lead/Analyze) not yet on the motion system — same `FadeSlideIn` treatment is a mechanical follow-up.
- Consider a reduced-motion accessibility toggle (respect `AccessibilityInfo.isReduceMotionEnabled`) that zeroes `enterMs`/`countUpMs` — parked until a user asks.

---

### [2026-07-04] #35 — Remove dead-project Supabase fallback; friendly "not configured" gate

**Prompt:**
> network request failed
> [follow-up] wait i think it was working

**Intent / Goal:**
- User hit the documented "network request failed" symptom on simulator launch. Root cause has been an open follow-up since the Context Summary of #24: `lib/env.ts` fell back to the deleted Supabase project `mzsabjegtxmzlfpxmmfm` whenever `.env.local` was missing, so auth calls died with a bare network error. The previously attempted fix (hardcoding the new project's keys) was correctly blocked by credential scanning — this is the non-hardcoded approach.

**Decisions:**
- `lib/env.ts`: deleted the fallback URL + anon key outright. `SUPABASE_URL`/`SUPABASE_ANON_KEY` are empty when unset. New export `isSupabaseConfigured`.
- `lib/supabase.ts`: when unconfigured, the client is constructed with a syntactically-valid `.invalid`-TLD placeholder so module import never throws; real calls are gated upstream.
- `lib/auth/authStore.ts`: central `assertConfigured()` at the top of the four network-touching auth actions (sign in / sign up / Apple token / password reset) — sets and throws a friendly, actionable message ("copy .env.local.example to .env.local … restart with npx expo start --clear"). `initialize()` untouched — `getSession()` reads local AsyncStorage only, no network.
- Configured machines see zero behavior change: same client, same keys, same flows. Verified only `lib/supabase.ts` consumes the env pair (grep), so no other call site can reach the placeholder.
- User followed up that the app may in fact have been working (their Mac likely has `.env.local`); the transient error was possibly a stale-bundle first load. The fix lands regardless — it closes the open follow-up and can't regress a configured device.

**Files touched:**
- `lib/env.ts`, `lib/supabase.ts`, `lib/auth/authStore.ts`
- `PROMPT_LOG.md` — this entry + Context Summary gotcha bullet marked fixed.

**Verification:**
- `npm run typecheck` clean; `npm run lint` 0 errors (14 pre-existing warnings unchanged).
- Drift check: no mocks (Drift #5 — placeholder is unreachable and non-synthesizing), no credentials in source (secrets policy), auth flag wiring untouched (Drift #12).

**Follow-ups:**
- Welcome screen could pre-check `isSupabaseConfigured` and show a banner before the user types anything — currently the message appears on first submit.
- Sync services (`leadSync`, `correctionsSync`, `backup`) still swallow errors silently on unconfigured machines; acceptable (they're background), but a settings-screen "backend: not configured" indicator would make field debugging faster.

---

### [2026-07-07] #36 — Marketing site + 30s ad + 15s social video (animated, brand-token derived)

**Prompt:**
> Build the website for RoofWise with animation. Build a ad video as well. And a social media video

**Intent / Goal:**
- Marketing collateral, not app code. Three pieces sharing one visual identity derived from `theme/tokens.ts` (navy/orange/cream/slate): an animated single-page marketing site, a 30-second ad spot, and a 15-second vertical social cut.

**Decisions:**
- All three live in `website/` as fully self-contained HTML (no external assets/CDNs) and are published as Claude Artifacts for immediate preview/sharing.
- **Identity:** "forensic evidence document" direction — mono-type annotations, AI bounding boxes, HAAG threshold tables, stamped verdicts — because the product's story IS evidence. Alternating navy (storm/field) and cream (document/office) bands mirror the two worlds the product bridges.
- **Website (`website/index.html`):** hero with live animated detection phone mock (bounding boxes + confidence tags + verdict chip), radar sweep backdrop, count-up economics stats ($5–20K denial / $10–50K approval / 13 categories / 1 approval pays), 13-category marquee (real taxonomy), 4-step how-it-works, HAAG threshold table with slam-in CLAIM-WORTHY stamp (real material thresholds from the spec), field-kit grid, glove-first design section (real spec constraints), early-access CTA via mailto:contact@roofwise.app. IntersectionObserver reveals; prefers-reduced-motion respected. No fabricated testimonials/logos/customers (Drift #5 spirit).
- **Ad (`website/ad-30s.html`):** 16:9 six-scene ~30s kinetic-typography spot — storm intro (radar + hailfall + lightning flash) → denial pain → AI detection burst → HAAG verdict stamp → economics → end card. Self-playing scene engine with progress bar, click-pause, replay. Screen-record-to-MP4 instructions included (no video rendering available in this environment; verified Canva MCP generation is static-only, no video design type).
- **Social (`website/social-15s.html`):** 9:16 five-scene ~15s hook-first cut ("Another claim just got… DENIED") for Reels/TikTok/Shorts. Same engine + export note.
- Artifacts: website https://claude.ai/code/artifact/e17d0926-969d-4832-b81f-c6184e09f381 · ad https://claude.ai/code/artifact/cf2120b7-efb2-4352-b9cb-feea3ff536f1 · social https://claude.ai/code/artifact/f1923695-d137-4ef6-a749-308d3d390f3b

**Files touched:**
- `website/{index,ad-30s,social-15s}.html` — new.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- Replace the stylized CSS roof in hero/scenes with real inspection photography once field-trial photos are cleared for marketing use.
- Register/point roofwise.app domain and host `website/` (Vercel/Netlify static).
- If real MP4s with sound are needed, screen-record the two players (QuickTime ⌘⇧5) or hand the storyboards to an editor; scenes are timed to broadcast pacing already.

---

### [2026-07-07] #37 — Founder video: speaking animated avatar + script + photoreal path

**Prompt:**
> Do a founder video. Use a reslitic face as the avatar speaking.

**Intent / Goal:**
- A founder-message video with a speaking avatar. Photorealistic human video generation isn't possible in this environment (no HeyGen/Synthesia/D-ID connected; Canva MCP is static-only) — stated plainly to the user rather than faking it.

**Decisions:**
- `website/founder-60s.html`: a speaking founder player — illustrated SVG founder portrait (cap with RW mark, work shirt; deliberately stylized, labeled as such) that actually TALKS: Web Speech API reads the 8-segment script aloud with a viseme-cycling mouth (rest/small/open/press/round), blink loop, brow emphasis on key lines, word-synced karaoke captions, segment progress dots, voice picker, and a timed-caption fallback when TTS is unavailable. Lower-third with founder name placeholder.
- **No fabricated biography.** Script lines about the founder's personal history are [BRACKETED] placeholders with an edit note; product claims in the script are spec-true (13 categories, HAAG thresholds, $5–20K denial cost, one-approval economics).
- Photoreal path documented on-page and in chat: paste the same script into HeyGen/Synthesia, render, swap the MP4 in.
- Artifact: https://claude.ai/code/artifact/22f83580-1c8a-42f0-9ef8-5d19101f270d

**Files touched:**
- `website/founder-60s.html` — new.
- `PROMPT_LOG.md` — this entry.

**Follow-ups:**
- Replace [BRACKETED] story lines with the founder's real one-liner before any public use.
- If publishing an AI-avatar version (HeyGen/Synthesia), disclose it's AI-generated — platform policies increasingly require synthetic-media labels, and B2B contractor trust favors the real founder on camera anyway.

---

### [2026-07-22] #38 — Web preview support: run the real app headless from a Claude session

**Prompt:**
> okay i want to coniue building the roofwise app and i want to see a similator of the app. i know you now have that capability

**Intent / Goal:**
- No iOS Simulator exists in the cloud session (Linux, no Xcode) — but the container has headless Chromium + Playwright. Wire Expo web support so the REAL app runs in a browser, drive it, and screenshot every tab. This becomes the standing "see the app from a Claude session" path.

**Decisions:**
- `npx expo install react-dom react-native-web @expo/metro-runtime` (SDK-51-pinned).
- `npm i @opentelemetry/api` — Supabase-js's `.mjs` (web) build references it as an optional dep; Metro web resolution fails without it. Native path never touched it.
- **`components/map/Map.web.tsx`** — web fallback mirroring Map.tsx's full export surface (Map, MapPin, MapPolyline, MapPolygon, MapCircle, MapHeatmap, regionForLatLon, Region). react-native-maps has no web implementation; web renders a friendly "Map runs on the mobile app" panel (Drift #5: absent, never synthesized). Follows the existing `.native.tsx` split precedent (StormHistoryMap).
- **Auth-gate bug found & fixed (Drift #12):** `app/index.tsx` and `app/(tabs)/_layout.tsx` redirected to /welcome whenever session was null, ignoring `env.REQUIRE_AUTH` entirely — the flag was wired in env but never consulted at the gates. With requireAuth=false (dev default) the app is now usable signed-out, per the documented contract. On devices this was masked by persisted sessions.
- Headless drive: Playwright (scratchpad-installed; Chromium pre-provisioned) at 390×844 iPhone viewport, onboarding pre-seeded via localStorage (`roofwise.onboarding.v1`), all 5 tabs + welcome screenshotted and delivered to the user. Only console error: expo-camera's web QR worker fetching jsQR from CDN (blocked by container proxy; harmless, camera flows are device-only anyway).
- Verified in shots: motion layer live (WeatherTile skeleton, count-up KPIs), hero CTAs intact (Drift #3), empty-state boot (Drift #5).

**Files touched:**
- `package.json` / `package-lock.json` — web deps + @opentelemetry/api.
- `components/map/Map.web.tsx` — new.
- `app/index.tsx`, `app/(tabs)/_layout.tsx` — gate on `env.REQUIRE_AUTH && !session`.
- `PROMPT_LOG.md` — this entry.

**Verification:**
- typecheck clean; lint 0 errors. All 6 routes rendered and screenshotted.

**Follow-ups:**
- Recommend `/run-skill-generator` next session to capture the launch recipe (expo web + Playwright driver) as a project skill.
- `REQUIRE_AUTH=true` path re-test before ship: welcome gate confirmed still working (screenshotted) but sign-in E2E needs the Supabase project awake.
- Web is a PREVIEW target only — camera, maps, sensors, PDF flows remain device-only. Don't ship web.

---

### [2026-07-22] #39 — Withheld-detections toast + rectangle overlays + BACKLOG.md ledger

**Prompt:**
> Do 2 then 3. It don't forget to do the others. I've notice that if I don't go back and tell you to do stuff we decide not to do immediately, that you never bring them back uk to do.

**Intent / Goal:**
- Ship the two trust-loop features picked from the priority list (#31's toast follow-up, #32's rectangle follow-up), AND fix the process failure the user called out: deferred work was tracked only in per-entry follow-up notes, which nothing forces future sessions to re-read.

**Decisions:**
- **Withheld-detections toast (closes #31 follow-up).** `AnalysisResult` gains `detectionAudit: { rawCount, keptCount, gridRejected }`; `sanitizeMarkers()` now returns `{ markers, gridRejected }`. `analyzeSlope()` counts photos where the client filter withheld everything the model produced (`gridRejected || rawCount>0 && keptCount===0`) and fires ONE warn toast per slope run ("AI withheld unreliable detections… re-shoot or add markers manually"). Without this, a rejected batch was indistinguishable from a clean roof — an inspector-trust hole. analyzePhoto has a single call path (analyzeSlope), verified by grep.
- **Rectangle overlays (closes #32 follow-up).** `DamageMarker` gains optional `box {xmin,ymin,xmax,ymax}` (normalized 0-1); gemini's bbox path stores it (bboxFrom output reused). `DamageMarkerLayer` draws true rectangles for boxed markers (24px min draw size, radii.sm corners, severity tint, confidence bubble) and keeps circles for manual/legacy markers. Hit-testing is now shape-aware: padded point-in-rect for boxes (36px glove minimum), center-distance for circles. Box shape is diagnostic — real damage is irregular, hallucinated grids are uniform (#33 follow-up rationale).
- **BACKLOG.md (new root file) + CLAUDE.md backlog rule.** Single ledger aggregating every open follow-up from entries #24–#38, organized Now / Next / Before-ship / Marketing / Parked / Done with source-entry refs. CLAUDE.md now instructs every session: read it after the Context Summary, add deferrals in the same commit, close items with the entry number. This is the structural fix for "you never bring them back up."

**Files touched:**
- `lib/models/types.ts` — DamageMarker.box.
- `lib/services/gemini.ts` — DetectionAudit type, sanitizeMarkers signature, box passthrough, audit in normalize return.
- `lib/services/analyzeSlope.ts` — withheld counting + toast via toastStore.
- `components/DamageMarkerLayer.tsx` — rect rendering + shape-aware hit-test.
- `BACKLOG.md` — new. `CLAUDE.md` — backlog rule.
- `PROMPT_LOG.md` — this entry.

**Verification:**
- typecheck clean; lint 0 errors. NOT yet verified against live Gemini output (no API key in this container) — BACKLOG "Now" carries a device-verification item. Existing persisted markers (no box) render as circles unchanged; only fresh analyses get rectangles — users must Re-analyze to see boxes (same caveat as #31–#33).

**Follow-ups:**
- Tracked in BACKLOG.md — that's the point. Top of "Now": motion layer for Settings + Job/Lead details, HAAG PDF polish, device verification of this entry's features.

---

### [2026-07-22] #40 — Audit stale status table; capture account/API setup; flag Swift-era guidance

**Prompt:**
> [Long TO-DO dump: Apple Developer application, WeatherKit entitlement steps, Google Maps/Solar API enablement + key restriction console links, "Storm-Triggered Sales Acceleration" phases 6A–6E described as queued in Rork, "Recursive Learning Loop" phases 9A–9F described as queued in Rork, and a request to restore full-resolution analysis.]
> im putiing this in as a reminder

**Intent / Goal:**
- Capture the user's reminder durably, but first separate what actually applies to this Expo codebase from Swift/Rork-era guidance, and verify the phase claims before anyone re-commissions built work.

**Findings (the reason this entry matters):**
1. **Phases 6A–6E and 9A–9F are already built here.** The dump described them as newly queued in Rork. Verified on disk: `stormWatch.ts`, `stormMatch.ts`, `pushNotifications.ts`, `serviceAreaStore.ts`, `stormAlertStore.ts`, `app/door-knocking.tsx`, `app/settings/service-area.tsx`, `app/storm-alert/[id].tsx`; and `learning/{userCorrectionProfile,localLearningEngine}.ts`, `app/swipe-review.tsx`, `app/edit-detection.tsx`, `correctionsStore.ts`, `correctionsSync.ts`, `AICalibrationCard.tsx`. Re-building would have been weeks of duplicated spend.
2. **Root cause: the Feature Backlog & Status table in this log was ~15 entries stale**, marking shipped features "Not started". Audited and rewritten with per-row source paths (Drift #13 protects Prompt *History*; this status table is not history, so correcting it is in-contract). Added a header note explaining the audit and pointing open work at BACKLOG.md.
3. **Much of the dump targets the archived Swift repo** — `APIKeys.swift`, `USE_MOCKS = false`, `#if canImport(GoogleMaps/WeatherKit)`, Xcode Swift Package adds, MOCK/LIVE pill. None exist here. `USE_MOCKS` directly contradicts Drift #5 (this app has no mocks). Recorded the distinction at the top of the new setup doc so it doesn't resurface.
4. **Bundle ID conflict.** `app.config.js` declares `com.roofwise.app`; the dump's key-restriction step says `com.paxconsulting.roofwise`. Restricting a Google key to the wrong bundle ID breaks Maps/Places/Solar in the shipped app with an unhelpful error. Flagged as the top BACKLOG "Now" item — it blocks the key-restriction work the user wants to do.
5. **WeatherKit is the wrong call here.** `lib/services/weather.ts` is already a live Google Weather client sharing the Maps key. Adopting Apple WeatherKit would require paid enrollment + entitlement + a custom Expo config plugin + a dev build, and cannot run in Expo Go. Documented the recommendation to skip it.
6. **Full-resolution analysis: the user's instinct is correct.** `app/quick-inspection.tsx` stores ONE 1600px/0.7 JPEG and `analyzeSlope.ts` sends that same file to Gemini — there is no separate analyze profile. A ~1in hail strike in a ~4ft frame lands around 30px, marginal for characterizing mat exposure and granule displacement. **Constraint:** the 1600px cap is load-bearing — it exists to prevent the Expo Go OOM/SIGABRT crashes from #23/#24. The fix is a two-profile pipeline (1600px stored for display; a transient 2400–3072px copy for analysis only), never a blanket raise of the picker path. Queued in BACKLOG "Now", not implemented in this entry.

**Files touched:**
- `docs/SETUP_ACCOUNTS.md` — new. Corrected, Expo-specific account/API checklist with the Swift-guidance warning, bundle-ID warning, per-service key mapping, Solar cost math, and the WeatherKit recommendation. Deliberately excludes the console deep-links containing key resource IDs (secrets policy) — those stay in the user's password manager.
- `PROMPT_LOG.md` — Feature Backlog & Status table audited/rewritten; this entry.
- `BACKLOG.md` — added bundle-ID resolution and full-res analyze path to "Now"; Apple Developer enrollment and Google API enable/restrict to "Next".

**Verification:**
- Existence of every phase deliverable confirmed by direct file checks, not assumption. No app code changed in this entry, so typecheck/lint state is unchanged from #39.

**Follow-ups:**
- All in BACKLOG.md. Highest-leverage next code change is the two-profile analyze pipeline (finding 6) — it directly moves detection accuracy, which is the product.

---

### [2026-07-22] #41 — Two-profile image pipeline: stop starving Gemini of pixels

**Prompt:**
> okay continue. theres the word lol. go

**Intent / Goal:**
- Implement the full-resolution analyze path identified in #40 finding 6. Detection accuracy is bounded by how many pixels (and how much un-smeared texture) Gemini receives, and the capture path was throttling both.

**Root cause — two stacked losses, not one:**
1. `downscale()` in `app/quick-inspection.tsx` capped every photo at **1600px / JPEG 0.7**, and `analyzeSlope` sends that same stored file to Gemini. There was no separate analyze profile. A ~1in hail strike in a ~4ft frame lands around **30px** — marginal for judging exposed mat, granule displacement at the edges, and the compressed-asphalt sheen, which is exactly what the HAAG call turns on.
2. **Upstream of that**, `takePictureAsync({ quality: 0.7 })` had already baked JPEG artifacts into the frame before our pipeline ever saw it. Compression artifacts smear fine granule texture specifically — the diagnostic signal. Two lossy steps stacked; the first was pure loss with no benefit.

**Decisions:**
- **New `lib/services/imagePipeline.ts`** with two named profiles: `ANALYZE_PROFILE` (2560px / 0.82) stored + sent to Gemini, `SAFE_PROFILE` (1600px / 0.7) as the fallback. At 2560px the same strike is ~48px.
- **Ladder, not a raise.** The old 1600px cap was load-bearing — it stopped the Expo Go OOM/SIGABRT crashes in #23/#24. `prepareCapturedPhoto()` tries ANALYZE, falls back to SAFE if the device can't manage it, then falls back to the untouched original rather than ever dropping a photo. The crash guard survives as a fallback instead of a ceiling.
- **Never upscale.** `Image.getSize()` first; the resize action is omitted entirely when the source is already narrower than the target. Upscaling a small library photo would add interpolation artifacts and bytes without adding information. The JPEG re-encode still runs unconditionally (HEIC normalization depends on it).
- **Camera quality 0.7 → 0.95**, so `prepareCapturedPhoto` is the single intentional lossy step. Explicitly noted in-code that this is unrelated to the ImagePicker `quality` param removed in #23 — different API, different failure mode (that one was a multi-HEIC re-encode OOM).
- **Storage strategy: one file, not two.** Raising the stored resolution avoids a data-model change, a migration, and orphan cleanup. Downstream consumers already re-manipulate from the stored file (`photoSync` → 1600px for upload, `haagPdf` → 700px for the report), so they are unaffected beyond starting from a better source.
- **Cost:** roughly 2x image *input* tokens per photo. Output tokens — the expensive half — unchanged.

**Incidental bug found and fixed:** `npm run lint` was reporting **2036 errors** because ESLint was linting `dist/` (the web-export bundle from #38). `dist/` is gitignored, but ESLint doesn't read `.gitignore`. Added `ignorePatterns` to `.eslintrc.js` and verified with a deliberately-bad `dist/fake.js` that it's now skipped. Anyone who ran `expo export` was getting a broken lint.

**Files touched:**
- `lib/services/imagePipeline.ts` — new.
- `app/quick-inspection.tsx` — local `downscale()` removed, both capture and library paths call `prepareCapturedPhoto`, camera quality raised.
- `.eslintrc.js` — ignorePatterns for build artifacts.
- `PROMPT_LOG.md` — this entry. `BACKLOG.md` — item moved to Done.

**Verification:**
- typecheck clean; lint back to baseline 14 warnings / 0 errors; ignorePatterns verified against a planted bad file.
- **NOT device-verified.** The image pipeline can't run on web (no camera, and `expo-image-manipulator` is native). Needs a real-iPhone pass: confirm no OOM on a long capture session, confirm the analyze profile is the one actually selected (not the SAFE fallback), and compare detection counts against the same roof at the old settings. Tracked in BACKLOG.

**Follow-ups:**
- Consider logging which profile won into the ActivityStore, so a device silently falling back to SAFE is visible rather than a mystery accuracy regression.

---

### [2026-07-22] #42 — Ship-readiness pass: full 35-route audit, crash net, real-defect fixes

**Prompt:**
> finish the app. go through all the components and make sure they work. make it ship ready. dont ask me any questions. just execute let me know when youre done. i exopect this to take hours

**Method:**
- Built a headless-browser route audit harness (`audit.js` in the session scratchpad) that drives **all 35 routes** against the Expo web target with seeded store data, capturing page errors, console errors, blank screens, and wrong-route renders, and screenshotting each. This is the first time every screen in the app has been exercised in one pass.
- **First run was contaminated** and reported 29/35 broken. Cause: `expo-camera`'s web build lazily fetches jsQR from a CDN the container sandbox blocks; I filtered that from console errors but not page errors, so one benign network failure masked every route. Fixed the filter and re-ran. Recording this because a 29/35 "failure" report that is actually a harness bug is exactly the kind of result that would send a future session rewriting working screens.
- Clean result: **35 routes, 34 clean, 1 real defect.** After fixes, re-audited.

**Real defects found and fixed:**
1. **setState during render (`app/proposal/[jobId].tsx`).** `create()` — a Zustand setter — was called inside `useMemo`, i.e. in the render phase. React flags this as "Cannot update a component while rendering a different component"; it can double-create a proposal or drop the write. Moved to an effect with a guard ref that survives StrictMode's double-invoke, plus a reset keyed on `jobId` for same-screen navigation.
2. **Cold-launch navigation crash.** `router.replace` fired before the root navigator mounted → "Attempted to navigate before mounting the Root Layout component", leaving a dead screen. Two sites: the Quick Inspection pre-flight safety redirect (surfaced by the audit) and — found by inspection, same class — the notification-tap deep-link handler in `_layout.tsx`, which is *more* dangerous because a cold launch from a storm-alert notification delivers the pending response immediately. Both now gate on `useRootNavigationState()?.key`.
3. **"Invalid Date" leaking to users.** 19 unguarded `new Date(x).toLocale*()` sites across 13 files. Any malformed or missing persisted date (old schema, restored backup, bad NOAA payload) renders the literal string "Invalid Date" — including **inside the HAAG claim packet and the customer proposal PDF**, the two documents the product's credibility rests on. New `lib/format/date.ts` (`formatDate` / `formatDateShort` / `formatDateTime` / `formatRelative` / `isValidDate`) never throws and never emits "Invalid Date"; applied to both PDF generators and the storm-alert, job, and lead detail screens.

**Ship-readiness additions:**
- **`components/ErrorBoundary.tsx`**, wrapping the navigator in `_layout.tsx`. Previously any render crash produced a white screen with no way back — the worst possible failure for a roofer mid-inspection on a roof. Now: a themed recovery screen, plain-language reassurance that stored work is safe (Zustand lives outside React, so it genuinely is), a selectable error + component stack for support, and an 88pt Try again that remounts the tree.
- **HAAG PDF polish** (`lib/services/haagPdf.ts`): removed internal roadmap language leaking into a carrier-facing document ("NOAA auto-fill comes online in Phase 4C" → a real instruction about attaching the date-of-loss event); added a **Methodology** block citing the material-specific Haag threshold and the confidence-floor policy, which is what makes an adjuster read it as a methodology-backed report rather than a contractor's opinion; fixed the section numbering (a stray "4b" renumbered 1–9); collateral checklist now renders human labels instead of raw `snake_case` keys; added `page-break-inside: avoid` so slope cards, tables, and the signature block never split across printed pages.
- **Motion layer completed** — Settings (7 staggered sections) and the Job/Lead detail screens now match the rest of the app; all remaining plain `Pressable`s on those screens became `PressableScale`.
- **Accessibility**: icon-only controls had no screen-reader labels. Labeled the 5 tab buttons (with `accessibilityRole="tab"` + selected state), the shared back button, dashboard search/settings, the quick-add FAB, and the Leads add button.
- **Bundle ID settled: `com.roofwise.app`** — both platforms in `app.config.js` already agreed; `com.paxconsulting.roofwise` was never in the code. Documented in `docs/SETUP_ACCOUNTS.md`. Unblocks the Google API key restrictions.
- **Lint to zero** (was 14 warnings): autofix for the mechanical `Array<T>` cases, manual removal of unused bindings.

**Files touched:**
- New: `components/ErrorBoundary.tsx`, `lib/format/date.ts`.
- Fixed: `app/proposal/[jobId].tsx`, `app/quick-inspection.tsx`, `app/_layout.tsx`, `app/storm-alert/[id].tsx`, `app/job/[id].tsx`, `app/lead/[id].tsx`, `lib/services/{haagPdf,proposalPdf}.ts`, `app/(tabs)/{index,leads,settings}.tsx`, `components/{ScreenHeader,DamageMarkerLayer,VoiceNoteRecorder}.tsx`, `components/shell/BottomTabs.tsx`, `app/{damage-explainer,swipe-review}.tsx`, `docs/SETUP_ACCOUNTS.md`.

**Verification:**
- typecheck clean; lint **0 problems**; 35/35 routes audited post-fix.
- **Not verified here:** anything native. The PDF's rendered output, the camera pipeline, maps, and sensors need a device. `/pitch-gauge` fails on web only (`expo-sensors` has no browser accelerometer) — expected, not a defect.

**Follow-ups:** in BACKLOG.md. The device pass is now the single highest-value remaining item — it gates verification of #39, #41, and this entry's PDF changes.

---

### [2026-07-22] #43 — Storm queries follow the user's service area instead of hardcoded Texas

**Prompt:** (continuation of the #42 ship-readiness pass)

**Intent / Goal:**
- A `TODO` in `app/hail-tracer.tsx` and the same hardcoded `state: 'TX'` in `app/(tabs)/map.tsx` meant every storm query targeted Texas regardless of where the contractor works. This is a worse class of bug than a crash: it returns **real NOAA data for the wrong state**, so it looks correct. An Oklahoma contractor would pitch claims against Texas hail history.

**Decisions:**
- New `lib/services/serviceState.ts` resolves the target state in priority order: (1) a supported 2-letter code parsed from a saved Service Area label, (2) the state on the most recent inspection's address, (3) `'TX'` as the launch-market default. `stateFromText` matches standalone uppercase pairs against the known `STATE_CENTERS` keys so "Saint"/"Ok" can't false-positive.
- Both screens now derive `serviceState` and the map center from it, and re-query when the resolution inputs change. Removed the `TODO` and the `STATE_CENTERS.TX` imports.
- Reads stores imperatively via `getState()` so services can call it too; components pass the store slices as memo deps for reactivity.
- Caught in review: the first patch left `serviceState` referenced in a `useEffect` dep array **above** its `const` declaration — a temporal-dead-zone crash on every Map render. Reordered before commit.

**Files touched:** `lib/services/serviceState.ts` (new), `app/hail-tracer.tsx`, `app/(tabs)/map.tsx`, `BACKLOG.md`, `PROMPT_LOG.md`.

**Verification:** typecheck + lint clean; `/map` and `/hail-tracer` re-driven in the browser harness, both render with no page errors.

**Follow-ups:** Service Area labels are free text; a state picker in `app/settings/service-area.tsx` would make resolution deterministic instead of parsed. Tracked in BACKLOG.

---

### [2026-08-01] #44 — Fix raw snake_case material leak in decision-engine reasoning

**Prompt:**
> Show me what a haaag report looks like.

**Method:**
- Rather than describe the report, rendered the real `renderHtml()` template from `lib/services/haagPdf.ts` with a realistic post-hailstorm inspection (4 slopes, all three verdict states: full_replace, repair, verify_with_inspector), using the actual `decisionEngine.ts` + `haagThresholds.ts` logic ported verbatim to a standalone script (native deps — expo-print, expo-image-manipulator, AsyncStorage — can't resolve outside the app; the pure logic and template are copied 1:1, same branches, same copy). Screenshotted the full report in a real browser to confirm it renders clean.

**Bug found while building the demo:**
- Two reasoning strings in `decisionEngine.ts` interpolated the raw `RoofMaterial` key instead of its label — `"Material (architectural_asphalt) follows all-or-nothing matching"` and `"Slope shows damage below the architectural_asphalt HAAG threshold"`. A database key leaking into a document meant to read as a professional report to an insurance adjuster. The prior ship-readiness pass (#42) reviewed `haagPdf.ts`'s template but not the reasoning strings generated one layer down in `decisionEngine.ts`, so this slipped through.
- Fix: `decisionEngine.ts` now imports `ROOF_MATERIAL_LABELS` (a value import, not I/O — Drift #8 purity intact) and both strings render the human label ("Architectural Asphalt").
- Grepped the rest of the codebase for the same raw-interpolation pattern; no other occurrences.

**Files touched:** `lib/services/decisionEngine.ts`. `PROMPT_LOG.md` — this entry.

**Verification:** typecheck clean, lint 0 problems. Confirmed no other `${...material}` raw interpolations app-wide.

**Deliverable:** Published sample report as a Claude Artifact (not committed — demo output, not app code) showing the full 9-section packet: cover, Methodology block, Summary stats, Weather Verification, Roof System, Slope-by-Slope Findings (all three verdict pill colors), Inspector Notes, Collateral Checklist, Insurance-Grade Narrative, Homeowner Summary, and Signatures with a live inspector signature stroke.

**Follow-ups:** none new — this was a one-line-class fix caught in passing, not a new backlog item.

---

### [2026-08-01] #45 — Every analyzed photo included in the HAAG report (was capped at 3/slope)

**Prompt:**
> Ensure that every photo that is analyzed for damage, is included in the report.

**Root cause — two layers deep:**
1. `haagPdf.ts` hard-capped photo embedding at `PHOTOS_PER_SLOPE = 3` (`slope.photoPaths.slice(0, 3)`) — a slope with 6 analyzed photos only shipped 3 to the carrier.
2. Deeper problem found while fixing it: the app had **no explicit record of which photos were analyzed at all.** Both `analyzeSlope.ts`'s `pickPhotos()` (drives "analyze new only") and `app/analyze.tsx`'s per-photo checkmark inferred "analyzed" from `slope.damage.some(m => m.photoIndex === i)` — presence of a damage *marker*. A photo analyzed and found clean produces zero markers, so it was indistinguishable from a photo never analyzed at all. This meant "analyze new only" would silently re-send clean photos to Gemini forever, and the Analyze screen would show a clean photo as still needing review.

**Decisions:**
- **New `Slope.analyzedPhotoIndices?: number[]`** (`lib/models/types.ts`) — the authoritative, marker-independent record. Optional so pre-existing AsyncStorage-persisted inspections (which predate this field) degrade safely rather than crash; every read site falls back to treating all captured photos as analyzed rather than showing none.
- `inspectionStore.ts`: `replacePhotoMarkers` (the one call site that means "this photo was analyzed," fired once per photo from `analyzeSlope.ts` regardless of whether markers were found) now adds the index (deduped, sorted). `removePhoto` keeps the index list aligned with `photoPaths` the same way it already realigns `damage` — drops the removed index, decrements everything above it.
- `analyzeSlope.ts` `pickPhotos()` and `app/analyze.tsx` (both the `unanalyzed` memo and the per-thumbnail checkmark) now read `analyzedPhotoIndices` directly instead of inferring from markers — fixes the "clean photo re-analyzed forever" bug and the wrong checkmark as a byproduct of building the correct primitive.
- `haagPdf.ts`: new `analyzedIndicesFor()` helper (same back-compat fallback), `preparePhotoDataUris` now embeds every analyzed photo, no cap. Slope caption shows `"{captured} photos · {analyzed} analyzed"` when they differ, so the report is explicit rather than implying every captured photo was reviewed.
- **CSS fix required by removing the cap:** `.photo-row` was `display: flex` with no `flex-wrap` and children at `width: 32%` — fine for ≤3 images, but ≥4 would overflow or squeeze onto one line. Switched to a 3-column CSS grid (wraps to additional rows for any count) with `aspect-ratio: 4/3` on thumbnails so mixed portrait/landscape roof photos lay out evenly.

**Files touched:** `lib/models/types.ts`, `lib/stores/inspectionStore.ts`, `lib/services/analyzeSlope.ts`, `lib/services/haagPdf.ts`, `app/analyze.tsx`. `PROMPT_LOG.md` — this entry.

**Verification:** typecheck clean, lint 0 problems. Re-rendered the sample report from #44 with a 6-captured/5-analyzed slope — grid wrapped correctly (3 + 2 photos, two rows, no overflow), caption read "6 photos · 5 analyzed" as designed. Full 35-route audit re-run to confirm no regression on `/analyze` or `/edit-detection`.

**Follow-ups:** none new. `preparePhotoDataUris` still silently skips a photo whose file is missing from disk (restored backup, different device) — pre-existing behavior, unchanged by this fix, orthogonal to the analyzed-vs-captured distinction added here.

---

### [2026-08-01] #46 — Include EVERY captured photo in the report, labelled by analysis status

**Prompt:**
> I need every photo that's taken to be in that report by slope

**Intent / Goal:**
- Correction to #45. That entry filtered the claim packet to *analyzed* photos only. The user's actual requirement: every photo the inspector captured belongs in the packet, grouped by slope. A photo taken on the roof is evidence regardless of whether Gemini reviewed it — an absent photo reads to an adjuster as an absent observation.

**Decisions:**
- **Analysis status is a label, never a filter.** `preparePhotoDataUris` now embeds every entry in `slope.photoPaths` with no cap and no filtering. Whether Gemini reviewed a given photo is rendered as a per-photo caption ("Photo 3 · AI-analyzed" vs "Photo 6 · reference"). This keeps the packet complete without implying AI review of a photo that never got it — an important distinction in a document a carrier relies on.
- **New `ReportPhoto` record type** (`{ index, dataUri, analyzed }`) replaces the flat `string[]` photoMap. Motivation is a real latent bug: photos unreadable from disk (restored backup, different device) were silently skipped from a positional array, so every *subsequent* photo's number and analyzed-label would shift out of alignment with the actual capture order. Carrying the index makes labels immune to gaps.
- `wasAnalyzed()` replaces `analyzedIndicesFor()`. Same back-compat stance: inspections predating `analyzedPhotoIndices` (#45) have no record either way, so their photos are labelled analyzed rather than mislabelling genuinely-reviewed work as "reference" in a claim packet.
- **Slope caption is now fully honest about gaps:** `"6 photos · 5 AI-analyzed · 1 unavailable"`, with each clause omitted when it doesn't apply. The "unavailable" count (captured-but-unreadable) was previously invisible — the report would just show fewer photos than the count claimed.
- CSS: photos wrapped in `<figure>` with `figcaption`; grid gap switched from a percentage to a fixed `12px` so captions don't crowd at narrow print widths.

**Files touched:** `lib/services/haagPdf.ts`. `PROMPT_LOG.md` — this entry.

**Verification:** typecheck clean, lint 0 problems. Re-rendered the sample report with a 6-photo slope (5 analyzed + 1 captured after the last analysis run): all 6 render in a wrapping 3-column grid, captions read "Photo 1–5 · AI-analyzed" and "Photo 6 · reference", slope header reads "6 photos · 5 AI-analyzed". A second slope with photos in `photoPaths` but none supplied to the renderer correctly reported "2 photos · 2 unavailable", exercising the gap path. Full 35-route audit re-run.

**Follow-up caught during this work:** a bad `re.sub` in the *demo* script silently failed (SVG data URIs contain `;`, which the `[^;]` pattern couldn't cross) and produced a stale render. Caught because the rendered caption disagreed with expected values — worth noting that verifying the *output* rather than trusting the edit is what surfaced it. Demo script only; no production impact.

---

### [2026-08-03] #48 — Plain-language homeowner summary; claimability protocol still missing

**Prompt:**
> the homewoner summary need to be more descriptive and in plain language. the extent of the damage, the reccomendation. explaining the fact that insurance companies cover up to two years since last hail or severe wind storm. that its an act of God event. that theyd only need to pay thier deductable.
> ive also added the haag decision protocal to calculate roof damage and replacement needs.
> i also want to see the simlated version of the app.

**Homeowner summary rewrite (`lib/services/haagPdf.ts`):**
- Was four one-sentence canned strings. Now a five-paragraph, data-driven narrative at ~8th-grade reading level, returned as HTML (call site no longer `esc()`s it; new `.homeowner` CSS gives it a longer measure and more leading than the adjuster-facing sections, since it's the only part most owners read end to end).
- Structure: **What we found** (real per-slope totals — "28 hail impacts, 11 bruised areas, 5 wind-lifted shingles and 1 missing shingle" — plus the NOAA storm tie-in) → **How that gets judged** (explains functional vs cosmetic damage and names the material threshold) → **What we recommend** → **How the insurance side works** (act of God, deductible) → **Don't sit on it** (filing window).
- Branches properly by verdict. The `not_claimable` path deliberately does **not** get the insurance-mechanics or urgency paragraphs — telling someone about deductibles and deadlines when we just told them they don't have a claim would be misleading. It instead advises keeping the report as a baseline for comparison after a future storm.

**Two claims hedged, deliberately — flagged to the user:**
1. **The two-year window.** Filing deadlines are set by BOTH state law and the policy's own notice provision, and they vary. A flat "you have two years" printed in a document a homeowner may act on a year later risks talking someone past their real deadline. Written as "commonly around two years in many states … confirm it rather than assume it."
2. **"You only pay your deductible."** True on replacement-cost policies; NOT true on actual-cash-value, where recoverable depreciation is withheld, and wind/hail deductibles are frequently a percentage of dwelling value rather than a flat sum. Written as the normal case plus a one-line prompt to confirm both details on their policy. The persuasive point survives; the false promise doesn't.

**Also fixed:** "for a architectural asphalt roof" → article now chosen by leading vowel.

**Claimability protocol — NOT RECEIVED.** The user believes they added it. Verified it is not present: `git status` clean, no new commits on origin, nothing new in `docs/`, only upload in the session folder is the July 9 onboarding screenshot. Told the user plainly and gave transfer options. This remains the open blocker on replacing the invented `damageScore()` weights (see #44 finding) with a cited protocol.

**Simulator:** rebuilt the single-file interactive build from the current source; it now boots directly into the new onboarding (the packer clears the persisted onboarding flag). Verified it opens on scene 1 with no app errors — the two NetworkErrors are Supabase calls with no keys baked into a static export, which is expected and harmless for a UI-only simulator.

**Files touched:** `lib/services/haagPdf.ts`, `PROMPT_LOG.md`.

**Verification:** typecheck clean, lint 0 problems. Report re-rendered and screenshotted; no `undefined`/`NaN`; five homeowner paragraphs render with correct branching.

---

### [2026-08-16] #49 — Complete Drive read: master product synthesis committed

**Prompt:**
> I want you ti read everything. Then come up with the best conclusion for how you want to move forward to Great a great app

**What ran:** 9-agent workflow (8 thematic readers + 1 synthesis, ~612K tokens) over the 20+ remaining unread documents in the owner's Drive folder: Pitch Deck FINAL 5.6.26, camera tech architecture, Roofwise Camera prompt, Prompt Master, App prompt/Rork, Professional Report spec, Long Report HAAG prompt, Kanban Mini-PRD, Dashboard Design Spec, three market-research reports, six launch-communications docs, and the Quadrant Deck/Jira/SOW. Every document read successfully; zero agent errors. Combined with the four docs read inline in #47–48, **the entire Drive folder has now been read.**

**Deliverable:** `docs/PRODUCT_SYNTHESIS.md` — new product truths (10–15 min SLA with per-step budgets, swipe gesture semantics incl. up-to-correct + 5-star rating, 19-area tagging, Single-Shingle vs Square modes, Cause-of-Loss enum + per-observation `causation`, carrier-norm 8–12 context vs HAAG thresholds, brittleness photo protocol, Long Report 8-section contract, Insurance 6-section variant, inverted 1–100 Damage Score, ≥0.25" storm floor, <80% review queue, Triple-Check discrepancy rule, SHA-256 report integrity), 22 resolved contradictions with explicit rulings, 8 launch blockers, a repo-verified feature ledger, and a corrected 13-step build priority order.

**One machine error caught before commit:** the synthesis agent marked the HAAG engine "BUILT." Verified against source: `haagThresholds.ts` still has 3-tab at 8 (spec >5) and architectural at 10 (spec >8), and `decisionEngine.ts` has no Claim Viability, no Safety engine, no repairability gates. The committed doc carries the corrected status, and the engine rewrite is priority #2 (after the launch-blocker sweep).

**BACKLOG.md restructured** to the synthesis order: Now = engine rewrite → Claim Viability → Safety → Long/Insurance reports → Claim mode VI–IX → detection hardening → storm validation → capture tagging/modes; new Soon section (score reconciliation, pipeline board, swipe completion, report integrity, speed instrumentation, photo import, color-coding decision); Parked gains the explicit do-not-resurrect v2 list with citations.

**Key rulings recorded (Contradictions section):** Drift Warnings beat every Drive doc where they conflict (5 tabs not sidebar, camera-only not LiDAR, no mocks, tokens not inline hex, gloved-roofer persona); Quadrant's 2–3 photos/square is engineering truth over the deck's 4; storm lookback (map, ≤4yr) is distinct from claim corroboration (2yr max); confidence must never be rendered as accuracy; the Influencer Messaging doc is for a physical shingle product and is excluded from product truth.

**Files touched:** `docs/PRODUCT_SYNTHESIS.md` (new), `BACKLOG.md`, `PROMPT_LOG.md`.

---

### [2026-08-16] #50 — Coordinated 11-agent parallel build: HAAG engine rewrite, claim mode, Long Report, detection hardening, storm validation, web as first-class target

**Prompt:**
> Please use multiple agents do work in coordination at the same time on multiple things.
> I want this to be an app that I will put on android and Apple Store. I also want to be able to use the same program to do the web app as well so that users can use seamlessly across devices.

**How it ran:** one workflow, four phases — 6 builders in parallel with strict disjoint file ownership, then 1 integrator, then 3 verifiers in parallel (engine-vs-spec adversarial audit, drift-compliance diff review, build+headless-browser boot test), then 1 fix agent. 11 agents, ~1.43M tokens, 0 errors. 21 files modified + 7 new, +4,749/−404.

**Decision recorded — web is a first-class target.** Owner directive reverses #38's "web is preview-only" ruling. One Expo codebase now ships three ways: EAS build → App Store + Play Store; `npx expo export --platform web` → hosted web app. BACKLOG "Before ship" updated accordingly.

**What shipped:**
1. **Engine rewrite to spec** (`haagThresholds.ts`, `decisionEngine.ts` + new `claimViability.ts`, `safetyEngine.ts`): corrected thresholds (3-tab >5 → legacy field 6 with ≥ semantics; architectural >8 → 9; wind >5%; wood/metal/tile/TPO rules), §3 repairability gates override counts, §4 tree in exact first-match order, RC = D×U×R×A stored once, §6 claim-viability BAND (never a number), §7 safety engine, §9 output contract incl. adjuster narrative + uncertainties + decision-path trace. All legacy exports preserved as thin wrappers — `damageScore()`/`claimWorthiness()` deprecated, not removed. 30+ behavior assertions passed in a scratchpad smoke test.
2. **Insurance Claim mode** (`types.ts`, `inspectionStore.ts`, `new-job.tsx`): General/Insurance toggle, 7-value Cause-of-Loss, collateral checklist (4 zones, photos per zone), brittleness protocol w/ photo requirement + new `borderline` member reaching the §3 gate, RCV/ACV + deductible + home value + prior claims, code-compliance notes. Storm-protocol fields only for wind/hail causes.
3. **Reports** (`haagPdf.ts` + new `longReport.ts`): 8-section Long Report consuming stored engine output (never recalculates RC); insurance variant w/ test-square table, brittleness narrative, per-finding HAAG rule citations, carrier-norm 8–12 as context only; Triple-Check verdict rendered in Section 03. The 12-section report + homeowner summary untouched.
4. **Detection hardening** (`gemini.ts`, `confidenceTiers.ts`): shingle-as-ruler `shingleScaleEstimate` persisted per photo; `no_roof_detected` anti-fabrication flag + inspector toast; ridge-cap false-positive instruction; `needsExpertReview()` <80% auto-queues to Train via `analyzeSlope.ts`.
5. **Storm validation** (`stormMatch.ts`, `stormWatch.ts`): ≥0.25" published hail floor as exported constant; 4-year lookback explicitly distinct from the 2-year claim-corroboration max; `tripleCheckDateOfLoss()` verdict feeds engine input `weather.event_hours_from_dol` + report.
6. **Web platform** (`Map.web.tsx`, `useResponsive.ts`, `Sidebar/TopBar`, `(tabs)/_layout`, guards on quick-inspection/pitch-gauge/mileage, `app.config.js` static output + favicon + splash fixed to brand white): real Google Maps JS on web behind `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` with the friendly placeholder kept when the key is absent (Drift #5); ≥1100px sidebar shell, phones unchanged; `lib/supabase.ts` noop-storage fix for Node prerender was the one real export blocker.

**Verification cycle:** 13 findings (12 CONFIRMED/actionable) — the standouts: insurance Section C re-derived thresholds from an incomplete observation (could contradict the stored verdict on non-asphalt roofs — fixed by exporting `legacyObservation`); `weather_event_exists` could never be `false` (NO_STORM_DAMAGE unreachable — fixed with new `stormSearchOutcome` field preserving no_match vs unavailable, Drift #5); ±72h check used display-rounded hours (fixed: millisecond-exact `withinWindow72h` threads through); 44pt claim-evidence rows (Drift #1 — raised to 56); unconditional "no scale calibration" sentence now conditional. Two spec-gap resolutions were written INTO docs/HAAG_DECISION_ENGINE.md (§7 sustained-wind>30 UNSAFE; §9 per-slope NOT_TESTED member) so spec and code agree textually. Three low/PLAUSIBLE interpretation questions left documented in code comments (strict-carrier HIGH vs MEDIUM; two-year rule scoped globally vs collateral-only; multi_slope reading) — each a one-line change if the owner reads the spec differently.

**Known caveats (backlogged):** engine result not yet persisted (haagPdf re-evaluates at render); safety rating reads "Use caution" until a real forecast is wired; DOL fallback anchors on the event's own date until claim mode captures a user DOL; <80% gate will queue much more than the old rule; brittleness-photo enforcement needs a finalize step.

**Verification:** typecheck clean, lint 0 problems, `expo export --platform web` green, headless Chromium boot of `/`, `/leads`, `/settings` clean (favicon 404 fixed). Re-run by hand after the workflow: typecheck + lint confirmed clean.

**Files touched:** 21 modified, 7 new (see git show for the list), `BACKLOG.md`, `PROMPT_LOG.md`.

---

### [2026-08-16] #51 — Wave 2: 12-agent parallel build — capture tagging/modes/import, engine-result persistence + report integrity, claim polish, swipe completion, pipeline board, storm-lead clustering

**Prompt:**
> (Wave 2 was self-directed under a standing green light from #50, then paused mid-run and resumed.)
> "Supabase isn't connected bc it's connected to another code workspace nothing Claude. Pause" → "Continue"

**How it ran:** one workflow, five phases — 1 schema agent ALONE (so six builders could not race on `types.ts`), then 6 builders in parallel with disjoint file ownership, then 1 integrator, then 3 adversarial verifiers in parallel, then 1 fix agent. 12 agents, ~1.65M tokens, 696 tool calls, 0 errors, ~73 min. 26 files modified + 4 new, +4,046/−514.

**Pause/resume note:** the first launch was stopped by the owner one agent in. The schema agent had started but never completed, so nothing was written and the tree was clean — this run started fresh rather than resuming. Three script defects were fixed during the pause: (a) `expo-crypto` is not installed, so the hash decision was pre-made (pure-JS, no new dependency — adding one mid-parallel-build would collide on `package.json`); (b) the `Correction` type was located in `types.ts` so the schema agent extends it directly and adds a `swipe_correct` member; (c) a real bug in the workflow script itself — findings were filtered before being paired with their verifier, so one null verifier would have mislabelled which auditor found what.

**What shipped:**
1. **Capture** (`quick-inspection.tsx`, `CameraHUD.tsx`, new `captureSession.ts`): 19-area tagging picker (`AREA_TAGS`), Test Square (10×10) vs Single Shingle mode toggle with **separately aggregated counts**, photo-library import through `prepareCapturedPhoto` (same pipeline, same queue as camera captures). Multi-select is a repeated single-asset loop **on purpose** — native multi-select was root-caused to an uncatchable SIGABRT in Expo Go in #24/#25.
2. **Engine persistence + report integrity** (new `storedEngine.ts`, `reportIntegrity.ts`, `telemetry.ts`): reports now restate a **stored** `HaagEngineResult` instead of re-running `evaluate()` at render. Freshness is decided by a **SHA-256 input fingerprint**, not a timestamp — the Inspection carries no "last analysis change" time, and a fingerprint is strictly stronger. Both report variants carry a tamper-evidence footer; local-only speed instrumentation (no network, Drift #5) records analysis/report timings against the published ≤60s/≤180s targets.
3. **Claim polish** (`new-job.tsx`, `job/[id].tsx`): DOL was **free text** — "around mid-May" was an accepted answer, which silently disabled Triple-Check, the ±72h window, and the report header. Now a structured control (one-tap presets + 64pt MM/DD/YYYY boxes) that rejects impossible dates, shows the matched storm date beside it, and anchors the post-save storm match on the reported DOL rather than `createdAt`. Claim-evidence photos routed through the image pipeline; brittleness finalize gate as informative friction, not a hard block.
4. **Swipe** (`swipe-review.tsx`, `correctionsStore.ts`): gesture remap to Pitch Deck truth — right accept, left reject, **up = correct**, down = skip. Dominant-axis resolution so an up-swipe with drift no longer registers as accept/reject. Five-star confidence prompt after corrections only; `inspectorTrustWeight` stamped neutral (weighting itself is post-raise).
5. **Pipeline board** (`(tabs)/leads.tsx`): 12-column glove-first column-picker (11 live stages + terminal `lost`), one-tap Move sheet, no drag-and-drop. List view is byte-identical behind the toggle (`git diff -w` shows only three removed import lines).
6. **Storm leads** (`stormWatch.ts`, `map.tsx`, `hail-tracer.tsx`, `weather.ts`, `WeatherTile.tsx`): `matchLeadsToStorm()` haversine clustering over already-fetched data (leads without coordinates are skipped, never geocoded or guessed), the "N leads within X mi of the hail core" line on the storm hero with tap-through to Map, both storm surfaces migrated to the 4-year-clamped lookback, and a real forecast wired into `roofer_safety_rating` so it stops defaulting to "Use caution."

**Verification cycle:** 13 findings, 12 CONFIRMED/actionable, **all 12 fixed, none skipped.** The standouts:
- **One broken invariant seen from three directions.** Findings 1/3/8 were all the freeze contract: a finalized report could be silently re-snapshotted by a later re-analysis, so the signed PDF and the stored determination could drift apart. Fixed once, coherently — `setStoredEngineResult` no-ops once `reportFinalizedAt` is set unless forced; only the deliberate re-finalize path forces (and re-stamps in the same action); non-report surfaces read with `honorFreeze:false` so a *proposal* can never quote a pre-edit scope.
- **Drift #5 caught in new code:** the dashboard pipeline mini-Kanban hardcoded `Contacted: 0` / `Proposal: 0` — permanent fabricated placeholders. Now derived from real leads, empty stages omitted, honest empty state.
- The deprecated 0–100 damage score was still printing in the carrier-facing report ("damage score 47 of 100") alongside the new band — removed from narrative, homeowner summary, the `urgent` branch, and the Section 02 stat tile.
- Legacy `proposal_sent` leads would have vanished from the board and the detail-screen chips (raw stage equality vs `leadStageColumn()`).

**Independently verified by hand after the workflow** (not taken on the agents' word): typecheck clean, lint clean, and the pure-JS SHA-256 executed against Node's `crypto` across the 55/56/63/64/65-byte padding boundaries, multibyte UTF-8, emoji surrogate pairs, and a 500KB body — all match. `stripIntegrityFooter(stamp(x)) === x` exactly, and tampering flips `matches` to false. The self-reference trap (hashing content that contains its own hash) is avoided: hash first, inject footer after.

**Not fixed — deliberately.** `assessClaimViability` requires `is_discontinued === true` for the HIGH band, and nothing populates it, so **HIGH is currently unreachable in the field.** `docs/HAAG_DECISION_ENGINE.md` §6 says verbatim "**HIGH** — all of: … Material is discontinued", so the code is a faithful transcription. Per CLAUDE.md the Drive documents win on logic and thresholds — loosening a documented criterion is exactly the drift this repo guards against. Backlogged as an **owner decision**, not patched.

**Behavior changes worth knowing:** storm alerts are now scoped to 25 mi around the service-area centroid instead of state-wide (fixes "Plano gets Amarillo hail" but narrows coverage); Map and Hail Tracer now apply the published validation floors, so hail reports with no recorded size no longer appear; down-swipe is now skip where it used to be up (muscle-memory hazard, same destructiveness as before).

**Supabase:** untouched and not required. The project is administered from a different workspace, so the online report-verification endpoint stays deferred and the footer copy deliberately does **not** promise a verification service that doesn't exist (Drift #5). The local hash stands alone.

**Nothing was run on a device or a simulator** — no agent could, and neither could I. Typecheck, lint, the web export, and the hash test are the full extent of verification.

**Files touched:** 26 modified, 4 new (`captureSession.ts`, `reportIntegrity.ts`, `storedEngine.ts`, `telemetry.ts`), `BACKLOG.md`, `PROMPT_LOG.md`.

---

### [2026-08-17] #52 — iOS × Instagram UI redesign: 11-agent visual refresh with screenshot-verified density pass

**Prompt:**
> Improve the app UI design. It looks like AI. Think Apple IOS style and Instagram. I want animations too.
> There is a lot of white space that makes the app look empty
> Approved

**Design direction (written as the contract before any agent ran — scratchpad `design-spec.md`, preserved in this entry's key rulings):** What read "AI" was shape and weight, not palette: pill-everything, giant orange FAB circles, the floating navy pill tab bar, saturated CTA blobs, zero motion. The direction: iOS grouped ground (#F6F6FA) with white inset cards + hairlines; orange demoted to ONE moment per screen; edge-to-edge translucent tab bar with thin outline icons; iOS-17 segmented controls (grey track, spring-sliding white thumb); spring physics everywhere (motion.snappy {1,20,280}); pills demoted to elements ≤36pt. "Instagram" interpreted as chrome restraint + motion quality, NOT gradients on a roofing CRM. Glove rules survive the restyle: ≥56pt targets, near-ink text.

**Mid-flight owner feedback became a first-class requirement:** "too much white space" → the Density section. Two causes, two fixes, zero fake data (Drift #5 absolute): (a) zero-state voids became structured honest content — Home now renders a "Get set up" checklist (4 rows with done-state read from real stores, each routing to the real screen) + "What RoofWise does" cells; empty lists are compact top-anchored panels, never a centered line in a void; (b) vertical rhythm tightened, content fills the first viewport at 390×844 on every tab root.

**How it ran:** foundation agent ALONE (tokens add-only + BottomTabs + ScreenHeader + PressableScale + ToastHost), then 6 parallel screen builders with disjoint files (home / leads / map-plan-train / settings-auth / flows / detail), integrator, then two verifiers — one of them a **visual auditor that served the export, screenshotted every screen at 390×844, and READ the images**, judging against the spec + the before-gallery — then a fix agent. 11 agents, ~1.42M tokens, 0 errors. First launch aborted on a harness fault (permission handler stripped every tool call's parameters — zero work, clean tree); relaunch ran clean.

**What shipped (36 files, +4,627/−2,685):** retuned ground and shadows; new tab bar with spring icon pop; iOS large-title headers ("Up early." — the dangling "there" greeting bug is dead); quiet white stat cells with tabular-nums; one-orange-moment discipline (Quick Inspection on Home, Generate Report on Job, sticky CTA on New Job); iOS-17 segmented controls on Leads/auth/capture; Instagram-clean 64pt lead cells with initial discs; restyled pipeline board with grabber-bar Move sheet; true iOS grouped Settings with footers; swipe-review card stack with depth (next card peeks at 0.95) and spring-pop stars; thin ink progress bar on the wizard; glass-token camera chrome; storm hero restyled (still hides with no alert — Drift #4); the old "No X yet" void cards deleted.

**Verification:** build-boot verifier passed with ZERO findings (typecheck, lint, export, headless boot of 10 routes — no crashes, no console errors). Visual auditor filed 5 findings from actual screenshots; fix agent applied 4 and REFUTED 1 by pixel-measuring the screenshot (the "Knock mode pill" was already radius-14 — corner geometry matched exactly). Fixed: the never-resolving weather skeleton (now gated on an actual in-flight fetch; permission/GPS phases render nothing — the spec's "real module or nothing" rule); pipeline empty state got the List view's panel language + action; the disabled wizard CTA's compositing seam (root-caused to element-level opacity creating a second layer; replaced with a flat colors.accentDisabled token fill, pixel-verified one uniform run); map web fallback top-anchored under the chip rows.

**Caught by hand after the workflow:** Settings hardcoded "Supabase — Connected (auth + storage)" — a fabricated status indicator (pre-existing, not introduced by the restyle; it was also BACKLOG's #35 item). Now honest: reads `isSupabaseConfigured`, renders "Cloud sync — Not configured — data stays on this device" when unset, matching the Gemini row's pattern.

**Integrator notes worth keeping:** lineHeight numeric literals (18/22) match pre-existing repo practice — no lineHeight token exists (BACKLOG candidate); segmented control / Rise entrance / MiniSwitch are duplicated file-locally because builders couldn't share new files — hoisting to components/ is backlogged; deliberate design divergences flagged for owner review: leads rows dropped the per-row Convert button (flow lives in lead detail now) and the Source meta line; tab labels use fontSize.caption (11) not the spec's 10 (no 10pt token — Drift #11 wins).

**Verification by hand:** typecheck clean, lint clean, web export green, single-file bundle boots and navigates under artifact conditions, before/after galleries captured. Artifact republished at the same URL. **Nothing was run on a device** — animations (springs, segmented thumbs, card stack) are the least web-verifiable part of this wave; the device pass gains a "does motion feel iOS" item.

**Files touched:** 37 modified (see git show), `PROMPT_LOG.md`, `BACKLOG.md`.

---

### [2026-08-17] #53 — Cinematic redesign: the onboarding's visual language promoted into the app, weather hero, crafted content

**Prompt:**
> "So this is correct but I really don't like it. It's too plain. A previous design is attached. Keep the same layout we have but use this attached as inspiration. Also I do want the front page to have a big weather thing like the attached. But you gotta definitely make this look like an award winning apple app. It needs to feel and look like a modern app. Right now it looks like an Apple menu in settings. Not good. I like the onboarding hi. That branding and style needs to be incorporated bc right now the app isn't congruent with the onboarding."
> Follow-up: "This is using way too many tokens. Can I use sonnet for this redesign?"

**The diagnosis.** #52 fixed "looks like AI" by running at iOS **Settings** — the most utilitarian, least expressive pattern Apple ships. Correct and boring. The owner's second point was the sharper one: `app/onboarding.tsx` is the best surface in the product, and **its design system already existed as unused components** — `components/glass/{Aurora,GlassCard}.tsx` and the radar art in `components/onboarding/scenes.tsx`. The app imported none of them. The fix was promoting a system already owned, not inventing one. Also corrected a factual error in #52's spec: `expo-blur`, `expo-linear-gradient`, `react-native-svg`, and `expo-image` are ALL installed — #52 told its agents blur was unavailable, which is part of why everything came out flat.

**Direction — "cinematic hero, crafted content"** (`scratchpad/design-spec-v2.md`): each screen opens with one deep branded moment in the onboarding's language, then flows into content that is *crafted* (colored icon chips, big tabular numbers, progress bars, real imagery, data-viz) rather than plain. Accent hierarchy restored with intent: **royal = primary interactive** (FAB, buttons, links — matching the owner's reference), **burnt = urgency and capture** (storm, Quick Inspection).

**Two principled calls, surfaced to the owner rather than made silently:**
1. **No stock photography.** The reference leans on stock for the storm hero and job cards. We have none licensed, and faking field photos in a product whose entire pitch is evidentiary integrity is a bad trade. Hero imagery is *drawn* (layered gradients + SVG radar, reusing the onboarding motif); job cards use the user's own inspection photos.
2. **The weather hero always renders; the storm ALERT still does not.** Drift #4 forbids a stale storm hero. Resolution: live weather always (real data), escalating to alert treatment only with a real active alert, collapsing to a compact "Weather not available" cell when unreachable. The owner gets the big weather thing; the app never invents a storm.

**Model split (owner's token concern).** Caught at 0.2MB spent, stopped and relaunched: the five screen builders + build verifier on **Sonnet** (~65% of a wave's tokens, and the spec was detailed enough that their work was mechanical); foundation, the weather hero (design invention), integration, visual audit, and fixes stayed on the stronger model.

**What shipped:** gradient token sets + `shadows.hero/raised` + contrast-checked tile grounds (every pair WCAG-verified 5.5–8.4:1); `GlassCard` extended with `onArt`/`glow` so glass stays legible over gradients; six new primitives (`IconChip`, `StatCard`, `RichCard`, `SectionHeader`, `ProgressBar`, `Pill`); `WeatherHero` + `RadarArt`; and crafted passes over Home, Leads, Job detail, Map/Plan/Train, and Settings.

**Verification — the visual auditor earned its keep.** Build-boot passed with ZERO findings. The visual auditor filed **9**, and was appropriately brutal: *"Home has no weather hero and no cinematic moment of any kind"*, *"Congruence failure — the owner's explicit complaint is unresolved"*, *"Plan is the purest 'Apple Settings menu' screen in the app"*. All 9 fixed, plus one the fix agent found itself. Highlights: WeatherHero's `pending` phase never terminated so Home rendered an empty hero slot; the disabled sticky CTA measured **1.9:1 contrast** while looking like a live button; Leads' hero was gated on `leads.length > 0` so it was missing in exactly the state a new user opens it in; and Settings' AI Calibration group asserted a healthy synced state for a backend that does not exist — contradicting its own Integrations row.

**Caught by hand after the workflow:** the weather hero burned a 4s pending window and prompted for GPS even with no weather key configured. Added `isWeatherConfigured` to `lib/env.ts` and short-circuited — it now says "Weather not available" immediately and never asks a roofer for location access the app cannot act on. Also removed a dead `RichCard` import a Sonnet builder left in `leads.tsx` (the only lint casualty of the model switch).

**Verification by hand:** typecheck clean, lint clean, web export green, single-file bundle boots and navigates under artifact conditions, gallery captured, artifact republished at the same URL. **Preview caveat:** with no weather key in the build container the hero collapses to its honest fallback, so the preview *undersells* the headline feature — on a device with a key it renders the full radar hero. **Nothing was run on a device.**

**Files touched:** 40 modified/new (see git show), `PROMPT_LOG.md`, `BACKLOG.md`.

---

### [2026-09-01] #54 — Home: always-cinematic animated weather hero + live storm map; the keys problem named; preview keyed

**Prompt:**
> "i want the front to show a map and the weather like the attached and i want the weather to be animated and the map to be a google map that has functionaity for storm data tracking"
> then: "you built this so why is there is no .env.local in this project at all" · "the live link isnt suffiencent. how do i actually use the app"

**The root fact this wave surfaced:** the build container has **no `.env.local` and zero API keys** — by design (gitignored secrets never travel with the repo, and the container is re-cloned every session). Every preview the owner had ever seen was keyless, which is why weather said "not available" and the map card (gated on geocoded leads) never appeared. Two consequences were acted on: (1) the modules were rebuilt so missing data changes the TEXT, never the DESIGN; (2) the owner supplied a Google key **website-restricted to `https://claude.ai/*`** and it now lives in this container's `.env.local` (gitignored; verified absent from every diff). NOAA storm data needs no key at all, so storm tracking works keyless — only the basemap tiles are gated.

**How it ran:** 2 builders in parallel (weather hero, storm map card) → integrator → 2 verifiers (visual audit of the keyless state, build boot) → fix. 6 agents, ~937K tokens, 0 errors. The first launch died on the same transient permission-handler fault seen in #52 (every subagent tool call had its parameters stripped; all three agents correctly refused to fabricate a result; the repo was untouched); the retry ran clean.

**What shipped:**
1. `WeatherHero` + `weather/RadarArt` — a 224pt cinematic frame in every state: aurora wash (card-sized port of the onboarding aurora), radar rings + sweep with a ring pulse, precipitation streaks ONLY when a real reading reports precipitation, temperature count-up, spring entrance, optional scroll parallax. State C (unavailable) keeps the full frame with a frosted glyph where the number would be, a "Weather not available" headline, one true cause line, and a 56pt route to the fix. `isWeatherConfigured` is checked in the state initializer so a keyless build paints state C on the first frame and never prompts for location. A latent sweep bug (loop restarting mid-value, skipping ~40° per revolution) was fixed in passing.
2. `home/AreaActivityCard` — always-rendered ~200pt Google map on Home with a **Leads | Storms** segmented toggle, NOAA hail/wind pins over the 4-year clamped lookback (validation floors honored, 300-pin cap with an honest count line), lead pins by stage with storm-matched leads highlighted, and a glass insight overlay carrying the real `matchLeadsToStorm` line. Three designed states: no Maps key (data drawn over a branded ground, one honest line to Settings), no service area (CTA), no qualifying storms (a true statement).
3. Integrator caught two Drift #5 honesty defects that only appeared once both modules were mounted together, and fixed them.

**Verification:** build-boot clean (0 findings). Visual auditor filed 5, all fixed: the map was **100% below the fold** on a 390×844 phone — the owner asked for "map AND weather" on the front — so the three all-zero stat cards moved below the map (map top y=642, was 794); the Leads|Storms segment measured **36pt** (Drift #1 → 56pt); the FAB overlapped the Storms segment (resolved by the fold fix); the fresh keyless map drew no storm data until a service area existed (now a CTA inside the frame); "No weather API key in this build" was developer vocabulary shown to a roofer (now "Weather isn't set up yet"). Checkpoint `e0d34cb` was pushed mid-wave (integrator gates green, stop-hook discipline) before the fix stage landed.

**The distribution problem, finally stated plainly.** The App Store's Expo Go runs **SDK 54**; this project is on **51** → Expo Go refuses it today. The container **cannot** tunnel a dev server (ngrok blocked by network policy). The container **can** reach Expo's cloud (api.expo.dev / u.expo.dev respond). Chosen path: **upgrade to SDK 54** (scouted against expo.dev changelogs: New Architecture mandatory for Expo Go 52+, Reanimated 4 + worklets, expo-router 6, expo-av → expo-audio, expo-file-system `/legacy`, splash → plugin; spec at `scratchpad/spec-sdk54-upgrade.md`), then **EAS Update** so the owner installs nothing but Expo Go. Needs from the owner: an Expo access token and a phone-usable Google key (the claude.ai-restricted key rejects requests with no browser referrer). `Map.tsx` already falls back to Apple Maps inside Expo Go on iOS. TestFlight (Apple Developer, $99) remains the "real icon + Google Maps" path and works even on SDK 51.

**Files touched:** `app/(tabs)/index.tsx`, `components/WeatherHero.tsx`, `components/weather/RadarArt.tsx`, `components/home/AreaActivityCard.tsx` (new), `BACKLOG.md`, `PROMPT_LOG.md`.

---

### [2026-09-01] #55 — Platform migration: Expo SDK 51 → 54 (New Architecture, Reanimated 4, expo-router 6, expo-audio)

**Prompt:**
> "ok" (approving: "let me upgrade the project to the current Expo SDK first … reopens the free Expo Go route")

**Why 54, not 57 (current).** Verified against the App Store listing and expo.dev changelogs: the store build of Expo Go is **54.0.2 and supports SDK 54 only**; SDK 55/56/57 Expo Go builds ship via `eas go` (paid Apple Developer) or sign.expo.dev (7-day re-sign). The owner wants the app on an iPhone with nothing installed but Expo Go, so 54 is the target that works today. It is also the last SDK with a Legacy-Architecture escape hatch and the last shipping `expo-av` — the lowest-risk landing from 51. The 54→57 hop was pre-cleared in this wave (new-arch on, expo-av gone, `@react-navigation/native` import gone) so it is one `expo install --fix` plus the expo-router 56 codemod.

**How it ran:** 1 upgrader (sequential by nature — one dependency graph) → 3 parallel verifiers (toolchain re-run, web boot + before/after screenshots + artifact bundler, source-level Reanimated-4/React-19 audit) → fix. 5 agents, ~593K tokens, 0 errors. Checkpoint `f74a938` was pushed the moment the upgrader's five gates went green (a `Monitor` on the workflow journal woke this session for it), before verification — stop-hook discipline without committing an unverified lockfile.

**What changed:** RN 0.74 → **0.81.5**, React 18.2 → **19.1**, expo-router 3.5 → **6.0.24**, Reanimated 3.10 → **4.1** + `react-native-worklets`, react-native-maps 1.14 → 1.20.1, async-storage 1.23.1 → 2.2.0; `newArchEnabled: true`, iOS deployment target 15.1, `splash` → `expo-splash-screen` plugin; ESLint → flat config (eslint-config-expo 10); `VoiceNoteRecorder` rewritten from `expo-av` to **`expo-audio`** (same props/UI); `expo-file-system` → `/legacy` imports (4 files); `pushNotifications` triggers gained the now-required `type`; `Map.tsx` `useIsFocused` → expo-router `useFocusEffect` (seeded from `useNavigation().isFocused()` so an already-focused host still mounts the MapView on first commit). The 10 `useLocalSearchParams<T>` sites compiled unchanged — router 6 kept that generic; the removed ones were on `Href`/`useRouter`, unused here.

**Two real finds.** (1) The web export succeeded but every route crashed on boot with `Cannot use 'import.meta' outside a module` — traced to **zustand 4.5's ESM build** (`import.meta.env.MODE`) being selected on web by Metro's now-default `package.json:exports`. Fixed with a **zustand-scoped** `resolveRequest` override in `metro.config.js`, not the global `unstable_enablePackageExports: false` hatch; Supabase and url-polyfill needed nothing. (2) The runtime audit found the storm-history effect in `AreaActivityCard` was **not re-run-safe** under React 19 StrictMode (a cancelled first run stranded the row on "Checking…"), and `WeatherHero.resolve()` shared one cancel ref across runs so a re-run un-cancelled the first round trip — both fixed (guard cleared on cleanup; per-invocation run token). Also fixed: a leaked Supabase auth listener in `_layout.tsx`, deprecated Reanimated `Layout` → `LinearTransition`.

**Gates (re-run by hand after the workflow):** `expo-doctor` 18/18, `expo install --check` up to date, typecheck clean, lint clean, web export green, headless boot of `/`, `/leads`, `/map`, `/settings` with no page errors, artifact bundler still produces a bootable page.

**Not verified:** the native runtime. Only the web export was booted. The New Architecture is on and every native module passed expo-doctor's directory check, but Expo Go on a real iPhone is the true test for maps 1.20, camera 17, sensors 15, expo-audio, and Reanimated 4 — which is exactly what the next step (EAS Update → Expo Go) delivers.

**Files touched:** `package.json`, `package-lock.json`, `app.config.js`, `babel.config.js`, `metro.config.js`, `eslint.config.js` (+ `.eslintrc.js` removed), `app/_layout.tsx`, `components/{VoiceNoteRecorder,ToastHost,WeatherHero}.tsx`, `components/home/AreaActivityCard.tsx`, `components/map/{Map,Map.web}.tsx`, `components/onboarding/scenes.tsx`, `lib/services/{analyzeSlope,backup,photoQuality,pushNotifications,transcribeAudio}.ts`, `CLAUDE.md` (Stack line, native-module list, AsyncStorage note), `BACKLOG.md`, `PROMPT_LOG.md`.

---

### [2026-09-01] #56 — Distribution: EAS Update into Expo Go; keys live on EAS, not in the repo

**Prompt:**
> Owner supplied an Expo access token, a phone-usable Google key, and an AI Studio key after: "the live link isnt suffiencent. how do i actually use the app"

**Path chosen and why.** The container cannot tunnel a dev server (ngrok blocked) but CAN reach Expo's cloud, so the zero-install path is **EAS Update → Expo Go**: the JS bundle is published to Expo's servers and Expo Go on the owner's iPhone loads it. Requires SDK 54 (#55) because the App Store's Expo Go runs exactly that.

**Wiring:** `expo-updates` installed; `eas project:init --account roofwise` created project `b1fdcacc-a354-499a-842c-0f5ce6fa2e68` but cannot write a dynamic config, so `owner`, `updates.url`, `runtimeVersion: { policy: 'sdkVersion' }` and `extra.eas.projectId` were added to `app.config.js` by hand. **`sdkVersion` is the only policy Expo Go can see** — it identifies its runtime as `exposdk:54.0.0`. Phone keys (Maps/Weather/Geocoding, Gemini, model) were registered in the EAS **`preview` environment** as `sensitive` project-scoped variables; the web preview's separate, site-restricted key stays in the gitignored `.env.local`.

**Two mistakes caught by verification, not by luck.** (1) The first `env:create` loop fed the key file to `npx` on stdin, which swallowed every line after the first — the variables silently did not exist, and the first published update (group `c33101ef`) shipped **with no keys**. Caught because `eas env:pull` to a scratchpad file returned nothing. Re-created stdin-safe (`</dev/null`), verified by pulling all 5 back. (2) Local `.env.local` (web key) is loaded by `expo export` during `eas update`; to guarantee only the EAS environment reaches the phone bundle it is moved out of the repo for the duration of the publish and restored by a trap — and a local iOS export against the pulled env is grepped for the phone key *and the absence of the web key* before every publish.

**eas-cli 23.2 gotchas recorded:** `env:list` has no `--non-interactive`; `env:exec` takes the environment positionally, not `--environment`; `env:pull --path` is the reliable way to inspect sensitive values from a script.

**Owner's steps, in full:** install Expo Go, sign in as `roofwise`, open the project (or scan the update's QR from the EAS dashboard). Expo Go on iOS uses Apple Maps (handled in `Map.tsx`); TestFlight remains the Google-Maps/real-icon path.

**Secrets hygiene:** the Expo token (Admin) and three keys were pasted in chat → all flagged for rotation after the first successful device run. Stored only under the session scratchpad with mode 600; verified absent from every commit diff.

**Files touched:** `app.config.js`, `package.json`, `package-lock.json`, `BACKLOG.md`, `PROMPT_LOG.md`.

---

### [2026-09-01] #57 — Standing trigger: Apple Developer account → TestFlight + native capabilities, automatically

**Prompt:**
> "Don't forget to do this automatically when I add the apple developer account: Full background tracking like SalesRabbit needs the real build — the TestFlight path, which I can do the moment there's an Apple Developer account."

**Recorded as a durable instruction, not a note.** The container is ephemeral and context gets summarized, so the directive lives in three places any future session reads first: the top of `BACKLOG.md` "Now" as a **⚡ STANDING TRIGGER** with the exact automated sequence, a pointer in `CLAUDE.md`'s "Known parked items" (so nobody treats background location / Google Maps on iOS / Apple Sign In / geofenced mileage / AR-LiDAR as still parked once the account exists), and this entry. `eas.json` added now with `preview` / `production` build profiles, channels, and environments so the trigger is executable with one command the day the credentials arrive.

**What the owner supplies, once:** Apple Team ID and an App Store Connect API key (Issuer ID, Key ID, .p8, App Manager role), uploaded on expo.dev → roofwise → Credentials or handed over. **What then happens without being asked:** remote credentials, background location + task manager wired into door-knocking trip tracking (the "pauses when you switch apps" copy removed), `PROVIDER_GOOGLE` on iOS, geofenced mileage, Apple Sign In, real push, `eas build --platform ios --profile production --auto-submit` → TestFlight, owner invited as internal tester, then the ARKit/LiDAR native module behind the capture-settings buttons.

**Files touched:** `BACKLOG.md`, `CLAUDE.md`, `eas.json` (new), `PROMPT_LOG.md`.

---

### [2026-09-02] #58 — First device run triage: NOAA storm history was a hard 422, Hail Tracer's Google-only heatmap, tab-shell stacking, wind units, expo-audio session

**Prompt:**
> Owner, first run of the SDK 54 bundle in Expo Go on a real iPhone: "the app keeps crashing and many of the buttons dont open new windows", "the app crashes when 'map' is pressed", "noaa storm history is unavailable on the app". Fix lead applying the confirmed audit findings; diagnostics builder owns `components/ErrorBoundary.tsx`, `app/settings/diagnostics.tsx`, `lib/services/diagnostics.ts`, `app/(tabs)/settings.tsx` (untouched here).

**Intent / Goal:**
- Make NOAA storm history actually load on the phone; make Hail Tracer not throw on Apple Maps; stop tab shells stacking on the root stack; honest "unavailable" vs "no storms" everywhere; 3-year (36-month) default window for hail AND wind with the 4-year clamp intact.

**What was actually wrong (traced, verified live with curl 2026-09-02):**
- `lib/noaa.ts` called `cgi-bin/request/gis/lsr.py?fmt=geojson&sts=YYYY-MM-DDTHH:MM…&state=TX&type=H&type=W`. IEM now answers **HTTP 422** on three counts: `fmt=geojson` is no longer accepted (`^(csv|kml|excel|shp)$`), `sts`/`ets` must be timezone-aware, and the `type=` filter returns 0 rows (and `W` is LANDSPOUT there anyway). `fetchStormHistory` threw on every call → `{status:'unavailable'}` on Home, Map, Hail Tracer, Storm Watch, New Job storm match. Not device-specific: it fails identically from the container; the web export never asserted on storm data so it was masked.
- Two further parser bugs would have dropped every row even after the endpoint fix: `props.type` is a one-letter code on every live IEM GeoJSON service (`'H'`, `'G'`, `'D'`…) and `classify()` read it before `typetext` (so `'H'.includes('HAIL')` → null → dropped); and wind magnitudes are MPH (`unit:'MPH'`; a remark reading "measured 52 kts" carries magnitude 60) while the whole layer assumed knots — 50.4 "kt" floor applied to mph values, `* 1.15078` inflation on reports/alerts, "kt" labels.
- Hail Tracer rendered `<MapHeatmap>` under the Apple Maps provider; react-native-maps has no `AIRMapHeatmap` (only `AIRGoogleMapHeatmap`), so the first hail event would throw "View config not found" in render → ErrorBoundary card. Only hidden because the 422 delivered zero events.
- Home tab href was `'/'`, which expo-router 6 resolves to the root redirect (`app/index.tsx`) — each Home tap pushed a blank screen that REPLACEd itself with a fresh `(tabs)` shell (double slide, shells accumulate). Root-level screens `push`/`replace`-ing `'/(tabs)/…'` stacked more shells. `(tabs)/_layout` is a `<Slot/>` (a StackRouter), so re-tapping the active tab pushed a duplicate.
- expo-audio: mic permission prompted on Job Detail mount; session left in Record category after `stop()` → playback to the earpiece.

**Decisions:**
- **Endpoint:** per-point `api/1/nws/lsrs_by_point.geojson?lon&lat&radius_miles&begints&endts` for every lat/lng caller (map, Hail Tracer, Home card, `matchStorm`) — ~0.3 MB/yr at 50 mi, no cap observed (14,221 features at 200 mi/4 yr returned whole). Statewide `geojson/lsr.geojson?sts&ets&states=XX` only for Storm Watch's 24 h scan (~100 KB) with a **10,000-feature truncation guard** that throws (a capped map that looks complete violates Drift #5). `FetchOpts.near` selects the service. Timestamps `…T HH:MMZ`. Client-side classification on the code first (`H` hail; `G/D/N/O/A` wind; `W` excluded). AbortController 20 s bound mapped to the same thrown-error path. `User-Agent` header actually sent now (it was defined in env and never used); `lib/env.ts` `pick()` trims and the fallback is `RoofWise/1.0 (iOS; contact@roofwise.app)`.
- **Units:** `WIND_VALIDATION_FLOOR_KNOTS = 50.4` → `WIND_VALIDATION_FLOOR_MPH = 58` (the NWS criterion the comment already cited); every `* 1.15078` removed (stormMatch, stormWatch, hail-tracer filter); labels "mph"; `severityColor` wind bands converted 75/60/50 kt → 86/69/58 mph. `StormEvent.magnitude` documented as MPH for wind; knots normalised defensively if IEM ever sends `KT`.
- **Window:** `HISTORY_LOOKBACK_YEARS_DEFAULT` 4 → **3**; Map tab default 3 with chips 1/2/3/4; Hail Tracer gains "Past 36 months" as the default; Home card uses the default (3) rather than the 4-year max, which with the per-point service fits its 12 s bound. `HISTORY_LOOKBACK_YEARS_MAX = 4` unchanged.
- **Heatmap:** `components/map/Map.tsx` exports `MAP_SUPPORTS_HEATMAP = android || (PROVIDER_GOOGLE && UIManager.hasViewManagerConfig('AIRGoogleMapHeatmap'))` — the native-registration check react-native-maps itself uses for `googleMapIsInstalled`, not the provider constant (a dev build requesting Google without AirGoogleMaps linked would otherwise render `<undefined>`). `MapHeatmap` returns null when unsupported so no caller can crash by accident; Hail Tracer draws `MapCircle` swaths (400 m + 600 m/inch, 2 km cap, ≤200) with two new translucent tokens `colors.stormHailFill/stormSevereFill`. `Map.web.tsx` mirrors the export.
- **Navigation:** Home href `'/(tabs)'`; `BottomTabs` skips a tap on the active tab and uses `router.navigate` (pops back to an existing instance rather than pushing a duplicate); root-level "go to tab" pushes → `router.navigate` (search, hail-tracer cluster card, notification tap in `_layout`); "done, go home" `replace('/(tabs)…')` → `router.dismissTo` (POP_TO: pops to the existing shell; when none exists RN7 pops-and-adds, i.e. today's replace semantics) in new-lead, storm-alert, job delete, new-job, welcome. `<Slot/>` → `<Tabs>` NOT done (redesign; backlogged).
- **Honest states:** Map tab stat line reads "Storm pins withheld — NOAA history unavailable" / "Checking NOAA storm reports" instead of "No validated storm events" over a failed request; Hail Tracer subtitle likewise. Home card and New Job already distinguished the two.
- **expo-audio:** `getRecordingPermissionsAsync` on mount (no prompt); `requestRecordingPermissionsAsync` on first Record tap; `setAudioModeAsync({allowsRecording:false})` after stop and before play.
- Every fix carries a comment naming the failure it prevents so it cannot be "simplified" away.

**Verification (container — no device):** `npm run typecheck` and `npm run lint` clean. `lib/noaa.ts` transpiled and run against captured live payloads with `fetch` stubbed: point API 3 yr / 50 mi Dallas → 750 hail + 426 wind (140 G + 255 D + 18 N + 13 O), 145 gusts ≥ 58 mph, 0 unparsable dates, UA header present; statewide 24 h TX parses; 10,000-feature payload throws the truncation error; abort → "timed out"; 422 → thrown. The exact URLs the app now builds return 200 (0.97 MB / 1.4 s and 100 KB / 0.8 s).

**Files touched:** `lib/noaa.ts`, `lib/env.ts`, `lib/services/{stormMatch,stormWatch}.ts`, `components/map/{Map,Map.web,types}.tsx`, `app/hail-tracer.tsx`, `app/(tabs)/map.tsx`, `components/home/AreaActivityCard.tsx`, `components/shell/{navItems,BottomTabs,Sidebar,TopBar}.tsx`, `app/{search,new-lead,new-job,welcome,_layout}.tsx`, `app/job/[id].tsx`, `app/storm-alert/[id].tsx`, `components/VoiceNoteRecorder.tsx`, `theme/tokens.ts`, `.env.local.example`, `BACKLOG.md`, `PROMPT_LOG.md`.

**Follow-ups:** see BACKLOG.md (#58 items): re-test on device; `(tabs)` Slot → real `<Tabs>`; surface `D` (wind damage, no gust) reports; owner call on `N`/`A` non-thunderstorm wind counting; `severityColor` inline hex; delete dead `StormHistoryMap`.

---

### [2026-09-02] #59 — Integrate + verify #58: crash diagnostics wired at the root, gates green, headless boot of every tab

**Prompt:**
> Integrate the two parallel #58 work streams (crash fixes + diagnostics surface), apply the diagnostics call-site notes, run every gate, boot the web export headlessly across every tab and the new screens, and regression-read each crash fix for minimality, its "prevents X" comment, and any fabricated storm/weather state.

**Intent / Goal:**
- Turn the diagnostics module from "built" into "recording": until `install()` runs and `<DiagnosticsGate/>` is mounted, only ErrorBoundary catches were captured — background JS errors, unhandled rejections and `console.error` (the shapes a "keeps crashing" boot produces) were not.
- Prove the integrated tree boots and navigates with zero page/console errors before it goes back to the phone.

**Decisions:**
- `app/_layout.tsx`: `installDiagnostics()` is called at **module level**, before `RootLayout`'s first render — a throw during that render is exactly the crash the recorder exists for, and a call inside the component body would run after it. `<DiagnosticsGate/>` is the first child inside `<ErrorBoundary>`, inside the router tree, so every entry after the first pathname is route-tagged.
- `lib/services/diagnostics.ts`: `expo-updates` is now `require`d lazily inside `readUpdateInfo()` under try/catch instead of imported at the top. `expo-updates/build/ExpoUpdates.js` calls `requireNativeModule('ExpoUpdates')` at import time, which throws when the native module is absent; the crash recorder must never be the module that crashes boot. (Expo Go SDK 54 does ship the module, so this is defence, not a traced failure.)
- `lib/noaa.ts`: a feature with no `valid`/`utc_valid` timestamp is now **dropped**, not stamped `new Date().toISOString()` (pre-#58 fallback that survived the rewrite). An invented "now" would pass the HAAG two-year corroboration window and the Storm Watch 24 h scan on a storm of unknown age — Drift #5. Live payloads carry 0 such rows, so counts are unchanged.
- Library claims in the #58 fixes were read at source rather than trusted: `react-native-maps/lib/decorateMapComponent.js:29` computes `googleMapIsInstalled` with the same `UIManager.hasViewManagerConfig(...)` call `MAP_SUPPORTS_HEATMAP` uses; `@react-navigation/routers` `StackRouter` `POP_TO` matches by route name (no `getId` registered) and, when the name is absent, replaces the current route (`routes.slice(0, currentIndex).concat(route)`) — i.e. `dismissTo` behaves as `replace` when no shell exists, as the fix comments claim; `@react-navigation/core` `useNavigationBuilder.js:378` consumes a fresh `params.screen` on an already-mounted nested navigator, so `dismissTo('/(tabs)/leads')` both pops to the existing shell and switches it to Leads.
- Nothing new deferred; BACKLOG unchanged from #58.

**Verification (container — no device):**
- `npx expo-doctor` 18/18 · `npx expo install --check` up to date · `npm run typecheck` clean · `npm run lint` clean · `npx expo export --platform web` succeeds (then `dist/` deleted).
- Headless Chromium (390×844) against the export: `/` → onboarding → Skip → "Explore without an account" → Home; each of Leads / Map / Plan / Train / Home tapped via the real `BottomTabs` (`role=tab`), plus a repeat Map→Home cycle; direct loads of `/settings`, `/settings/diagnostics`, `/new-job`, `/hail-tracer`; Settings → Diagnostics row push. **0 pageerrors, 0 console errors** (only the expected keyless-network noise). Map tab and Hail Tracer render the honest "Checking NOAA storm reports" state, never a count, with no service reachable from the sandboxed page.
- Diagnostics wiring probe: a `console.error(...)` and an unhandled `Promise.reject(...)` fired on `/hail-tracer` both appear on `/settings/diagnostics` after a full reload, kinds `console.error` / `Promise rejection`, route `/hail-tracer`, stack attached — install(), the ring buffer, AsyncStorage persistence and route tagging all confirmed on web.
- `lib/noaa.ts` re-run through the captured-payload harness after the timestamp change: per-point 3 yr / 50 mi Dallas → 750 hail + 426 wind, 145 gusts ≥ 58 mph, 0 bad dates; statewide 24 h TX parses; truncation guard, 20 s abort and 422 paths all still throw.
- Regression read of every #58 file: each fix is scoped to the traced failure and carries a comment naming it; no synthesized storm, weather, or diagnostics data anywhere — every empty/failed state renders as its own honest string.

**Not verifiable here (needs the phone):** whether Expo Go still exits on the Map tab (the AIRMapManager / `insertReactSubview` hypotheses in BACKLOG #58 need a crash log); the Hermes `enablePromiseRejectionTracker` hook firing for a real native rejection; Apple Maps `MapCircle` swath density; expo-audio session routing; `dismissTo` on a native stack.

**Files touched:** `app/_layout.tsx`, `lib/services/diagnostics.ts`, `lib/noaa.ts`, `PROMPT_LOG.md`.

**Follow-ups:** none new — publish a fresh EAS Update and run the BACKLOG #58 device re-test list; the diagnostics screen (Settings → Diagnostics → Copy all) is now the way to report what the phone sees.

---

### [2026-09-02] #60 — Photo analysis restored (2.5-pro retired), capture UI + Live overlay + honest AR/LiDAR buttons, Google imagery in Expo Go, real Tabs navigator; crash log decoded

**Prompt:**
> "The photo analysis isn't working. Be sure that it's using Gemini flash 3.7 or the newest version to analyze the damage. Also, improve the photo UI. Also add lidar and augmented reality, and also add realtime overlay of damage — add these as settings via buttons in the photo screen." · "I'd rather the map feature be Google Maps than Apple Maps." · "i added the api's" · the owner's Expo Go `.ips` crash log.

**Root cause of "analysis isn't working" (verified live):** `gemini-2.5-pro` returns **HTTP 404 "no longer available to new users"** for the owner's key — every analysis failed. Drift #9 said 3.x Flash "does not exist"; the live model list shows `gemini-3-flash-preview … gemini-3.8-flash`. Owner directive + evidence → **Drift #9 rewritten**: newest Flash (`gemini-3.8-flash`, 2.6 s on the app's structured-JSON damage request), env-configurable, with a fallback chain (3.8 → 3.7 → 3.5 → 2.5-flash) that walks only on 404-class errors; `modelUsed`/`latencyMs`/`modelsSkipped` recorded per result; typed `GeminiAnalysisError` codes; 60 s abort; per-photo `queued → analyzing → done/failed` state with reasons and retry, so a failure is never a silent forever-pending. `transcribeAudio.ts` moved onto the same transport. A verifier caught `isModelGone` matching body phrases on any non-OK status (a 429 could have walked the chain) — fixed.

**Drift #10 rewritten** on the owner's directive: LiDAR/AR are v2 features with visible entry points. In Expo Go the physics are fixed — no ARKit, no depth sensor access — so the capture-settings sheet ships **Live overlay** (real: a reduced frame every ~3 s to the flash model, spring-drawn boxes labelled LIVE with model + latency, never persisted as findings), **AR markers** and **LiDAR measure** (device-detected; plain-English "needs the native build"), and **Guides** (level indicator + grid). Native AR/LiDAR is attached to the ⚡ STANDING TRIGGER.

**Google Maps vs Apple Maps:** Expo Go cannot load Google's native iOS map SDK, so the Map Tiles API now paints Google road/satellite imagery over the Apple base as an opaque `UrlTile` layer (session cached, attribution chip per Google terms, silent Apple fallback with the reason in Diagnostics). The owner enabled Places, Solar and Map Tiles on the key mid-wave; all three verified live afterwards (Places predictions; Solar 129 roof segments; road + satellite tiles HTTP 200). Native builds/Android unchanged (`PROVIDER_GOOGLE`). Hail Tracer's swath circles are drawn above the imagery so the tiles cannot hide them.

**The tabs are finally tabs:** `(tabs)/_layout.tsx` renders a real `<Tabs>` (JUMP_TO, preserved state, no remount per tap) with the v3 bar as `tabBar`; `backBehavior="history"`; root-level "go to tab" calls use `dismissTo`.

**The crash log, decoded:** `EXC_CRASH / SIGABRT` with `__cxa_throw ← HermesRuntimeImpl::throwPendingError ← … ← worklets::UIScheduler::triggerUI()` — a JavaScript exception thrown inside a Reanimated worklet on the UI thread, escaping as a C++ exception. **Not react-native-maps.** A repo-wide sweep found one definite instance — `ProgressBar`'s fill worklet calling a plain `clamp01` helper (fixed: worklet directive); the Map tab's specific trigger is still unpinned, so Wave 7c installs a UI-runtime error trap that records the JS message to Diagnostics instead of aborting. The owner's second file was a Safari Jetsam event from Aug 26 — unrelated. Owner is on an iOS 27 beta.

**Verification:** expo-doctor 18/18, install --check clean, typecheck, lint, web export, headless boot of every tab + `/quick-inspection` + `/settings/diagnostics` (0 errors), live Gemini path confirmed (3.8-flash; 404 fall-through; bogus key → `auth` with no chain walk). Re-run by hand after the workflow: all green. **Not verified:** detection quality on a real roof JPEG, the Live overlay's box registration on a device, and the tab bar's iOS bottom inset — the owner's phone is the gate.

**Files touched:** `lib/env.ts`, `lib/services/{gemini,analyzeSlope,analysisQueue,transcribeAudio,mapTiles}.ts`, `lib/models/types.ts`, `lib/stores/{captureSettingsStore,mapTilesStore}.ts`, `app/{quick-inspection,analyze,index,search,hail-tracer}.tsx`, `app/(tabs)/{_layout,map}.tsx`, `app/settings/diagnostics.tsx`, `components/{CameraHUD,ui/ProgressBar}.tsx`, `components/capture/*` (new), `components/map/{Map,Map.web,GoogleTileLayer,types}.tsx`, `components/shell/*`, `.env.local.example`, `docs/SETUP_ACCOUNTS.md`, `docs/LEARNING_LOOP.md` (new), `CLAUDE.md` (Stack, Drift #9, Drift #10, parked list), `BACKLOG.md`, `PROMPT_LOG.md`.

---

### [2026-09-02] #61 — Supabase: the owner's "roofwise claude" project wired into the app; schema applied through the Management API

**Prompt:**
> "so supabase is nt connected, i created a new project in supabase: …epghfumtuxrhonbpnbmr" (+ anon key, service-role key) · "i want loudoun to be totally seperate from this" · "here is the token: sbp_…"

**What happened.** The app's Supabase URL + anon key now point at project `epghfumtuxrhonbpnbmr` on both targets (web `.env.local`, EAS `preview` environment) — verified: zero references to any other project in the repo, config, or docs. The Supabase MCP connector in this workspace belongs to an unrelated account ("Loudoun Data Center Watch"), so it was never used for RoofWise; the schema went in through the **Supabase Management API** (`/v1/projects/{ref}/database/query`) with an owner-issued personal access token. First attempt failed on every statement with Cloudflare `error 1010` — bot-blocking Python's default User-Agent, not the token; a real User-Agent fixed it and the whole file applied in one shot.

**Live in the project:** tables `inspections`, `leads`, `corrections` (the exact row `correctionsSync.serialize()` sends), `photos`, `detections`, `labels`, `prompt_releases`; buckets `inspection-photos` (public read, owner-folder insert) and `dataset-crops` (private); row-level security on every table (4 policies each; `prompt_releases` read-active-only for authenticated users); `updated_at` triggers. `supabase/schema.sql` is idempotent and committed (#60 follow-up, `5a87968`).

**Secrets hygiene, stated plainly:** three Supabase secrets were pasted in chat — the anon key (public by design, in the app), the **service-role key** (never needed, never used, must be rotated), and the **personal access token** (used for this migration; keep it until the Learning Loop migrations land, then revoke). All stored only under the session scratchpad, mode 600, verified absent from every commit.

**Unblocked:** email sign-up/sign-in, cloud sync of inspections/leads/photos, corrections capture, and the Learning Loop v2 wave (`docs/LEARNING_LOOP.md`) — which now runs right after Wave 7c.

**Files touched:** `BACKLOG.md`, `PROMPT_LOG.md` (schema file committed earlier).

---

### [2026-09-02] #62 — Standing trigger: PRE-LAUNCH checklist (email confirmation back on, secrets rotated, keys restricted)

**Prompt:**
> "dont forget this when i tell you the app is about to launched: before public launch I'd switch email confirmation back on. Reversible in Authentication → Settings."

Recorded as a second **⚡ STANDING TRIGGER** at the top of `BACKLOG.md` "Now", next to the Apple Developer one, so any future session acts on "we're about to launch" without being asked: Supabase email confirmation back on (`mailer_autoconfirm=false`, set to true in #61 for the test phase) with production `site_url`/redirects; rotate every secret pasted in chat; restrict the Google keys; `REQUIRE_AUTH=true` re-test; full device pass.

**Files touched:** `BACKLOG.md`, `PROMPT_LOG.md`.

---

### [2026-09-02] #63 — Finished Wave 7c by hand after a session-limit crash: crash trap mounted, estimator modal re-present bug, weather page + map hardening integrated

**Context.** Wave 7c's two remaining agents (map-hardening, integrate+verify) died on a usage/session limit mid-run, leaving the tree half-integrated: the weather-page and API-denied builders had finished, the map-hardening builder had written its files (`components/map/StormOverlay.tsx`, `lib/services/stormCluster.ts`, `lib/services/uiRuntimeGuard.ts`) and left `app/(tabs)/map.tsx` uncommitted, but nothing was verified and two seams were unwired. A container restart followed. Completed in the main thread rather than re-running a fleet (session-limit risk; the fixes were concrete).

**Two real bugs finished:**
1. **The crash trap was inert.** `uiRuntimeGuard.ts` existed but `installUiRuntimeGuard()` was never called. Mounted it at module load in `app/_layout.tsx` beside `installDiagnostics()`, so a JS exception thrown inside a Reanimated worklet on the UI thread — the owner's Expo Go SIGABRT via `worklets::UIScheduler::triggerUI` — is recorded to Diagnostics instead of aborting the process. This is the tool that will finally name the Map-tab crash's exact worklet.
2. **Estimator "the page regenerates and I can't type an address."** `<Stack.Screen options={{…, presentation:'modal'}}/>` used an inline object; expo-router re-applies options via `navigation.setOptions` on every identity change (verified in `expo-router/build/views/Screen.js`), so each keystroke re-applied `presentation:'modal'` and the native stack re-presented the modal — the field lost focus. Hoisted the options to stable module constants in `estimator`, `new-job`, `new-lead`. Masked until now because Places was disabled on the key; it surfaced the moment address search started firing.

**Integrated and verified green:** the `/weather` page (Google forecast hours/days — both paged, verified live; NWS active alerts; HAAG §7 roof-work window; saved locations; storms-near-here), `LocationField`, honest Google-API-denied copy on address/measure, and the map `StormOverlay` with zoom-band clustering + `isValidLatLon`/`isValidRegion` guards so no NaN coordinate reaches the native map. Gates re-run by hand: typecheck, lint, web export clean; headless boot of `/weather`, `/estimator` and every tab with no crash (one benign React #418 web-hydration warning). Published to Expo Go (`569e6d2a`).

**Still open (degraded, not broken):** the weather page's "storms near here" deep-links `/(tabs)/map?focus=point&lat&lng`, but the map only handles `focus=storm-leads` — the tap opens the map at its default centre for now. Backlogged.

**Files touched:** `app/_layout.tsx`, `app/estimator.tsx`, `app/new-job.tsx`, `app/new-lead.tsx`, `app/(tabs)/map.tsx`, `app/weather.tsx` + `components/weather/*`, `components/LocationField.tsx`, `components/map/StormOverlay.tsx`, `lib/services/{weatherForecast,nwsAlerts,stormCluster,uiRuntimeGuard}.ts`, `lib/stores/weatherLocationsStore.ts`, `PROMPT_LOG.md`, `BACKLOG.md`.

---

### [2026-09-03] #65 — The per-square unit bug: the engine was fed slope TOTALS as "hits per test square"

**Prompt:** owner asked whether the HAAG report instructions and the damage-score methodology were ever provided, after screenshots showed a claim packet reading "No Functional Damage" beside 62 SEVERE hail hits and a "27 of 100 — Wear consistent with age" score.

**Answer to the question.** The HAAG report methodology IS present and authoritative (`docs/HAAG_DECISION_ENGINE.md`). The damage-score **bands and direction** were given (Kanban PRD: 1–100 INVERTED, 1–30 red / 61–100 green) but the **formula never was** — `damageScore()` carried invented weights (its own comment admits "never in any source document") running in the WRONG direction, which is why 27 (deep red) printed the green-band label. New methodology written and committed: `docs/DAMAGE_SCORE.md` — score DERIVED from the §4 recommendation (band) plus five rule-cited severity components, every deduction citing its HAAG rule, confidence separate from the number, researched against HAAG's published test-square method and carrier norms (IBHS 8/sq, Allstate 10) with the doc's stricter §2 thresholds as authority.

**The bug, found by reproduction not by reading.** `engineInputFromInspection` passed `hail_hits_per_square: s.squareHitCount ?? s.hailCount`. Both are slope **TOTALS** across every photo (recounted by the store's `withRecount`), but §2's threshold is a **RATE** — hits in ONE 100 sq ft test square. A repro of the screenshot case (3-tab, 9 test-square photos, 62 markers) fed the engine **62** as "hits per square" and printed into the report: *"62 hail hits per 100 sq ft test square exceeds the 3-tab threshold of more than 5"* — arithmetically false in front of an adjuster, and it over-called damage on any slope with more photos than hits-per-photo.

**Fix:** new `hailHitsPerSquare(slope)` divides the total by the number of test squares actually shot (photos with no recorded mode count as squares, matching `withRecount`'s bucketing default; single-shingle close-ups excluded from both numerator and denominator per §2). Verified: 62/9 → **6.9/sq → PARTIAL_REPLACEMENT** (§4's 4–7 band — previously FULL_REPLACEMENT). Range check: 1.0/sq → REPAIR, 6.9 → PARTIAL, 10.0 → FULL, 0.4 → REPAIR. Rule citations and the tree's justifications now round the rate for display (6.9, not 6.888888888888889).

**Note on the screenshot's "No Functional Damage":** the repro produced FULL_REPLACEMENT, not that label, so the packet's headline comes from a different path than the engine recommendation — still open, tracked in BACKLOG. The unit bug is fixed and verified independently of it.

**Process:** three attempts to run this as a workflow died on the recurring infrastructure fault (permission handler stripping subagent tool parameters → StructuredOutput unusable; agents correctly refused to fabricate results, repo untouched). Completed in the main thread instead.

**Files touched:** `lib/services/decisionEngine.ts`, `lib/services/haagThresholds.ts`, `docs/DAMAGE_SCORE.md`, `PROMPT_LOG.md`, `BACKLOG.md`.

---

### [2026-09-03] #66 — The RoofWise Damage Score: researched, implemented, and wired so it cannot contradict the verdict

**Prompt:**
> "So my ask: do you have the actual scoring methodolog? - no I do not. So research can come up with one that actually is realistic and meets the Haag standards"
> (earlier, same thread) "100 being a roof that doesn't need repair or replacement and is perfect, and 0 being the worst damged roof — all based on how Haag calculates a roof replacement need using Insurance."

**The research that decided the design.** Two findings, both load-bearing:

1. **The 0–100 condition index is an established engineering convention, not a RoofWise idea.** The US Army Corps of Engineers (ERDC-CERL) Condition Index family — Pavement (PCI, ASTM D6433), Building (BCI), Roof (RCI) — all run 0–100 where **100 = "free from observable distress"** and 70–100 means the asset retains good remaining life. Anchoring there means the number is legible to anyone who has read a facility condition report, and it matches the owner's requested direction exactly.
2. **HAAG's own damage definition is a service-life argument.** HAAG counts granule loss exposing bitumen as damage precisely *"due to the potential loss of remaining service life."* Damage is scored because it costs life — so a remaining-condition scale is the natural expression of a HAAG finding rather than a decoration on top of one.

Also: HAAG thresholds derive from decades of controlled impact testing (the UL 2218 lineage), which is why the score keys off them rather than off weights someone invented; and age drives **repairability**, not damage.

**The design — the score is DERIVED, never parallel.** The band comes from the §4 recommendation, so score↔verdict disagreement is structurally impossible:
NO_STORM_DAMAGE → Sound 86–100 · REPAIR → Serviceable 61–85 · PARTIAL → Compromised 31–60 · FULL → Failed 0–30.
Position *within* the band comes from five weighted, rule-cited severity components: S1 threshold exceedance .35 (ratio to the material's own §2 rule, from `haagThresholds.ts`, never a hardcoded number), S2 breadth across slopes .25, S3 §3 repairability gates .20, S4 §1 hard functional markers .15, S5 other perils .05. Cosmetic-only slopes contribute **0** (§1 is authoritative and is consumed, never re-derived). Confidence (slopes vs 4 elevations, test squares, brittleness, verified event) qualifies the number and never changes it.

**Age is deliberately NOT a silent deduction.** A condition index would normally decay with age; this one doesn't. The score communicates *storm-damage severity for a claim*, and a 25-year-old undamaged roof scoring 40 on age alone would imply a claim where HAAG requires wear and tear to be **ruled out** (§1). Age enters only through the §3 gates and is surfaced as a labelled context line.

**One documented refinement.** §4 step 1 fires NO_STORM_DAMAGE only when a storm search actually ran and found nothing, so a pristine roof whose search never ran exits the tree as REPAIR with *"No qualifying storm damage found."* REPAIR + zero documented damage therefore maps to **Sound**, not 61–85. And with nothing documented at all the result is `{ assessed: false }` — "Not assessed" is a state, never a score of 100 (Drift #5).

**Verified by worked example** (every case from the doc, plus invariants across 3-tab / architectural / wood / tile / membrane / metal): owner's case 62 hits ÷ 9 squares = 6.9/sq → **45, "Compromised — partial replacement"**, and it can never read as age wear; pristine 4-slope roof → 100 Sound; 5/sq vs 6/sq → 47 vs 46 (both PARTIAL — the categorical signal is the threshold-met citation, not a score cliff); architectural at 6/sq (under its >8 rule) scores 48 vs 3-tab's 46; discontinued material + 2 hits → 18 Failed on the §3 gate alone; identical input → byte-identical output. Every case: score inside its band, deductions summing exactly to 100 − score, band agreeing with the §4 verdict, band label always present.

**Three real bugs found while verifying, all fixed:**
- **The §4 tree printed raw floats into the claim packet** — `matched_rule` read *"6.888888888888889 hail hits per test square."* #65 rounded the per-slope justifications and the §2 rule citations but not the tree's own. All rate strings now route through one `fmtRate`.
- **The job screen crashed on any inspection missing `collateralChecklist`** — `TypeError: Cannot read properties of undefined (reading 'brittleness_observed')`, reproduced headless. The field is required by the type but has no persist migration, so records saved before it existed (or round-tripped through sync) take the screen down. Three services already guarded it with `?? {}`; `app/job/[id].tsx`, `haagPdf.ts` and `longReport.ts` did not. Now they do. This is a plausible source of the owner's "the app keeps crashing."
- **The slope card printed the same unit error the engine had** — *"62 hits observed · threshold 6+ per 10×10' square."* It now leads with the rate the engine actually used (6.9 per square) and keeps the total as context ("62 hits documented across 9 photos").

**UI.** New `components/DamageScoreCard.tsx`: the number and its band label are one inseparable block, a four-zone 0–100 scale with the marker at the score, a confidence pill, and a ≥56pt disclosure row opening the full deduction list with HAAG rule citations, the evidence gaps, and the age context line. The deprecated `damageScore()` / `claimWorthiness()` / `CLAIM_WORTHINESS_LABELS` are deleted; `DamageScoreBar` keeps its §6 claim-viability job and loses its legacy numeric path. Claimability is a band; severity is a score — two determinations, two components.

**Gates:** typecheck, lint, `expo export --platform web` all green; headless boot of every tab plus `/inspections`, `/processing`, `/estimator`, `/reports` with zero page errors; the job screen rendered end-to-end from a seeded record with the card and its expanded breakdown correct.

**Files touched:** `lib/services/damageScore.ts` (new), `components/DamageScoreCard.tsx` (new), `docs/DAMAGE_SCORE.md`, `lib/services/decisionEngine.ts`, `lib/services/haagPdf.ts`, `lib/services/longReport.ts`, `components/DamageScoreBar.tsx`, `app/job/[id].tsx`, `lib/models/types.ts`, `PROMPT_LOG.md`, `BACKLOG.md`.

---

### [2026-09-03] #67 — Property intelligence: every job measures its own roof, and the whole app reads one number

**Prompt:**
> "I want to be sure every part of the app is talking to other. Meaning for example when you do an inspection, the app should've done research on the property and know how many squares it is and more so that it informs the report."

**What was actually wrong.** `solar.ts` had measured roofs from aerial imagery all along (Google Solar `buildingInsights`, used for geometry — verified live on the owner's key: a Plano address returns 29.3 squares, 5 faces, imagery 2023-12-10). Only the standalone estimator ever called it. Every inspection therefore carried `areaSquares: 0` on every slope, which zeroed everything downstream: HAAG §5 `RC = D × U × R × A` computed to **0**; the proposal floored the roof at `Math.max(1, …)` and priced a **one-square roof in silence** (a ~$400 quote); the report never stated the roof's size.

**Built.** `lib/services/propertyIntel.ts` runs the research once on job creation (same background pattern as the storm match) and persists a `PropertyIntel` record on the Inspection — failures included, with their plain-English reason (Drift #5). Every consumer reads area through it: engine `square_footage` + per-slope `area_squares`, proposal, estimator, and a new "Roof area" row in the report that states imagery date and quality (a bare square count with no provenance gets struck). New `PropertyIntelCard` on the job screen with a manual re-measure. An unmeasured roof now says so **in the proposal** rather than quoting a placeholder.

**Real data exposed an accuracy bug, fixed.** The imagery segments a roof by pitch AND azimuth, so one physical slope arrives as several facets. That Plano house's south slope came back as 37.9° at azimuth 203.25 and 14.7° at 201.03 — two degrees apart, straddling the S/SW octant boundary at 202.5° — so a naive per-facet mapping reported the south slope as **2.9 squares instead of 6.9**. `roofPlanes()` clusters facets by azimuth proximity (area-weighted circular mean, 30° tolerance) before assigning a direction, and keeps near-flat facets apart (that house reports a 0.15° facet carrying 60% of its area — the footprint, not a slope). Area is conserved: planes sum exactly to the whole-roof figure.

Also fixed on sight: the roof-system card rendered "undefined · 12 yr · undefined" for absent fields.

**Files touched:** `lib/services/propertyIntel.ts` (new), `components/PropertyIntelCard.tsx` (new), `lib/models/types.ts`, `lib/stores/inspectionStore.ts`, `lib/services/{decisionEngine,haagPdf,proposalGenerator}.ts`, `app/new-job.tsx`, `app/job/[id].tsx`.

---

### [2026-09-03] #68 — "Next" without waiting on the analysis, plus the double-count it exposed

**Prompt (with a screenshot of the Analyze slope screen mid-run):**
> "There needs to be the ability to move on to 'next' without having to wait for the photo uploads. It should go into the job/inspection screen of the new job that was created or the existing one."

There was no exit. Once a pass started, the primary button became a spinner, "Re-analyze all" and "Queue for auto-run" disabled themselves on `running`, and back returned to the camera. "Next" is now always live; unanalyzed photos are handed to the background queue on the way out (Processing screen + queue chip show them finishing) and it lands on `/job/[id]` — the same destination for a new job and for one being added to.

**The hazard underneath, fixed.** `analyzeSlope` had **no in-flight guard**, and leaving mid-run makes two passes on one slope the normal case: the screen's pass keeps going while the queue starts its own; both run `onlyNew`, both see the same indices, both attach markers — **doubling the hail count HAAG §2 decides on**. A second call now joins the pass already running. Protects every caller. Verified end to end in the browser: 16 photos / 11 analyzed → "Next — finish 5 in the background" → queues them → `/job/demo1`, zero page errors.

**Files touched:** `app/analyze.tsx`, `lib/services/analyzeSlope.ts`.

---

### [2026-09-03] #69 — The asphalt hit threshold is a carrier convention, not HAAG's — researched, then set to the carrier standard on the owner's decision

**Prompts:**
> "make sure this is accurate according to Haag: '6.9 hail hits per 100 sq ft test square' — I thought it was 9 hits constitutes a damaged slope. Also if all four slopes are damaged by the threshold number of hail hits, then it needs a full replacement, I think, check this."
> then, on the findings: "Okay do the correct slope threshold that's the industry standards for Carriers. Then continue."

**Research (primary sources, `docs/THRESHOLD_PROVENANCE.md`).** HAAG publishes **no** hit-count threshold. Its Test Square Method draws a 10×10 on each directional slope and counts damaged units in order to **extrapolate through `D × U × R × A`** — the §5 formula this app implements. Its damage test is qualitative: punctures, tears, or fractures (bruises) in the shingle mat. The numbers everyone quotes — **8 most commonly, 7–10 the working range, often 8–10 on at least two slopes** — are **carrier conventions**. The owner's "9" sits inside that band.

**Consequences.** The §2/§4 mismatch flagged in #65 was two provenances colliding: §4's `>= 8` matched the carrier norm; §2's 3-tab `> 5` matched nothing sourceable. And `> 5` was **stricter than every carrier** — the app told roofers they had a case at 6 hits when the adjuster wanted 8–10. That is the expensive direction for this product.

**Decision applied (owner).** **≥ 8 functional hail hits per 100 sq ft test square qualifies the slope, for every asphalt family.** `haagThresholds.ts` field is now `hailHitsPerSquareMin: 8` (inclusive, `>=`); `hitsPerTestSquare: 8`; rule strings read "8 or more functional hail hits"; `CARRIER_IMPACT_NORM_NOTE` now states where the number comes from instead of presenting it as HAAG's. §2 table and its provenance notice rewritten; Drift Warning #7 updated in `CLAUDE.md` and here. §2 and §4 now agree on one number.

**Verified.** Worked examples re-run: 7/sq → PARTIAL (47, Compromised), 8/sq → FULL (16, Failed) — a real cliff at the carrier bar, inclusive at exactly 8 (1×); 3-tab and architectural score identically at equal inputs; the owner's 62/9 = 6.9/sq case now reads "against the 3-tab threshold of 8 or more (0.9×)" and lands PARTIAL via the §4 4–7 band. Every invariant holds across six materials. Typecheck + lint green.

**On "all four slopes":** already the behaviour (§4 escalates above 2 slopes). Stronger, sourced, and NOT yet built: carriers frequently approve the whole roof off a **single** qualifying slope because shingles must match and warranties bar partial replacement on matched planes. The engine has that gate — `§3 appearance_match_impossible` — and nothing in the app sets it. Backlogged.

**Files touched:** `lib/services/{haagThresholds,decisionEngine,damageScore}.ts`, `docs/{HAAG_DECISION_ENGINE,DAMAGE_SCORE,THRESHOLD_PROVENANCE,PRODUCT_SYNTHESIS}.md`, `CLAUDE.md`, `PROMPT_LOG.md`, `BACKLOG.md`.

---

### [2026-09-03] #70 — Every photo was filed under South: the "compass" was never a compass

**Prompt:**
> "the user photos of the different slopes is not showing in the job window, so for example, i took photos of multiple slopes, but its only showing that the south slope has all the photos."

**Root cause — two layers.** (1) The capture screen's slope tag defaulted to `'S'` and only changed when the inspector found the SLOPE chip row in the bottom dock, below the fold; the job screen's library import hard-coded `slopes[last]?.orientation ?? 'S'` with no choice at all. (2) The reason nothing safer could be built: the HUD's "auto-detected slope orientation" read `MotionSample.yawDegrees`, which is DeviceMotion's `rotation.alpha` — on iOS, attitude relative to an **arbitrary reference frame** chosen when the sensor starts. It is "how far have I turned since I opened the camera", not "which way am I facing". The "expected S" hints it printed were noise. Per-slope hit counts are what §2/§4 decide replacement on, so this was corrupted evidence, not a display bug.

**Built.**
- `useCompassHeading()` in `deviceMotion.ts` — `Location.watchHeadingAsync`, true north (magnetic fallback), with expo-location's 0–3 accuracy grade; below `COMPASS_USABLE_ACCURACY` (2) it is a hint, never an instrument. `CameraHUD` now reads it (needle counter-rotates by heading like a real compass) and shows the tag's source: `auto` / `matches` / `tagged S`.
- Capture screen: the tag has a mode. **auto** follows the compass once a new octant has held 900 ms (a roofer framing a shot sweeps through neighbours; only a heading that holds is a slope change). **pinned** is set by any explicit choice and never moves. The top pill is now the slope control (was a readout pointing at chips below the fold); Done moved to a 56pt checkmark.
- **The tag is never a silent default.** With no usable compass and nothing pinned, the first shutter holds the photo and asks. A pinned tag that disagrees with the compass by more than one octant (a hip corner is one octant off; the other side of the house is not) holds the photo and asks. Cancel drops the photo — never files it under a guess. A library import from the camera with no chosen slope asks before the batch starts.
- New `components/capture/SlopePickerSheet.tsx` — a compass-rose picker (64pt cells, `GlassCard`) showing photos already filed per slope and a one-tap "Compass says NE — use it". The job screen's import now opens it instead of guessing.

**Verified headless:** job screen → Import opens "Import to which slope?" with `N · 1 photo`, `S · 2 photos`; the capture screen's web fallback still renders; zero page errors. Typecheck + lint green. One bug caught in my own change before commit: the gated import re-entered `runLibraryImport` from a stale closure and would have re-opened the picker forever; it now passes an explicit `slopeChosen` flag.

**Not yet:** the optional step-by-step capture coach (slopes → gutters/downspouts → siding → skylight/chimney flashing → vents → AC) — second half of this task.

**Files touched:** `lib/services/deviceMotion.ts`, `components/CameraHUD.tsx`, `components/capture/SlopePickerSheet.tsx` (new), `app/quick-inspection.tsx`, `app/job/[id].tsx`.

---

### [2026-09-03] #71 — One map, "Storm Tracer": storms follow the viewport, address + my-location search, pan-stable overlays, the duplicate retired

**Prompts:**
> "the map should be able to function like a real map. right now a user cant put in their current location or an address (i am speaking of both the noaa map and the map that features the leads). also i feel like these should be the same and i feel like the noaa hail tracer map is better than the storms and leads map. i like the ui in the noaa hailtracer map. also change it from hailtracer to 'Storm tracer'"
> "the maps crash anytime i move the location on the map, and the storm data does not populate and neither does the overlay."

**Why the data never populated — structural, not network.** Both maps fetched storm history ONCE, around a fixed centre (the saved service area, else the state centre), and never again. Pan sixty miles to a property and there was nothing to draw there. The IEM per-point endpoint itself is fine (verified live: the app's `begints`/`endts` params filter correctly; `sdate`/`edate` and `sts`/`ets` are silently ignored by that endpoint and return every report since 2006 — noted so nobody "fixes" the params later).

**Why it crashed on pan — the evidence-backed reading.** Every settled region was a new region, and the near-band overlay selection is viewport-filtered, so every pan added and removed native circles/pins — on Expo Go + Apple Maps + Fabric that mid-gesture annotation churn is the documented crash class. (No device log was available; the #63 worklet trap has not named a worklet, which also points away from Reanimated.)

**Built.**
- `lib/services/stormBrowse.ts` (pure, unit-tested): the viewport centre is the query; results merge into a cache keyed by event id; a centre inside an already-fetched 50-mi area (minus a 30-mi refetch margin) costs no request; a longer lookback re-fetches, a shorter one is covered; an unavailable result never discards what is loaded.
- `quantizeRegion()` in `stormCluster.ts`: overlay selection snaps the centre to a screen-quarter and the span to a power of two, so a pan inside a quarter keeps the identical native child set; `eventInRegion`'s 15% pad covers the edges in between. Unit-tested (5% pan stable, 37% pan changes, NaN → null).
- The Map tab IS Storm Tracer now: the tracer's controls (range 7d→4yr, hail/wind/both, magnitude, legend) moved in via the new pure `lib/services/stormRange.ts`; header reads "Storm Tracer" on the storms filter and "Map" otherwise; the leads/jobs/knocks filters stay. A search pill (`LocationField`, Places-backed, biased to the viewport) and a "my location" button (`expo-location`, permission-honest) both `animateToRegion` and start the fetch immediately. Storm fetch settles 700 ms after a pan. The count line states coverage honestly ("2 areas loaded" / "no area loaded" under an error).
- `app/hail-tracer.tsx` is a `Redirect` to `/(tabs)/map?filter=storms`; Home's two entry points read "Storm Tracer" and route there. 825 lines of duplicate screen retired.

**Verified headless (web):** Storm Tracer header + every control renders; the search pill opens a field (a `textarea` — the TextInput is multiline) that accepts an address; Leads chip flips the header to "Map"; `/hail-tracer` lands on `/map?filter=storms` with the Storm Tracer header; Home no longer says "Hail Tracer"; zero page errors. The storm fetch is blocked in the headless browser, so the map shows its honest "not available" state there. **The pan-crash fix is inferred from the architecture, not yet confirmed on the owner's device** — flagged in BACKLOG.

**Files touched:** `app/(tabs)/map.tsx`, `app/hail-tracer.tsx`, `app/(tabs)/index.tsx`, `components/map/StormOverlay.tsx`, `lib/services/{stormBrowse,stormRange}.ts` (new), `lib/services/{stormCluster,stormMatch}.ts`.

---

### [2026-09-03] #72 — Per-photo damage report, whole-inspection damage detail on the phone, and non-roof photos identified

**Prompts:**
> "I sent screenshots showing that you're able to see damage details without having to download the report. I want that in each job/inspection. It should be comprehensive."
> (earlier) "Each photo, after being analyzed should be able to be selected and have a page that shows a short damage report. Like how many hits and type of damage. Type of shingle/roof. What side. And if it's not a roof it should be able to identify what has been captured and the type of damage."

**Built.**
- `app/photo-report.tsx` — tap any photo (job screen grid, Analyze screen thumbnails) for ONE photo's report: the photo with its markers read-only; which side (area tag + slope), capture mode, the shingle type **read from this photo** (falls back to the job's declared material, labelled "(job)"); damage by category with count / worst severity / mean confidence; the test-square read against the material threshold ("9 hail hits in this test square — meets the 3-Tab Asphalt threshold of 8 or more"), or the single-shingle sentence (close-ups are never per-square); the shingle-scale estimate; model + latency provenance; Edit markers → edit-detection; Re-analyze this photo only. Honest states: analyzing / queued / failed-with-reason / not analyzed / "no damage detected" / "this photo isn't here any more" for junk params.
- `components/DamageDetailSection.tsx` on the job screen under a new **Damage detail** header — every category found anywhere on the roof, worst-first, with count, severity, avg confidence, and per-slope chips (`S ×9`) that open the first photo carrying it. Coverage line ("2 of 2 photos analyzed"); honest empties for no photos / none analyzed.
- **Non-roof photos are identified, not just rejected.** Gemini's schema gains `subject` (14-value enum aligned to the area tags and collateral zones), `subject_detail`, and `collateral_damage[]` (dents / bent fins / spatter / cracks / punctures / tears, with severity + confidence). STEP 0 now says: name the subject first; if it is not a roof field, return zero roof findings AND describe the collateral damage. Parsed defensively (`parseSubject` / `parseCollateral`; a model that says "roof_field" while also saying no-roof becomes `unidentifiable`; collateral is only ever kept on a non-roof frame so it can never be a second channel for roof findings — Drift #7). Persisted per photo on `PhotoAnalysisState` (`shingleType`, `subject`, `subjectDetail`, `collateralDamage`). The report renders it as "Gutter / downspout — corroborates Gutters & Downspouts — Dents (moderate), 84%"; the detail section lists collateral photos in their own block, stated as corroboration, never counted as roof hits.

**A real bug caught by the seeded boot.** With one roof photo (9 hits) and one gutter photo on the same slope, the verdict read **"4.5 hail hits per test square"** — the gutter photo, shot in 10×10 mode, was in the per-square denominator. A photo the model identified as not-a-roof is not a test square, whatever mode it was shot in; that halved the rate and would have under-called a FULL_REPLACEMENT roof to PARTIAL — the #65 unit bug in the other direction. Both the engine's `hailHitsPerSquare` and the score's `evidenceFromInspection` now exclude `noRoofDetected` photos. Verified: 9 hits / 1 roof photo + 1 gutter photo → **9.0/square → FULL_REPLACEMENT**.

**Verified headless:** roof report, gutter report, junk-params state, and the job's Damage detail section all render with zero page errors. Typecheck, lint, worked examples green.

**Files touched:** `app/photo-report.tsx` (new), `components/DamageDetailSection.tsx` (new), `lib/models/types.ts`, `lib/services/{gemini,analyzeSlope,decisionEngine,damageScore}.ts`, `app/job/[id].tsx`, `app/analyze.tsx`.

---

### [2026-09-03] #73 — Guided capture: the walk, one step at a time over the camera

**Prompt:**
> "I think there should be some kind of on screen guidance as well that is an option that walks through the picture taking process for each slope of the roof and other items that need to be taken a picture of such as water spouts, window siding, the metal that comes with a sky window (on the ceiling) and more."

**Built.**
- `lib/services/captureCoach.ts` (pure, unit-tested): the walk for a job — the four cardinal slopes first (S/E/N/W, one 10×10 test square each; HAAG's minimum is one per direction), then the four collateral zones (gutters/downspouts, siding + window screens, HVAC condenser fins, soft-metal roof vents incl. skylight and chimney flashing), then the brittleness test on an insurance claim. **Progress is derived from the photos** (`photoMeta` slope + area tag, alternates accepted — a chimney cap satisfies the soft-metal step; the brittleness protocol's photos satisfy that step). Nothing is ticked by hand; nothing is ticked by a photo that was never taken.
- `components/capture/CaptureCoach.tsx`: a glass strip above the dock — "STEP 3 OF 9 · 2 DONE · Rear slope (north) · 1/1" with the one-line hint, 56pt Prev/Next, tap for the full list (done ticks, per-step shot counts), and "Turn guided capture off". Selecting a step sets the camera up for it (slope pinned, area tag, capture mode). Resumes on the step the inspector left per job, else the first step still short of shots.
- On an insurance claim, a collateral photo **fills its claim-evidence zone by existing** (`setCollateralZone` with the photo id) — the checklist is never ticked for a surface nobody photographed.
- "Guided capture" switch in the capture settings sheet; ON by default (a complete packet is the point), one tap off for the roofer who knows the walk.

**Verified:** 13 pure assertions (walk order, claim adds brittleness, per-slope and per-zone progress incl. alternate tags, next-incomplete resolution, tag→zone lookup); typecheck, lint, web export green. The strip itself only renders on the native camera — the web build shows the camera fallback — so the pure test is the check.

**Files touched:** `lib/services/captureCoach.ts` (new), `components/capture/CaptureCoach.tsx` (new), `lib/stores/captureSettingsStore.ts`, `components/capture/CaptureSettingsSheet.tsx`, `app/quick-inspection.tsx`.

---

### [2026-09-03] #74 — Estimator: the property from above with the roof drawn on, and a saved estimate that opens as itself

**Prompts:**
> "i asked previously to have some sort of map imagery in the estimator feature so that the user can see the overhead of their property with an overlay of their roof. and improve the estimator feature and the ui."
> "when user presses a saved estimate, it goes to the page where you can start a new estimation. it needs to show the property information and the estimate"

**The saved-estimate bug was structural.** There was no detail route at all: the Home tile pushed `/estimator`, the wizard, from step 0. `SavedEstimate` also kept only the totals — nothing about the roof that produced them.

**Built.**
- `RoofOverheadView` — Google satellite imagery (the map abstraction's `mapType="satellite"`, which is the Google tile layer in Expo Go and PROVIDER_GOOGLE in native builds) with one coloured rectangle per measured roof face, from the same aerial measurement the squares come from. The rectangles are the imagery's own per-face `boundingBox` (now carried through `solar.ts` → `PropertyIntel` → `SavedEstimate.measurement`), so what the roofer sees IS what was counted. Colour by compass direction from theme tokens; a legend of faces with squares and pitch; "Aerial · N roof faces drawn" badge; honest "no frame" for a face without a box and a no-imagery state. Non-interactive — a picture of the measurement, not a map to wander. Framing geometry (`lib/services/roofOverhead.ts`) is pure and unit-tested (union of frames, floor delta for shed-sized footprints).
- `app/estimate/[id].tsx` — the saved estimate as a page: address, the overhead, squares / faces / imagery year, the stale-imagery notice, the low–mid–high with material and scope, and Convert to job / Re-estimate (prefilled wizard) / Delete. Honest "isn't here any more" state. The Home tile opens it; Save in the wizard lands on it.
- The wizard: the measured card is now the hero (overhead + numbers), the Result step shows the overhead above the price, Save persists the measurement only when squares came from imagery (a manual count has no property to draw — Drift #5), and "Re-estimate" from a saved estimate prefills the address, coordinates and material via the existing prefill store.
- The job screen's Property card gets the same overhead under its numbers.

**Honest limits.** The overlay is per-face bounding boxes, not a traced roof outline — the Solar `dataLayers` mask GeoTIFF is the path to a true outline and stays in BACKLOG. The satellite view renders only on the native map; the web build shows the map fallback with the legend beneath.

**Verified headless:** the saved-estimate page renders every section from a seeded estimate via the Home tile (client-side route `/estimate/est_1`); zero page errors. Typecheck, lint, web export green. (Delete's confirm is a multi-button `Alert`, which react-native-web does not render — native only, like every other confirm in the app.)

**Files touched:** `components/RoofOverheadView.tsx` (new), `lib/services/roofOverhead.ts` (new), `app/estimate/[id].tsx` (new), `app/estimator.tsx`, `app/(tabs)/index.tsx`, `components/PropertyIntelCard.tsx`, `lib/services/{solar,propertyIntel}.ts`, `lib/models/types.ts`.

---

### [2026-09-03] #75 — HAAG-grade detection: functional damage derived from evidence, look-alikes, capture context, shingle counting, squares from photos

**Prompt:**
> "I want you to improve the damage detection based on Haag standards. And think of ways to optimize the photos for Gemini to be able to identify damage type. Each photo should count the number of shingles as well. And it should be able to calculate, from the photos, the squares."

**The correctness gap this closed.** The engine treats `functional_damage_present` as an authoritative §1 input and never re-derives it from counts — correct. But **nothing ever set it.** Every slope was created `functional: false` and no analysis path wrote it, so the §4 branches that key on functional damage, and the damage score's S4 marker, were dead for every AI-analyzed job. The honest rule is HAAG's own (Marshall & Herzog): functional hail damage on asphalt is a puncture, tear, or **fracture of the shingle mat**; granule loss that does not expose the mat is not functional by itself.

**Built.**
- **Per-hit evidence class.** Every `hail_hits` / `bruising` detection now carries `evidence: mat_fracture | exposed_substrate | granule_loss_only | cosmetic | unclear` (`DamageMarker.evidence`, additive). The prompt's new HAAG FUNCTIONAL TEST section defines each class and says plainly that claiming a fracture that is not visible is the most expensive mistake this tool can make, and missing a visible one the second.
- **`deriveFunctional()`** (`lib/services/functionalDamage.ts`, pure, 8 assertions): a slope is functional when a hail/bruise mark on a **test-square roof photo** carries mat_fracture or exposed_substrate at ≥75% confidence. Granule loss never qualifies; a single-shingle close-up documents one shingle and does not by itself make the slope functional; a non-roof photo never counts; markers from before evidence existed yield "re-analyze to derive" — never a guess. `analyzeSlope` sets `slope.functional` from it after every pass. The job's slope block now prints the determination and its reason.
- **HAAG look-alikes** in the prompt: blisters (raised, popped crater, rough floor — report as blistering), foot-traffic scuffs, manufacturing/rasp marks, thermal craze, nail pops — "choose the look-alike or lower the evidence to unclear; never upgrade to hail on a hunch."
- **Capture context** in the request: slope, the inspector's area tag, **test square vs single-shingle** (which changes what counting means), and the declared material (sets the shingle geometry to calibrate against). The model still reports what it sees.
- **Counting.** `shingle_count` (whole shingles in frame) and `test_square_coverage` (`visible` chalk lines; `fraction` of one 100 sq ft square this frame documents; estimated from the calibrated scale when no chalk) persisted per photo. `documentedCoverage()` (`lib/services/documentedSquares.ts`, pure) sums coverage over 10×10 roof photos only — **squares documented FROM THE PHOTOS**, a different number from the aerial figure and never confused with it ("29.3 aerial squares, 2.4 documented" tells the adjuster something true about the packet's own evidence). Shown on the photo report and the slope block.
- **Image pipeline left as is, deliberately.** 2560-px JPEG at 0.82 (1600 @ 0.7 fallback) already exceeds what the model tiles at; no change was made without evidence.

**Verified.** Typecheck, lint, web export green; 8 functional-derivation + 3 counting assertions; the damage-score worked examples still pass; `buildAnalyzeRequest` asserted offline to carry the context line, the evidence enum, the counting fields, and both HAAG sections. **Not verified live:** this container's `.env.local` has no `EXPO_PUBLIC_GEMINI_API_KEY` (only the model name), so no model call could run here. Every new field is optional and parsed defensively — an older or non-conforming response degrades to "absent", never to a guess — but the first real analysis on the phone is the true test. BACKLOG carries it.

**Files touched:** `lib/services/{functionalDamage,documentedSquares}.ts` (new), `lib/services/{gemini,analyzeSlope}.ts`, `lib/models/types.ts`, `app/photo-report.tsx`, `app/job/[id].tsx`.

---

### [2026-09-03] #76 — Storm Tracer polish: continuous swaths at the browse zoom, the inches glyphs kept, the legend behind a chip

**Prompt (with a screenshot of the Map tab on the phone):**
> "I want to keep the feature that shows the hail inches on the map. Still want you to continue improving the maps"

The screenshot was the OLD bundle ("Map" title, 1–4 yr chips) — #71 has not reached the phone because this container has no EAS login. Two things it showed were worth fixing before it lands.

**Kept, untouched:** the far-zoom cluster glyphs — count over strongest magnitude (`85 / 1.00"`, `16 / 2.50"`) — come from `clusterMagnitudeLabel` in `StormOverlay.tsx`, which #71 did not change. The peril / magnitude chips now filter events BEFORE clustering, so "≥1.5" hail" thins the glyphs to the ones that matter.

**Fixed — the swaths read as confetti at 50 miles.** Each report drew its own small square instead of the continuous graded area a HailTrace map shows. Cause: the influence radius (2 km + 1.5 km/in, capped 8 km) did not scale with the view — at the far bucket a 1 in report is a 3.5 km blob, one or two 2.6 km grid cells, so sparse reports never merged. `scaledInfluenceRadiusKm(scale)` grows the SMOOTHING radius with the zoom bucket (near 1×, mid 1.6×, far 2.5× — 1 in hail = 8.75 km, cap 20 km) and `useStormSwaths` passes it per bucket; `swathEmphasisForRegion` bolds the fill at the far view (×1.6, capped) so the areas read as areas. The claim is unchanged — "impacted area — from storm reports", a smoothing of spot observations, never a statement that hail fell that far from the reporter. Pure test with 12 reports spaced 7–9 km apart across a county: far view unscaled **4 fragments → scaled 2 continuous areas**, near view keeps **24 rings** of per-report detail, every report inside a swath in all three, vertex cap respected, deterministic.

**Fixed — a tall control stack over the map.** The four-row legend is now behind a `Legend` chip, collapsed by default: the chips already carry hail-blue / wind-orange, and a roofer in gloves wants the map, not a key to it.

**Files touched:** `lib/services/stormSwath.ts`, `components/map/StormOverlay.tsx`, `app/(tabs)/map.tsx`.

---

### [2026-09-03] #77 — Storm alerts that say where and hand the roofer a route; a live 10×10 guide from the model's own scale; every count against both carrier bars

**Prompts:**
> "When there is a storm within a 50 mile radius notify the roofer if it is a hail storm or a serious damaging windstorm. Give them guidance on where the storm occurred and work out a way for them to add the area to their door knocking route."
> "The app's AR has to be able to 1. Measure a square, identify individual shingles and live damage (and damage type) and have an overlay for each. If this isn't possible for damage let me know… identify a full square with an overlay and allow the user to take a picture of the square then analyze the damage and number of shingles."
> "keep the trigger, but state every count against both bars"

**Storm alerts (G).** Radius 25 → **50 mi** (`AREA_ALERT_RADIUS_MILES`). Alerts now carry **where it hit** — the strongest report's coordinates and town, distance and compass bearing from the service-area centroid, report count — and a **severity**: `damaging` at hail ≥ 1 in (the NWS severe criterion) or gusts ≥ 70 mph (`DAMAGING_WIND_MPH`, documented), else `watch`. The push body reads as guidance: *"2.00" hail near Frisco, 11 mi NW of Plano, TX · 3 properties in range · Tap to add the area to your knock route."* The alert screen gains a **Where it hit** card (town, distance/bearing, reports, what damaging hail or wind means for asphalt) and two actions: **Start knock route here / Add area to my knock route** — a `KnockRouteTarget` (core + 3-mi canvass radius) on the session (new, or re-aiming the active one) — and **See it in Storm Tracer**, which lands the map on the core via a new `?lat&lng` param (also closes the weather page's "storms near here" deep-link gap). Door-knocking frames its map on the target, draws the canvass circle, and says "aimed at Frisco storm core" in the header. `lib/services/stormWhere.ts` is pure and tested (Frisco is 11 mi NW of Plano; no centroid → town only, never an invented distance).

**Live camera (H) — what is honest today.** Live damage boxes with type already existed (Gemini on a reduced frame every ~3 s). Added on that path: a **10×10 test-square guide** drawn at 120 in × the model's own `pixels_per_inch` (calibrated on the 12"×36" shingle), mapped through the same cover-rect as the boxes, with **course lines every ~5.6 in** and a live **shingle count**; the tag reads *"10×10 test square · est. from shingle scale"*, turns amber with *"back up to fit"* when the square exceeds the frame, and the guide draws only in test-square capture mode. The live addendum now asks the model for scale, count and coverage on every frame. **What it is not, said plainly:** a measurement. The guide is an estimate from shingle geometry; true measurement and markers anchored to the roof as you move are ARKit/LiDAR — the native build behind the Apple Developer standing trigger. Per-shingle outlines live at 3-s cadence are not reliable and were not attempted; the count is.

**Both bars (I).** `carrierBarsRead()` in `haagThresholds.ts`: *"9 hits per square — meets the 8-hit standard most carriers use; 1 short of the 10 some require."* Printed on the job's slope block, the photo report's test-square read, and the HAAG PDF's per-slope citation. The trigger stays ≥ 8.

**Verified:** typecheck, lint, web export green; 7 where/bearing assertions; the both-bars sentence across 6.9 / 8 / 9 / 10 / 12; headless: the alert screen renders Where it hit, Start knock route creates a session aimed at the core (`routeTarget` persisted, 3-mi radius), door-knocking opens framed on it, zero page errors. The live guide renders only on the native camera. **Still not on the phone** — no EAS login in this container.

**Files touched:** `lib/services/{stormWatch,stormWhere,haagThresholds,gemini,haagPdf}.ts`, `lib/stores/{stormAlertStore,knockSessionStore}.ts`, `lib/models/types.ts`, `app/storm-alert/[id].tsx`, `app/door-knocking.tsx`, `app/(tabs)/map.tsx`, `app/quick-inspection.tsx`, `app/photo-report.tsx`, `app/job/[id].tsx`, `components/capture/LiveOverlay.tsx`.

---

### [2026-09-03] #78 — Pop-ups and motion: the sheet primitive, Quick Actions "+", "Add Photos To…" before capture, photo actions on long-press

**Prompt (two screenshots of a reference app):**
> "The app needs lots of animations and pop ups where applicable. It's too static. See attached example of a pop. Quick action (when you press the + button on the home screen) and add photos are pop ups on another app I'm using as an example."

**Built (in the main thread, while four agents build Waves A/B/C and the audit in parallel):**
- `components/ui/BottomSheet.tsx` — the app's one sheet: springs up on `motion.snappy`, the screen dims, grabber, top-left Cancel, drag-down / flick to dismiss (gesture-handler), reduced-motion collapses to a cut. Worklet-safe: the animated styles read only numeric shared values; dismissal crosses to JS with `runOnJS`.
- `components/sheets/QuickActionsSheet.tsx` — the "+" grid: New Lead, Start Inspection, Capture Damage Photo, Track Mileage, File Storm Claim, New Job, Cost Estimate, Storm Tracer, Knock Route, Schedule — two per row, 128pt tiles, every one opens a real screen. **Not yet mounted on Home:** the Wave B agent owns `app/(tabs)/index.tsx` right now; the "+" lands the moment it reports.
- `components/sheets/AddPhotosToSheet.tsx` — asked over the live viewfinder when the camera opens without a job: New Customer (→ wizard), Existing Customer (searchable pipeline picker, open-job count badge), Save Without Customer (LATER). Closes a real hole: a standalone capture used to create "Quick inspection / Address pending" silently on the first shutter.
- `components/sheets/PhotoActionsSheet.tsx` — long-press on a photo in Analyze shows the photo with Open damage report / Rotate 90° / Re-analyze this photo / Delete (confirmed inside the sheet), replacing the system Alert.

**Verified:** typecheck + lint green on the whole tree at commit time. The sheets render only on the native camera / long-press paths, so they were not booted headless; the primitive's motion is judged on device. This commit stages ONLY these files — the parallel agents' in-flight work (`components/pipeline/` etc.) is deliberately left out until it reports.

**Files touched:** `components/ui/BottomSheet.tsx`, `components/sheets/{QuickActionsSheet,AddPhotosToSheet,PhotoActionsSheet}.tsx`, `app/quick-inspection.tsx`, `app/analyze.tsx`, `PROMPT_LOG.md`.
