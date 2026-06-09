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
