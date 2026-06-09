# RoofWise — Prompt Log

A structured context engineering log for the RoofWise project. Every meaningful prompt, decision, and implementation step is captured here so that future agents (and humans) can quickly reconstruct intent, scope, and history.

---

## How to use this log

- **Append, don't rewrite.** Add a new entry at the bottom for each prompt or change.
- **Be specific.** Capture the *why*, not just the *what*.
- **Link to files.** Reference the screens/components touched so context is easy to recover.
- **Keep entries short but complete.** One section per prompt.
- **Re-summarize.** Every 5 new entries, refresh the **Context Summary** section below so the top of this file stays current.

### Entry template

```md
## [YYYY-MM-DD] #NN — Short title

**Prompt (verbatim or summarized):**
> ...

**Intent / Goal:**
- ...

**Decisions made:**
- ...

**Files touched:**
- `path/to/file.tsx` — what changed

**Open questions / Follow-ups:**
- ...
```

---

## Context Summary

> Last refreshed: 2026-06-09 (after entry #01).

**Product in one line:** RoofWise is a mobile CRM + AI inspection tool for roofing contractors that turns a phone into a forensic roof-damage scanner and generates HAAG-standard claim packets for insurance adjusters.

**Where we are today:**
- The project lives in this Expo (React Native + TypeScript) repo. A previous native-Swift implementation exists at `paxstudios/rork-roofwise-dashboard-` and is the reference for product spec, but is not the active codebase.
- Current code is a scaffold: dashboard with KPIs, NOAA storm map, mock data for leads/jobs/schedule/tasks/activity, basic bottom-tab navigation (Dashboard, Leads, Map, Inspections, Jobs, Storm Intel, Reports, Settings).
- No backend, auth, camera flow, AI integration, or claim packet yet.

**Platforms:** iOS + Android. Mobile-only. No web target.

**What's mocked / placeholder:**
- All data (`lib/mock/`).
- No AI vision integration.
- No backend persistence.

**What's not started:**
- Supabase wiring (auth + leads sync)
- Quick Inspection camera flow
- Gemini 3 Pro vision analysis + damage taxonomy + HAAG grading + Claim Packet
- Dashboard CTAs (Quick Inspection + New Job)
- Recent Jobs strip
- Storm map filters + event detail sheet
- Mileage tracker
- Proposals + PDF export
- Push notifications for storm alerts
- EAS Build / TestFlight / Play Store internal

---

## Drift Warning

Every agent working on this project must read this section before making changes. The following constraints have been established by the founder and **must not silently drift**:

1. **Quick Inspection is the hero feature.** Do not bury it behind extra steps, gate it behind paywalls without explicit instruction, or replace its CTA on the Dashboard.
2. **Dashboard CTAs are "Quick Inspection" and "New Job".** Old KPI buttons ("Active Leads" / "Inspections Today") have been intentionally removed in the rork product spec and must not be reintroduced.
3. **Dashboard must remain scrollable** so the storm map and Recent Jobs are always reachable.
4. **Slope selector dropdown** replaces individual Slope / 3D Scan / Macro buttons in the camera flow.
5. **Damage taxonomy is fixed (13 canonical snake_case tokens):** `hail_hits`, `bruising`, `granule_loss`, `wind_damage`, `wind_creasing`, `blistering`, `cracking`, `splitting`, `flashing`, `algae_moss`, `missing_shingles`, `lifted`, `structural_sagging`. Each finding carries severity (None / Minor / Moderate / Severe) and a confidence %.
6. **HAAG grades are fixed:** "No Functional Damage", "Functional Damage — Hail", "Functional Damage — Wind", "Functional Damage — Combined Peril".
7. **Claim Worthiness badges are fixed:** Not Claimable / Borderline / Claimable / Urgent.
8. **Mobile-first, card-based, lots of whitespace, rounded corners, subtle shadows.** No web-style dense tables.
9. **Gemini 3 Pro Vision** via Google AI Studio direct API is the chosen AI model. Do not swap providers without an explicit prompt. (Previously Gemini 1.5/2.5 Flash via the rork toolkit proxy; pinned forward by user request on 2026-06-09.)
10. **No LiDAR / ARKit in v1.** Camera-only Quick Inspection. LiDAR mesh capture is parked until a custom native module is justified by user need.
11. **Append, don't rewrite** the Prompt History section. Existing entries are immutable history.

If a new prompt seems to contradict any of the above, surface it explicitly in your response before changing it.

---

## Constraint Verification Protocol

Before completing any change, the agent must:

1. **Re-read** `PROMPT_LOG.md` (this file) — at minimum the Context Summary, Drift Warning, and the last 3 prompt entries.
2. **Diff intent vs. request.** State, in your response, which Drift Warning items the request touches and confirm the user is intentionally changing them.
3. **Verify the Damage Taxonomy, HAAG grades, and Claim Worthiness badges** are still intact in code after your change.
4. **Verify the Dashboard CTAs** are still "Quick Inspection" and "New Job" once they're built.
5. **Verify the Quick Inspection flow** still: launches camera → slope dropdown → multi-photo capture → Gemini analysis → results with damage score + claim worthiness → HAAG Claim Packet sheet (once built).
6. **Append a new prompt entry** to the Prompt History section.
7. **If this is the 5th entry since the last Context Summary refresh**, refresh the Context Summary in the same change.

---

## Project Overview

**Name:** RoofWise
**Type:** Mobile CRM + AI assistant for roofing companies
**Persona:** Elite Forensic Roofing Consultant
**Platform:** Expo (React Native + TypeScript) — iOS + Android
**Primary user:** Roofing contractors, adjusters, inspectors

### Core value proposition

A field-ready CRM and AI inspection tool that helps roofing pros:
1. Triage leads, jobs, and storm-impacted properties from one dashboard.
2. Run AI-powered Quick Inspections to detect hail, wind, and shingle damage.
3. Generate HAAG-standard claim packets ready for adjusters and insurers.

### Brand & UX direction

- Clean, minimal, card-based layout
- Lots of white space, rounded corners, subtle shadows
- Orange accent (`#F26B1F`)
- Bottom tab nav; central `+` quick action button

---

## Information Architecture

**Bottom tab bar:** Dashboard, Leads, Map, Inspections, Jobs, Storm Intel, Reports, Settings.

**Central `+` button:** quick actions (Quick Inspection, New Job, New Lead).

---

## Feature Backlog & Status

| # | Feature | Status |
|---|---|---|
| 1 | Dashboard scaffold (KPIs, schedule, pipeline, AI insights, tasks, activity) | Implemented |
| 2 | Bottom tab nav + sidebar shim | Implemented |
| 3 | NOAA storm history map (4-year hail/wind) | Implemented |
| 4 | Supabase auth (email + Apple) + persisted session | Not started |
| 5 | Supabase leads sync + RLS | Not started |
| 6 | Dashboard CTAs (Quick Inspection + New Job) | Not started |
| 7 | Recent Jobs strip | Not started |
| 8 | Quick Inspection camera flow | Not started |
| 9 | Slope selector dropdown | Not started |
| 10 | Multi-photo capture strip | Not started |
| 11 | Gemini 3 Pro vision analysis | Not started |
| 12 | Damage taxonomy + Damage Score + Claim Worthiness | Not started |
| 13 | HAAG grading + Claim Packet sheet | Not started |
| 14 | Storm map filters (year/type) + event detail sheet | Not started |
| 15 | Pitch + Elevation HUD (CoreMotion-equivalent via expo-sensors + expo-location) | Not started |
| 16 | Mileage tracker (background) | Not started |
| 17 | Proposals + PDF export (expo-print) | Not started |
| 18 | Push notifications for storm alerts | Not started |
| 19 | RevenueCat paywall | Not started |
| 20 | EAS Build → TestFlight + Play Store internal | Not started |

---

## Key Technical Decisions

- **Framework:** Expo SDK 51, React Native 0.74, TypeScript.
- **AI Vision:** Google Gemini 3 Pro via direct REST call to `generativelanguage.googleapis.com`. API key in `EXPO_PUBLIC_GEMINI_API_KEY`.
- **Backend:** Supabase (project `mzsabjegtxmzlfpxmmfm`). Auth + Postgres + storage. Row-level security per user.
- **State:** Zustand for client state; Supabase as source of truth for synced data.
- **Sensors:** `expo-sensors` (accelerometer for pitch) + `expo-location` (altitude). Mock values in simulator.
- **Camera:** `expo-camera` with custom HUD overlays.
- **No LiDAR in v1.** Camera-only.

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
- Adopted `CONTRIBUTING.md` (the 3-rule AI agent contract) and `PROMPT_LOG.md` (this file) from the rork repo, adapted for Expo + iOS/Android.
- Drift Warnings updated: #9 now pins Gemini 3 Pro via direct Google API (was Gemini 1.5 Flash via rork toolkit). Added #10 (no LiDAR/ARKit in v1).
- Drift Warnings #1–#8 carried over verbatim. Damage taxonomy expanded to the 13 canonical snake_case tokens used in the latest rork code (vs. the 10-item list in the older rork PROMPT_LOG).
- Feature Backlog rebuilt to reflect the Expo repo's actual state (most rork-era "Implemented" rows are now "Not started" here).

**Files touched:**
- `CONTRIBUTING.md` — created.
- `PROMPT_LOG.md` — created with full Context Summary, Drift Warning, Constraint Verification Protocol, Project Overview, IA, Feature Backlog, Key Technical Decisions, and this entry.

**Open questions / Follow-ups:**
- Set up Supabase JS client + persistent session storage (next entry).
- Build Welcome/Sign-in screen (Apple + email) per `PLAN.md` from the rork repo.
- Get a `EXPO_PUBLIC_GEMINI_API_KEY` from Google AI Studio for Quick Inspection.
- Decide on splitting EAS profiles for dev / preview / production builds.

---

### [2026-06-09] #02 — Supabase auth foundation + email sign-in gate

**Prompt (summarized):**
> Begin work on the migration. Start with the foundation — Supabase auth + the Welcome / sign-in screen.

**Intent / Goal:**
- Wire Supabase into the Expo app so future features can persist per-user data.
- Block unauthenticated users at launch with a Welcome screen that supports email sign-in, account creation, and password reset.
- Lay the groundwork for Apple Sign In in a follow-up entry.

**Decisions made:**
- Installed `@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `react-native-url-polyfill`.
- Supabase URL + anon key live in `lib/env.ts` with safe public fallbacks (project `mzsabjegtxmzlfpxmmfm`); real keys go in `.env.local` (gitignored, example committed).
- Auth state is a Zustand store (`lib/auth/authStore.ts`) initialized in the root layout, with persistent session via AsyncStorage.
- Auth gate is implemented as redirects in `app/index.tsx` (entry) and `app/(tabs)/_layout.tsx` (group gate). Unauthenticated visits to `/(tabs)` redirect to `/welcome`; authenticated visits to `/welcome` redirect to `/(tabs)`.
- Welcome screen is a single screen that toggles between Sign In / Create Account / Reset Password modes (orange gradient background per `theme/tokens.ts`, white card, 56pt primary button).
- Settings tab now shows the signed-in email, account creation date, and a destructive Sign Out pill — replacing the prior stub.

**Files touched:**
- `package.json`, `package-lock.json` — added Supabase + AsyncStorage + URL polyfill.
- `lib/env.ts` — created; central env-var reader with public fallbacks.
- `lib/supabase.ts` — created; Supabase client init with AsyncStorage session storage.
- `lib/auth/authStore.ts` — created; Zustand store for session, sign in / sign up / reset / sign out.
- `app/_layout.tsx` — initializes the auth store on mount and unsubscribes on unmount.
- `app/index.tsx` — created; redirects to `/welcome` or `/(tabs)` based on session.
- `app/welcome.tsx` — created; sign-in / sign-up / reset screen with gradient + form card.
- `app/(tabs)/_layout.tsx` — added auth gate that redirects to `/welcome` when no session.
- `app/(tabs)/settings.tsx` — replaced stub with real Account section + Sign Out.
- `.env.local.example` — created.
- `components/dashboard/OverviewKpis.tsx` — fixed duplicate `key` prop TS errors (unrelated cleanup).
- `theme/tokens.ts` — removed dead `web: { boxShadow }` blocks now that the project is mobile-only.

**Open questions / Follow-ups:**
- Apple Sign In: needs `expo-apple-authentication`, Supabase Apple provider configuration, and an iOS bundle entitlement. Park as entry #03.
- Verify email confirmation flow: Supabase project may require confirmation before sign-in succeeds. Confirm with founder whether to disable that for dev or wire up the deep-link confirmation handler.
- Strip remaining web-only deps from `package.json` (`react-native-web`, `react-dom`, `react-leaflet`, `leaflet`) in a future cleanup pass.
- Create the `leads` table + RLS in Supabase before wiring lead sync.
