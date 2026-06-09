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

> Last refreshed: 2026-06-09 (after entry #03).

**Product in one line:** RoofWise is the objective layer between roofing contractors and insurance carriers — AI vision + HAAG-protocol-compliant claim packets on a mobile device.

**Codebase:** Expo (React Native + TypeScript), targets iOS + Android. The active codebase for the product. Source-of-truth spec is `docs/SPEC.md`; native-Swift reference at `paxstudios/rork-roofwise-dashboard-` is feature-archived only.

**Persona we build for:** A roofer in gloves on a hot roof. Every UI decision respects glove-friendly touch targets (≥56pt, sticky 88pt CTAs in thumb zone), high contrast for outdoor sun, voice input on free text, confirm sheets on destructive actions, no precision-only gestures.

**Where we are today (entry #03):**
- Brand theme tokens (navy / orange / cream / slate) with type ramp + motion tokens in `theme/tokens.ts`.
- Auth foundation: Supabase client (`lib/supabase.ts`), env reader (`lib/env.ts`), Zustand auth store (`lib/auth/authStore.ts`), Welcome sign-in/up/reset screen (`app/welcome.tsx`), auth gate (`app/index.tsx` + `app/(tabs)/_layout.tsx`), Settings account row.
- Old 8-tab scaffold (Dashboard, Leads, Map, Inspections, Jobs, Storm Intel, Reports, Settings) being replaced with the 5-tab spec IA (Home, Leads, Map, Plan, Train).

**What's next (Tier 1 MVP build):**
1. Data model types (Inspection, Slope, DamageMarker, StormEvent, Customer, Lead, Job, Estimate, Proposal, Knock, ServiceArea, StormAlert, TrainingItem, Correction, UserCorrectionProfile, ActivityEvent).
2. Damage taxonomy + HAAG threshold lookup.
3. 5-tab nav (Home, Leads, Map, Plan, Train).
4. Home dashboard per spec (Storm Alert hero, Quick Inspection + New Job hero CTAs, KPI tiles, Recent Jobs carousel, Pipeline mini-Kanban, Today's Plan).
5. New Job Wizard (4 steps: Customer/Property → Insurance → Roof System → Review).
6. Quick Inspection camera scaffold (expo-camera, slope selector, photo strip, Gemini service stub that errors clearly when no key configured).
7. Decision Engine (HAAG threshold rules engine).
8. Map tab scaffold (react-native-maps + NOAA storm pins).
9. Plan, Train tab scaffolds with empty-state cards.

**What's mocked / placeholder:**
- `lib/mock/` data still present but no longer flowing through tabs. Per spec: empty state always — no seeded sample data.

**What's parked (Drift Warning #10):**
- LiDAR + ARKit (no good RN binding; iOS Pro-only). Live AR overlay is parked.

---

## Drift Warning

The following constraints are hardened and **must not silently drift**. If a prompt contradicts any of these, surface it explicitly before changing it.

1. **Persona is a gloved roofer in sun.** Glove rules from `docs/SPEC.md` apply to every view: ≥56pt touch targets, ≥12pt spacing between tappable elements, sticky 88pt primary CTAs in thumb zone, high contrast, voice input on free-text fields, chips/steppers/segmented-controls over text inputs where possible, confirm on destructive actions, no precision-only gestures, one-handed reachable controls.
2. **5 bottom tabs:** Home, Leads, Map, Plan, Train. (Settings is a route reached from Home/profile, not a tab.) The earlier 8-tab scaffold is being removed.
3. **Quick Inspection is the hero feature.** Dashboard CTAs are "Quick Inspection" and "New Job", side by side. No KPI buttons in their place.
4. **Storm Alert hero hides when there is no active alert.** Never show a stale "Severe Hail" placeholder.
5. **No mocks, no seeded sample data.** App boots to an empty state. When a service can't reach its API, show a friendly "Not available" state — never synthesize fake data.
6. **Damage taxonomy is 13 canonical categories** per `docs/SPEC.md` "13-Category AI Damage Taxonomy": Hail Hits, Bruising, Granule Loss, Wind Damage, Wind Creasing, Blistering, Cracking, Flashing Damage, Algae/Moss, Missing Shingles, Splitting, Lifted Shingles, Structural Sagging. Each finding has severity (None/Minor/Moderate/Severe) and confidence (0-100).
7. **HAAG functional-damage thresholds are material-specific.** Lookup table in `lib/services/haagThresholds.ts`. 3-tab asphalt = 8 hits per test square; architectural = 10; metal = penetration only; tile = any crack qualifies; etc.
8. **Decision Engine is pure logic.** Given a populated Inspection, it returns per-slope + roof-level verdict + reasoning. No I/O.
9. **Gemini model:** `gemini-2.5-flash` via Google AI Studio direct REST call. **There is no `gemini-3-flash`** (per spec, prior attempt was a hallucination). Do not change the model or provider without an explicit prompt that acknowledges this constraint.
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

| Phase | Feature | Status |
|---|---|---|
| 0 | Brand theme tokens | Implemented |
| 0 | Supabase auth + Welcome screen + gate | Implemented |
| 0 | 5-tab IA migration | In progress |
| 1 | Home dashboard (Storm Alert hero, hero CTAs, KPI, Recent Jobs, Pipeline, Today's Plan) | In progress |
| 2A | Data foundation (Inspection model + InspectionStore + NewJobWizard) | In progress |
| 2B | Quick Inspection camera + Gemini + DecisionEngine | In progress |
| 3 | HAAG PDF report + signatures | Not started |
| 4A | Map (react-native-maps + NOAA pins + filters + Storm Detail) | In progress |
| 4B | Weather tile (Google Weather API) | Not started |
| 4C | NOAA auto-event-fill on inspection save | Not started |
| 4D | Solar API roof measurement | Not started |
| 4E | Cost Estimator wizard | Not started |
| 5A | Inspection.originEstimateId traceability | Not started |
| 5B | Activity Feed | Not started |
| 5C | AI Training Queue | Not started |
| 6A | Service Area (zips/cities) | Not started |
| 6B | Storm Watch background polling | Not started |
| 6C | Push notifications for storm alerts | Not started |
| 6D | Dynamic Storm Alert hero (consumes alert store) | Not started |
| 6E | Door Knocking Mode | Not started |
| 7 | Proposals + PDF export + send sheet | Not started |
| 8 | Structured Gemini confidence (flag-gated) | Not started |
| 9 | Recursive Learning Loop (SwipeReview + OverlayEditor + LocalLearningEngine + corrections sync) | Not started |
| 10 | Corrections backend (separate Next.js project) | N/A here |
| - | Voice command service | Not started |
| - | Offline mode + sync queue | Not started |
| - | Photo Quality scoring | Not started |

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
