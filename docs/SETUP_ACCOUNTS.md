# External accounts & API setup

Checklist for wiring RoofWise's third-party services. **This is the Expo/React
Native codebase** — if a piece of guidance mentions `APIKeys.swift`, `USE_MOCKS`,
`#if canImport(...)`, Xcode Swift Packages, or a MOCK/LIVE pill, it belongs to
the archived Swift repo (`paxstudios/rork-roofwise-dashboard-`) and does **not**
apply here. This app has no mocks at all (Drift Warning #5).

---

## ⚠️ Resolve first: which bundle ID?

`app.config.js` currently declares:

```
ios.bundleIdentifier = 'com.roofwise.app'
```

Some earlier notes reference `com.paxconsulting.roofwise`. **These must match**
before you add an iOS application restriction to any Google API key — restricting
the key to the wrong bundle ID silently breaks Maps, Places, and Solar in the
shipped app, and the failure message is unhelpful.

Pick one, then make it consistent across: `app.config.js`, the Apple Developer
App ID, and every Google Cloud key restriction.

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
| Gemini 2.5 Pro | Live | key in `.env.local` |
| Google Weather | Wired | enable API + billing |
| Google Maps / Places / Geocoding | Wired | enable APIs, add key restrictions |
| Google Solar | Wired | enable API, set budget alert |
| Supabase | Live | keep un-paused; Pro before field trials |
| Apple WeatherKit | Not adopted | intentionally skipped — see above |
| Apple Developer | Not enrolled | needed for TestFlight / Apple Sign In |
