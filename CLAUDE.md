# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RoofWise is a mobile-first CRM and AI assistant for roofing companies built with **Expo 51 (React Native + Web)**. It features a responsive dashboard that adapts between mobile (bottom-nav) and desktop (sidebar + top-bar) layouts, integrated with a 4-year NOAA storm history map.

## Commands

```bash
# Start dev server (interactive — choose platform)
npm start

# Run on web directly
npm run web

# Run on iOS / Android (requires Expo Go or simulator)
npm run ios
npm run android

# Lint
npx expo lint

# Type-check (no emit)
npx tsc --noEmit
```

There is no test suite yet.

## Architecture

### Routing
Expo Router with file-based routing. All screens live in `app/(tabs)/`. The root `_layout.tsx` wraps the whole app with `SafeAreaProvider`, `GestureHandlerRootView`, and `StatusBar`. The tabs `_layout.tsx` uses `useResponsive()` to switch layouts:
- **Desktop (≥1100px):** `Sidebar` + `TopBar` + scrollable content area
- **Mobile (<768px):** `SafeAreaView` (top only) + `BottomTabs`

### Responsive System
`theme/useResponsive.ts` — `isMobile`, `isTablet`, `isDesktop`, `isWide` hooks driven by breakpoints in `theme/tokens.ts` (`md=768`, `lg=1100`). Use these instead of hardcoding dimensions. Tokens also export `colors`, `spacing`, `radii`, `fontSize`, `fontWeight`, and `shadows`.

### Platform Shims (Maps)
The storm map uses a `.native.tsx` / `.web.tsx` split:
- `components/map/StormHistoryMap.tsx` — export shim (re-exports the right platform file)
- `components/map/StormHistoryMap.native.tsx` — `react-native-maps`
- `components/map/StormHistoryMap.web.tsx` — `react-leaflet` + Leaflet

Add any other platform-divergent components with the same `<Name>.native.tsx` / `<Name>.web.tsx` pattern.

### Data Layer
All data is currently **mock** — no backend or database exists. Mock fixtures with TypeScript types live in `lib/mock/` (`leads.ts`, `recentJobs.ts`, `schedule.ts`, `tasks.ts`, `aiInsights.ts`, `activity.ts`).

The one real external call is NOAA storm history: `lib/noaa.ts` fetches IEM LSR GeoJSON and normalizes it into `StormEvent` objects. The map is currently hardcoded to Texas (`TX`) but the fetch function accepts a state parameter.

### State Management
Zustand is installed (`zustand 4.5.2`) but not yet wired to any screens. It's the intended solution when mock data gets replaced.

### Styling
All styling uses React Native `StyleSheet`. No external UI library — all components are custom. Platform-specific shadows: iOS uses `shadowColor/Offset/Opacity/Radius`, Android uses `elevation`, web uses `boxShadow` (handled in `theme/tokens.ts` shadow tokens). Do not use inline styles for anything beyond one-offs.

### Key Data Types

```typescript
// lib/mock/leads.ts
Lead { id, name, address, stage: 'New'|'Contacted'|'Proposal'|'Won'|'Lost',
       value, lat, lon, storm?: 'hail'|'wind', contactedDaysAgo? }

// lib/noaa.ts
StormEvent { id, lat, lon, type: 'hail'|'wind', magnitude, occurredAt,
             remarks, city, state, source: 'iem-lsr' }

// lib/mock/recentJobs.ts
RecentJob { id, property, address, status: 'Done'|'Active'|'Scheduled'|'Needs Review',
            subtitle, photoUrl }
```

### Path Alias
`@/*` resolves to the repository root (configured in `tsconfig.json`). Use `@/components/...`, `@/lib/...`, `@/theme/...`, etc. for all imports.
