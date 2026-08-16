# CLAUDE.md — RoofWise

Fast-path onboarding for Claude Code (and any other AI agent) opening this repo. Read this in full before editing.

This file is the *short* contract. The *long* contracts are:
- `CONTRIBUTING.md` — the 3 Rules (PROMPT_LOG discipline).
- `PROMPT_LOG.md` — single source of truth for intent, drift warnings, and per-prompt history.
- `docs/SPEC.md` — the product spec (2680 lines).

If this file and `PROMPT_LOG.md` disagree, **the log wins.**

---

## What RoofWise is

The objective layer between roofing contractors and insurance carriers — AI vision + HAAG-protocol-compliant claim packets on a mobile device. Built for **a gloved roofer on a hot roof**: large touch targets, sun-readable contrast, voice on free text, no precision gestures.

A denied claim costs the contractor $5–20K; an approved one is worth $10–50K. One extra approval per month pays for the app.

---

## The 3 Rules (from CONTRIBUTING.md)

1. **Read `PROMPT_LOG.md` first** — Context Summary, Drift Warning, Constraint Verification Protocol, last 3 entries. If the request contradicts a Drift Warning, surface it before acting.
2. **Append an entry after every change** using the template in `PROMPT_LOG.md`. Append-only — never edit/delete past entries.
3. **Refresh the Context Summary every 5+ new entries.**

**Plus the backlog rule:** `BACKLOG.md` is the single ledger of deferred work.
Read it right after the Context Summary. When you defer something, add it there
*in the same commit* — a follow-up note inside a PROMPT_LOG entry alone is how
work gets lost. When you finish something, move it to Done with the closing
entry number. When the user asks "what's next," answer from BACKLOG.md.

---

## Stack

- **Framework:** Expo SDK 51, React Native 0.74, TypeScript, expo-router (file-based).
- **State:** Zustand stores with `persist` + AsyncStorage. Per-feature store under `lib/stores/`.
- **Backend:** Supabase (auth + Postgres + Storage). Client at `lib/supabase.ts`. Auth store at `lib/auth/authStore.ts`.
- **AI vision:** Gemini **2.5 Pro** via Google AI Studio direct REST (`lib/services/gemini.ts`). Higher accuracy for ambiguous damage than the previous 2.5 Flash default; trade-off is ~5× cost + slower latency per call. **There is no `gemini-3-flash` / `gemini-3.5-flash`** — Drift Warning #9.
- **Maps:** `react-native-maps` with `PROVIDER_GOOGLE` (iOS + Android). Unified abstraction in `components/map/Map.tsx`.
- **Native modules in use:** expo-camera, expo-location, expo-sensors, expo-haptics, expo-image, expo-image-manipulator, expo-image-picker, expo-print, expo-file-system, expo-notifications, expo-av, expo-apple-authentication, expo-clipboard, expo-document-picker, expo-sharing, react-native-reanimated, react-native-gesture-handler, react-native-svg.
- **Theme:** `theme/tokens.ts` — `colors`, `fontSize`, `fontWeight`, `radii`, `spacing`, `shadows`, `touchTarget`, `motion`. **Never inline hex / font sizes.** (Drift Warning #11.)

---

## Information architecture

**5 bottom tabs:** Home / Leads / Map / Plan / Train. Settings is a route, not a tab. (Drift Warning #2.)

Routes live under `app/`:
- Tab roots — `app/(tabs)/{index,leads,map,plan,train,settings}.tsx`
- Auth & onboarding — `app/{welcome,onboarding,index}.tsx`
- Wizards / flows — `app/{new-job,new-lead,quick-inspection,analyze,edit-detection,swipe-review,damage-explainer}.tsx`
- Detail screens — `app/{job,lead,proposal,storm-alert,p}/[id].tsx`
- Tools — `app/{pitch-gauge,activity,door-knocking,mileage,estimator,hail-tracer,inspections,search,reports,safety-check}.tsx`
- Settings sub-routes — `app/settings/{service-area,inspector-profile,backup,about}.tsx`

---

## Source documents — read before changing inspection logic

The product truth lives in two places. When they disagree, **the Drive documents
win on logic and thresholds; the repo wins on structure and file layout.**

| Document | Authority over |
|---|---|
| **`docs/HAAG_DECISION_ENGINE.md`** | Functional-damage definition, material thresholds, repairability gates, decision tree, RC cost formula, Claim Viability bands, Safety engine, carrier behavior, capture methodology, accuracy targets |
| `docs/SPEC.md` | Product scope, IA, feature phases, damage taxonomy |
| Owner's Drive folder | Original sources. `Haag's full Protocol for Assessment of Hail-Damaged Roofing`, `RoofWise Prompt for HAAG: DECISION ENGINE SYSTEM`, `Quadrant — AI Roof Inspection App` technical spec, `RoofWise_Next_Build_Prompt.md` |

`docs/HAAG_DECISION_ENGINE.md` was reconstructed from those Drive sources and
**corrected thresholds that earlier code had wrong**. Do not "simplify" it.

---

## Drift warnings (the non-negotiables)

Pulled from `PROMPT_LOG.md`. The full list is canonical there; this is the short form.

1. Persona is a gloved roofer in sun. ≥56pt touch targets, sticky 88pt CTAs, high contrast, voice on free text, confirm sheets on destructive actions.
2. 5 tabs: Home / Leads / Map / Plan / Train.
3. Dashboard hero CTAs are **Quick Inspection + New Job**, side by side. No KPI buttons in their place.
4. Storm Alert hero **hides** when there is no active alert. Never a stale placeholder.
5. **No mocks, no seeded sample data.** App boots empty. Service unreachable → friendly "Not available", never synthesize.
6. Damage taxonomy is the **13 canonical categories** (`docs/SPEC.md`). Each finding has severity + 0–100 confidence.
7. HAAG thresholds are **material-specific** and are defined by **`docs/HAAG_DECISION_ENGINE.md`**, not by memory or convenience. 3-tab asphalt is **>5** hits per test square; laminate/architectural is **>8**. Repairability gates (discontinued material, brittleness FAIL/BORDERLINE, 2+ layers) **override hit counts** and force replacement on their own.
8. Decision Engine is **pure logic** — no I/O. Lives in `lib/services/decisionEngine.ts`. It must emit `roofwise_recommendation`, `claim_viability`, and `roofer_safety_rating` per `docs/HAAG_DECISION_ENGINE.md` §9.
9. Gemini model: `gemini-2.5-pro` via Google AI Studio direct REST. No `gemini-3-flash` / `gemini-3.5-flash` (neither exists).
10. **No LiDAR / ARKit in v1.** Camera-only.
11. Theme tokens everywhere — no inline hex / font sizes.
12. `requireAuth` flag wired from day one; false during dev.
13. Append, don't rewrite, the Prompt History.

---

## Secrets policy

- All client env vars live in `.env.local` (gitignored). Template is `.env.local.example`.
- `app.config.js` reads `process.env.EXPO_PUBLIC_*` at build time. **Never** hardcode keys in `app.json`, source, or commits.
- Required for full functionality:
  - `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - `EXPO_PUBLIC_GEMINI_API_KEY`
  - `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`, `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`, `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` (Places / Solar / Weather / Geocoding share these as appropriate)
- `SUPABASE_SERVICE_ROLE_KEY` is **server-only** — it must never ship in a client bundle.
- If a key was ever pasted in chat, treat it as exposed and rotate.

---

## Branch & git policy

- **Develop and push only to `claude/wonderful-franklin-HuSTl`.** Never push to a different branch without explicit permission.
- `git push -u origin claude/wonderful-franklin-HuSTl`. Retry up to 4× with exponential backoff (2s/4s/8s/16s) on network errors only.
- The container is ephemeral — only commits pushed to GitHub are durable. Working tree can reset to older commits between sessions; fast-forward from `origin/claude/wonderful-franklin-HuSTl` when it does.
- Do **not** open a PR unless the user explicitly asks.
- GitHub MCP scope is restricted to `paxstudios/roofwiseclaude` — calls outside that are denied.

---

## Common commands

```sh
# Dev
npm install                       # or: npm ci  (preferred when lockfile is current)
npx expo install --check          # verify native module versions match SDK 51
npx expo start --clear            # clear Metro cache; press i for iOS Expo Go, a for Android
npm run typecheck                 # tsc --noEmit
npm run lint                      # expo lint
```

**Native modules:** install via `npx expo install <pkg>` (not plain `npm install`) so versions stay pinned to the SDK. The AsyncStorage version-mismatch crash (`Native module is null, cannot access legacy storage`) came from a plain `npm install` — fix is `npx expo install @react-native-async-storage/async-storage` (locked to `1.23.1` for SDK 51).

---

## Where things live

| Concern | Path |
|---|---|
| Theme tokens | `theme/tokens.ts` |
| Data model types | `lib/models/types.ts` |
| Env reader | `lib/env.ts` |
| Supabase client | `lib/supabase.ts` |
| Auth store | `lib/auth/authStore.ts` |
| Zustand stores | `lib/stores/*.ts` |
| Pure services (HAAG, decision, taxonomy) | `lib/services/{decisionEngine,haagThresholds,haagPdf,proposalGenerator,proposalPdf,costEstimator}.ts` |
| Network/IO services | `lib/services/{gemini,places,solar,geocoding,weather,stormMatch,stormWatch,pushNotifications,transcribeAudio,analyzeSlope}.ts` |
| Cloud sync | `lib/services/{leadSync,inspectionSync,photoSync,correctionsSync,analysisQueue,lifecycleHooks,backup}.ts` |
| Learning loop | `lib/services/learning/{userCorrectionProfile,localLearningEngine}.ts` |
| Shared UI | `components/{ScreenHeader,PressableScale,SignaturePad,VoiceNoteRecorder,AnalysisQueueChip,DamageScoreBar,DamageMarkerLayer,CameraHUD,WeatherTile,AICalibrationCard,AddressAutocomplete,AppleSignInButton,ToastHost}.tsx` |
| Map abstraction | `components/map/Map.tsx` |
| Bottom tab shell | `components/shell/BottomTabs.tsx` |

---

## Known parked items (don't quietly resurrect)

- **Apple Sign In** — doesn't work in Expo Go; needs `expo run:ios` dev build + Supabase Apple provider configured (Services ID + .p8 key). Email/password is the working path today.
- **True background execution** (expo-task-manager) — needs a dev build.
- **Mileage auto-tracking via geofencing** — same constraint.
- **Voice input on free-text fields** beyond `expo-av` recording — needs a native module beyond Expo Go.
- **LiDAR / ARKit** — Drift Warning #10.

---

## When in doubt

- Spec question → `docs/SPEC.md`.
- "Why is it this way?" → `PROMPT_LOG.md` Prompt History.
- "What's the rule?" → Drift Warning section of `PROMPT_LOG.md`.
- "What's the contract for changes?" → `CONTRIBUTING.md`.
