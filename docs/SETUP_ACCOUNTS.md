# External accounts & API setup

Checklist for wiring RoofWise's third-party services. **This is the Expo/React
Native codebase** — if a piece of guidance mentions `APIKeys.swift`, `USE_MOCKS`,
`#if canImport(...)`, Xcode Swift Packages, or a MOCK/LIVE pill, it belongs to
the archived Swift repo (`paxstudios/rork-roofwise-dashboard-`) and does **not**
apply here. This app has no mocks at all (Drift Warning #5).

---

## ✅ Settled: the bundle ID is `com.roofwise.app`

**Decided 2026-07-22 (entry #42).** Both platforms in `app.config.js` already
declare it consistently:

```
ios.bundleIdentifier = 'com.roofwise.app'
android.package       = 'com.roofwise.app'
```

Earlier notes referenced `com.paxconsulting.roofwise`. That is **not** the
identifier — it was never in the code. `com.roofwise.app` wins because it is
already coherent across both platforms, matches the product name, and changing
it costs config churn for zero benefit before launch. (After the first App Store
submission the bundle ID is permanent, so this is the moment it was cheap to
settle.)

**Use `com.roofwise.app` everywhere:** the Apple Developer App ID, the iOS
application restriction on Google keys, and the Android restriction (which also
needs the release keystore SHA-1). Restricting a key to any other value silently
breaks Maps, Places, and Solar in the shipped app with an unhelpful error.

---

## Apple Developer Program — $99/yr

Required for: TestFlight distribution, Apple Sign In, WeatherKit (if adopted),
background execution, geofenced mileage.

1. Enroll at https://developer.apple.com/programs/
2. Certificates, Identifiers & Profiles → Identifiers → register the bundle ID
3. Enable the capabilities you need on that App ID

Until enrolled, Expo Go covers solo device testing. See BACKLOG for the EAS /
TestFlight task.

---

## Google Cloud (project: `gen-lang-client-0432200648`)

### APIs to enable
APIs & Services → Library → Enable each:

| API | Used by | Notes |
|---|---|---|
| Maps SDK for iOS | `components/map/Map.tsx` | Native maps on device |
| Maps SDK for Android | same | |
| Places API | `lib/services/places.ts` | Address autocomplete in New Job wizard |
| Geocoding API | `lib/services/geocoding.ts` | Address → lat/lng |
| Solar API | `lib/services/solar.ts` | Roof measurement → Cost Estimator |
| Weather API | `lib/services/weather.ts` | Current conditions tile |

**Billing must be linked** or Maps and Solar return PERMISSION_DENIED.

### Key restrictions (do before any real ship)
Currently the keys have no application restrictions — anyone who extracts them
from a build can bill your account.

- **Application restrictions** → iOS apps → add the bundle ID (see warning above).
  Add an Android apps entry too, with the package name + SHA-1.
- **API restrictions** → tick only the APIs listed above.

Keep the direct console deep-links to each key in your password manager, not in
this repo.

### Where keys live in this codebase
`.env.local` (gitignored), read through `lib/env.ts`. Never hardcode. Template is
`.env.local.example`. For EAS builds, the same variables go in **EAS Secrets**.

```
EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY=
EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY=
EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY=
EXPO_PUBLIC_GEMINI_API_KEY=
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

### Solar API cost
~$5 per 1,000 `buildingInsights:findClosest` calls — about half a cent per
inspection. No free tier. Set a GCP budget alert. Coverage is roughly 80% of US
single-family homes; `lib/services/solar.ts` handles no-coverage responses by
falling back to manual entry (never by synthesizing data).

Verify with:
```sh
curl "https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=40.7128&location.longitude=-74.0060&key=YOUR_KEY"
```

---

## Gemini (AI Studio) — model + deprecation fallback

`lib/services/gemini.ts` calls the Google AI Studio REST endpoint
(`generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`)
with the key in `EXPO_PUBLIC_GEMINI_API_KEY`.

**Model:** `EXPO_PUBLIC_GEMINI_MODEL`, default **`gemini-3.8-flash`** (newest
Flash as of 2026-09-01 — owner directive: "Gemini flash 3.7 or the newest
version"). Flash answers the 2560px vision + structured-JSON damage request in
roughly 1.5–3 s.

**`gemini-2.5-pro` is retired for new keys.** Google now answers
`404 "This model models/gemini-2.5-pro is no longer available to new users"`
for it, which is what broke photo analysis entirely. Never pin it again.

**Fallback chain (deprecation-proof).** The configured model is only the first
one tried. On HTTP 404 / `NOT_FOUND` / "no longer available" the client moves to
the next entry:

```
<EXPO_PUBLIC_GEMINI_MODEL> → gemini-3.8-flash → gemini-3.7-flash → gemini-3.5-flash → gemini-2.5-flash
```

The model that actually answered is stored on every analysis result
(`modelUsed`, plus `latencyMs`) and on each photo's `photoAnalysis` state, so
the report footer and Diagnostics show honest provenance. Once a fallback has
answered, later calls in the same app session start from it (no 404 round-trip
per photo); a fresh launch re-tries the configured model.

**Every other error surfaces as itself** — quota (429), invalid/unauthorized
key (400/403), safety block, network, 5xx, or the 60 s per-attempt timeout —
never retried across models, and shown to the roofer per photo as
"Analysis failed — <reason> · Retry".

Verify a key + model quickly:
```sh
curl -sS "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=YOUR_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"Reply with the single word OK."}]}]}'
```
A 404 here means that model id is gone for your key; list what the key can use
with `curl -sS "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY"`.

---

## Weather: already wired, and it's Google — not Apple

`lib/services/weather.ts` is a **Google Weather API** client and works today with
the existing Maps key. It powers `components/WeatherTile.tsx`.

Apple **WeatherKit** is a different product and is *not* wired into this app.
Adopting it would mean a paid Apple Developer account, an entitlement on the App
ID, a custom Expo config plugin, and a dev build — it cannot work in Expo Go.
Its advantage is 500K free calls/month.

**Recommendation: don't.** Google Weather already works and shares a key you're
already paying to maintain. Revisit only if weather call volume gets expensive.

---

## Supabase

Project `yyzjosttvpleehzmhhxy`. **Free tier auto-pauses after ~7 idle days**,
which surfaces in the app as "network request failed" at sign-in. Restore from
the dashboard, or move to Pro ($25/mo) before field trials — a paused backend
during a contractor demo is unrecoverable in the moment.

---

## Status summary

| Service | State | Action needed |
|---|---|---|
| NOAA storm events | Live, keyless | none |
| Gemini (gemini-3.8-flash, fallback chain) | Live | key in `.env.local`; 2.5-pro retired for new keys |
| Google Weather | Wired | enable API + billing |
| Google Maps / Places / Geocoding | Wired | enable APIs, add key restrictions |
| Google Solar | Wired | enable API, set budget alert |
| Supabase | Live | keep un-paused; Pro before field trials |
| Apple WeatherKit | Not adopted | intentionally skipped — see above |
| Apple Developer | Not enrolled | needed for TestFlight / Apple Sign In |
