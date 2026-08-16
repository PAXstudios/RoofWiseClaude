# BACKLOG — the "don't lose it" ledger

Every deferred decision, parked follow-up, and "later" from PROMPT_LOG lives here
in one place. **Any agent starting work in this repo reads this file after
PROMPT_LOG's Context Summary** (CLAUDE.md enforces this). When you complete an
item, move it to Done with the entry number that closed it. When you defer new
work, add it here in the same commit — a follow-up note buried in a PROMPT_LOG
entry does not count as tracked.

> Format: `- [ ] Item — source #entry · why it matters`

---

## Now (committed next steps, in order — see docs/PRODUCT_SYNTHESIS.md §5 for the full rationale)

- [ ] **19-area slope/subject tagging + Single-Shingle vs 10x10-Square capture modes** with separately aggregated counts; label burned into photo — synthesis 2026-08-16
- [ ] **Persist the engine result on the inspection** — `haagPdf.ts` still runs `evaluate()` fresh at render time; store the full `HaagEngineResult` at analysis/finalize time and have every report surface read the stored payload (Long Report already takes a payload) — #50 integration note
- [ ] **Wire a real forecast into `HaagEngineInput.forecast`** — `roofer_safety_rating` reads "Use caution" until WeatherTile/Open-Meteo data reaches the engine; also gate Quick Inspection entry on `evaluateSafety()` — #50 integration note
- [ ] **Device pass on a real iPhone** — verify (a) rectangle overlays + withheld-detections toast against a live analysis [#39], (b) the 2560px analyze profile is actually selected with no OOM [#41], and (c) the new claim-evidence photo attach + responsive shell on tablet [#50]

## Soon (from the 2026-08-16 Drive synthesis — after Now clears)

- [ ] Damage Score reconciliation — Kanban PRD defines 1–100 INVERTED (1–30 red/severe, 61–100 green/repair); reconcile `DamageScoreBar` semantics explicitly, don't silently flip. `damageScore()`/`claimWorthiness()` are now deprecated wrappers over the §6 claim-viability band; homeowner-summary tone branches in `haagPdf.ts` still key off the old worthiness scale — synthesis + #50
- [ ] Watch Train-tab queue volume — the new <80% expert-review gate queues far more photos than the old avg<60 rule (store caps at 500); consider queueing only the sub-80 subset per photo — #50
- [ ] Enforce brittleness-protocol photos (≥1) before a claim-mode report can finalize — the job screen warns and the report discloses the gap, but generation isn't blocked; needs a finalize step — #50
- [ ] Migrate `map.tsx`/`hail-tracer.tsx` to `fetchAddressStormHistory` (4-year clamp); `lib/noaa.ts` severityColor still keys hail colors at 0.75" with inline hex (pre-existing Drift #11 debt) — #50
- [ ] Claim-evidence photo attach bypasses `prepareCapturedPhoto` (no resize profile); route through the image pipeline — #50
- [ ] Real date-of-loss capture in claim mode — Triple-Check currently falls back to the attached event's own date when no user DOL exists, which trivially satisfies the ±72h leg; the HIGH-band criterion only has teeth with a user-entered DOL — #50
- [ ] Mobile-first pipeline board — 11-column job pipeline as a glove-friendly column-picker view inside Leads (Kanban PRD's own mobile section) — synthesis
- [ ] Swipe-review completion — up = correct gesture, 5-star confidence rating, trust-weighting field on correction profile (weighting itself is post-raise) — synthesis
- [ ] Report integrity — SHA-256 hash embedded in PDF + verification endpoint (Supabase edge function) — synthesis
- [ ] Speed instrumentation — scan-to-signed-PDF time, claim-acceptance-without-reinspection, analysis P50/P95 vs ≤60s/≤180s targets — synthesis
- [ ] Photo-library import wired into the inspection flow (pickers already installed) — synthesis
- [ ] Damage color coding decided once in `theme/tokens.ts` (recommend severity-based, not peril-based) — synthesis Contradiction 17

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
- [ ] **Web is now a FIRST-CLASS target** (owner directive 2026-08-16, reverses #38's preview-only ruling): host the static export (roofwise.app), browser pass on the web build (maps with `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY`, responsive shell ≥1100px, camera/sensor tools show their friendly web notices), and referrer-restrict the web Maps key — #50
- [ ] EAS build config covers all three targets: iOS + Android store builds, `expo export --platform web` for the web app — #50

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
- [ ] AR/LiDAR capture, 3D/GLB export, custom model + Sunday cloud retraining, desk-adjuster portal, Guidewire/Duck Creek/Xactimate, carrier API, data licensing, white-label, DJI drone ingestion, calendar sync/SMS/gamification, pricing tiers/freemium — synthesis 2026-08-16 · v2/post-raise per Drift #10, the 12-month custom-model milestone, and Phase 2/3 GTM (docs/PRODUCT_SYNTHESIS.md §5.13). Do not quietly resurrect.
- [ ] Time-travel storm slider (3–4 yr map history browsing) — Dashboard Spec via synthesis · needs the storm-history API depth first
- [ ] Circle-to-focus secondary Gemini pass ("2D virtual chalk") — Camera prompt via synthesis

## Done (most recent first)

- [x] Rewrite `decisionEngine.ts` + `haagThresholds.ts` against `docs/HAAG_DECISION_ENGINE.md` — corrected thresholds (3-tab >5, architectural >8, wood/metal/tile/flat rules), §3 repairability gates override counts, §4 tree in exact order, RC stored once — closed by #50
- [x] Claim Viability engine (HIGH/MEDIUM/LOW) — `lib/services/claimViability.ts`; `damageScore()`/`claimWorthiness()` kept as deprecated wrappers — closed by #50
- [x] Pre-climb Safety engine — `lib/services/safetyEngine.ts` (SAFE/USE_CAUTION/UNSAFE, conservative on missing inputs) — closed by #50
- [x] Long Report (8-section) `lib/services/longReport.ts` + Insurance report variant in `haagPdf.ts` (test-square table, brittleness narrative, rule citations, carrier-norm context) — closed by #50
- [x] Insurance Claim mode — toggle, 7-value Cause-of-Loss, collateral checklist, brittleness photo protocol, policy RCV/ACV + deductible + home value + prior claims, code-compliance notes — closed by #50
- [x] Detection hardening — `shingleScaleEstimate` persisted per photo, anti-fabrication `no_roof_detected` flag + toast, ridge-cap guard, `needsExpertReview()` <80% auto-queue into Train — closed by #50
- [x] Storm validation — ≥0.25" hail floor (exported constant), 4-year lookback distinct from 2-year corroboration, `tripleCheckDateOfLoss()` discrepancy verdict wired into engine + report — closed by #50
- [x] Restore desktop/responsive layout — `theme/useResponsive.ts`, `components/shell/{Sidebar,TopBar}.tsx`, responsive `(tabs)/_layout` (≥1100px sidebar, phones byte-identical) — closed by #50
- [x] Real web map — `Map.web.tsx` upgraded from placeholder to Google Maps JS (same export surface; friendly placeholder kept when key absent); web export green incl. Supabase Node-prerender fix — closed by #50

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
