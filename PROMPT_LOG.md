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

> Last refreshed: 2026-06-12 (after entry #24).

**Product in one line:** RoofWise is the objective layer between roofing contractors and insurance carriers — AI vision + HAAG-protocol-compliant claim packets on a mobile device.

**Codebase:** Expo (React Native + TypeScript), targets iOS + Android. The active codebase for the product. Source-of-truth spec is `docs/SPEC.md`; native-Swift reference at `paxstudios/rork-roofwise-dashboard-` is feature-archived only.

**Persona we build for:** A roofer in gloves on a hot roof. Every UI decision respects glove-friendly touch targets (≥56pt, sticky 88pt CTAs in thumb zone), high contrast for outdoor sun, voice input on free text, confirm sheets on destructive actions, no precision-only gestures.

**Where we are today (entry #24):**
- Tier 1 MVP is built. 5-tab IA (Home / Leads / Map / Plan / Train) via expo-router; Settings is a route. Flows in place: New Job wizard, Quick Inspection camera + photo-library upload, Analyze (Gemini 2.5 Flash via `lib/services/gemini.ts`), edit-detection, swipe review, proposals/estimator/PDFs, storm tools, door knocking, mileage, Train loop with corrections. Pure logic in `lib/services/{decisionEngine,haagThresholds}.ts`; per-feature Zustand stores with persist under `lib/stores/`.
- Auth: Supabase email/password works against project `yyzjosttvpleehzmhhxy` (keys in `.env.local`, gitignored). `requireAuth` flag wired, false in dev. Apple Sign In parked (needs dev build).
- AI pipeline verified end-to-end in session 2026-06-12: Quick Inspection (standalone — auto-creates a lightweight inspection when launched without a job, #22) → Job detail → Analyze → `analyzeSlope` reads photos as base64 → Gemini 13-category findings + markers.
- Photo handling hardened against two native Expo Go crashes: every photo is downscaled to ≤1600px JPEG 0.7 via expo-image-manipulator, picker has NO `quality` param (multi-HEIC re-encode OOM, #23), and uses `preferredAssetRepresentationMode: Current` (iCloud "Cannot load representation of type public.jpeg" → double promise rejection → SIGABRT, #24).

**Known environment gotchas:**
- `lib/env.ts` Supabase fallback still points to the old project `mzsabjegtxmzlfpxmmfm` — devices without `.env.local` hit "network request failed" at login. Open follow-up (a fix commit was blocked by credential-scanning; needs a non-hardcoded approach).
- User's Mac: working clone is `~/Documents/RoofWiseClaude`; a stale clone at `~/RoofWiseClaude` may still have Metro on port 8081 — kill it (`pkill -f expo`) before testing or Expo Go loads old code.
- All API keys pasted in chat during sessions (Gemini, Supabase anon, Maps) are exposed — rotate before production.

**What's mocked / placeholder:**
- Nothing. App boots empty per Drift Warning #5.

**What's parked:**
- LiDAR + ARKit (Drift Warning #10), Apple Sign In, true background execution, geofenced mileage auto-tracking, native voice-to-text — full list in `CLAUDE.md` "Known parked items".

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
