# RoofWise

CRM + AI assistant for roofing companies. Mobile-first dashboard built with Expo (React Native + Web), with a 4-year hail/wind storm history map sourced from live NOAA data.

## Quickstart

```bash
npm install
npx expo start --web   # browser
npx expo start         # then scan with Expo Go on your phone
```

Open `http://localhost:8081`. Resize the browser to switch between the mobile bottom-nav layout and the desktop sidebar + top-bar layout.

## What's in here

- `app/` — Expo Router screens (Dashboard, Leads, Map, Inspections, Jobs, Storm Intel, Reports, Settings).
- `components/dashboard/` — KPIs, weather/storm hero, area-activity map, sales pipeline, today's schedule, **recent jobs photo strip**, AI insights queue, tasks, activity.
- `components/map/` — `react-native-maps` on iOS/Android, `react-leaflet` on web (platform shim via `.native.tsx` / `.web.tsx`). Renders 4 years of NOAA hail/wind reports.
- `lib/noaa.ts` — fetches and normalizes the IEM Local Storm Reports GeoJSON feed.
- `lib/mock/` — leads, jobs, schedule, pipeline, recent jobs, tasks, activity.
- `theme/tokens.ts` — colors (orange `#F26B1F` accent), radii, shadows, typography.

## Storm data source

[Iowa Environmental Mesonet — Local Storm Reports](https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py). Free, no API key. We request `type=H` (hail) and `type=W` (wind) over a 4-year window and a state filter, then crop client-side to the visible bounding box.
