# BACKLOG — the "don't lose it" ledger

Every deferred decision, parked follow-up, and "later" from PROMPT_LOG lives here
in one place. **Any agent starting work in this repo reads this file after
PROMPT_LOG's Context Summary** (CLAUDE.md enforces this). When you complete an
item, move it to Done with the entry number that closed it. When you defer new
work, add it here in the same commit — a follow-up note buried in a PROMPT_LOG
entry does not count as tracked.

> Format: `- [ ] Item — source #entry · why it matters`

---

## Now (committed next steps, in order)


- [ ] **Device pass on a real iPhone** — verify (a) rectangle overlays + withheld-detections toast against a live analysis [#39], and (b) the new 2560px analyze profile is actually selected (not the SAFE fallback), with no OOM on a long capture session [#41] · built and typechecked, but not yet seen with live Gemini output

## Next

- [ ] Add an explicit state picker to `app/settings/service-area.tsx` so storm-query resolution is deterministic rather than parsed from free-text labels — #43

- [ ] Welcome screen pre-checks `isSupabaseConfigured` and shows a banner before first submit — #35
- [ ] Settings screen "backend: not configured / connected" indicator — #35 · faster field debugging
- [ ] Device pass on motion layer: confirm 60fps dashboard stagger with long lists; profile `AnimatedCounter` setState cost — #34
- [ ] Capture web-preview launch recipe as a project skill via `/run-skill-generator` — #38 · so future sessions don't rediscover the expo-web + Playwright dance
- [ ] Configure EAS (`eas.json` + EAS Secrets for the `EXPO_PUBLIC_*` keys) for TestFlight distribution — asked 2026-07-22 · required to put builds in contractors' hands for field trials; needs Apple Developer Program ($99/yr). Expo Go is fine for solo testing until then.
- [ ] Apple Developer Program enrollment ($99/yr) — 2026-07-22 · gates TestFlight, Apple Sign In, background execution, geofenced mileage
- [ ] Enable + restrict Google APIs (Maps iOS/Android, Places, Geocoding, Solar, Weather) on project `gen-lang-client-0432200648`; link billing; set a Solar budget alert — 2026-07-22 · see `docs/SETUP_ACCOUNTS.md`

## Before ship (release blockers)

- [ ] `REQUIRE_AUTH=true` end-to-end re-test (welcome gate → sign-in → tabs) — #38
- [ ] Rotate ALL API keys ever pasted in chat (Gemini, Supabase anon, Maps) — Context Summary standing item
- [ ] Supabase project on a paid tier (free tier auto-pauses after 7 idle days → "network request failed" in the field) — session 2026-07-07
- [ ] Web is preview-only — confirm no web target ships; camera/maps/sensors/PDF are device-only — #38

## Marketing (website/ folder)

- [ ] Replace stylized CSS roofs in site + videos with cleared field photos — #36
- [ ] Register roofwise.app, host `website/` (Vercel/Netlify static drop) — #36
- [ ] Record MP4s of ad-30s and social-15s players (⌘⇧5 screen record) or hand to editor — #36
- [ ] Founder video: replace [BRACKETED] bio placeholder with real one-liner — #37 · blocks any public use
- [ ] Founder video photoreal pass via HeyGen/Synthesia (disclose AI-generated) — #37

## Parked (needs a decision or a dev build — don't quietly resurrect)

- [ ] Reduced-motion accessibility toggle (`AccessibilityInfo.isReduceMotionEnabled` zeroes motion tokens) — #34 · waiting on user demand
- [ ] Claude vision A/B as second damage-detection provider — #32 · only if bbox accuracy disappoints in the field
- [ ] Apple Sign In · true background execution · geofenced mileage · native voice-to-text · LiDAR — CLAUDE.md "Known parked items" (Drift #10 for LiDAR)

## Done (most recent first)

- [x] Full 35-route audit harness; 35/35 clean — closed by #42
- [x] setState-during-render in ProposalView (double-create / dropped write) — closed by #42
- [x] Cold-launch nav crashes (quick-inspection redirect + notification deep link) — closed by #42
- [x] "Invalid Date" leaking to users and into HAAG/proposal PDFs — `lib/format/date.ts` — closed by #42
- [x] HAAG PDF: roadmap-language leak, methodology block, section numbering, print page-breaks — closed by #42
- [x] Motion layer on Settings + Job/Lead detail — closed by #42
- [x] Accessibility labels on icon-only controls — closed by #42
- [x] Hardcoded 'TX' in Map + Hail Tracer — now resolves from Service Area → recent inspection → default (`lib/services/serviceState.ts`) — closed by #43

- [x] Bundle ID settled: `com.roofwise.app` (both platforms already agreed; unblocks Google key restrictions) — closed by #42
- [x] App-level ErrorBoundary — crash shows a recoverable screen instead of a white screen — closed by #42
- [x] Navigator-readiness guards on cold-launch deep links (quick-inspection safety redirect, notification tap handler) — closed by #42
- [x] Lint warnings cleared to zero — closed by #42

- [x] Two-profile image pipeline (2560px/0.82 analyze + 1600px safe fallback, camera quality 0.7→0.95) — closed by #41
- [x] ESLint linting the `dist/` web-export bundle (2036 bogus errors) — closed by #41
- [x] Audit the stale Feature Backlog table in PROMPT_LOG — closed by #40

- [x] Rectangle damage overlays from bbox data — closed by #39 (was #32 follow-up)
- [x] "AI withheld detections" inspector toast — closed by #39 (was #31 follow-up)
- [x] Honor `REQUIRE_AUTH` at auth gates (Drift #12 bug) — closed by #38
- [x] Web preview support (expo web + Playwright headless drive) — closed by #38
- [x] Supabase dead-project fallback removed, friendly not-configured gate — closed by #35 (was #24 gotcha)
- [x] App-wide motion layer (5 tabs, BottomTabs, DamageScoreBar, WeatherTile skeleton) — closed by #34
