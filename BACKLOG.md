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

- [ ] **Rewrite `decisionEngine.ts` + `haagThresholds.ts` against `docs/HAAG_DECISION_ENGINE.md`** — current code has 3-tab at 8 hits (should be >5) and architectural at 10 (should be >8), is missing the wood/metal/tile/flat material rules, and has none of the repairability gates (discontinued material, brittleness FAIL/BORDERLINE, 2+ layers) that override hit counts entirely. Highest-value correctness fix in the repo — 2026-08-03
- [ ] **Add Claim Viability engine** (HIGH/MEDIUM/LOW) — the claimability protocol, sourced from the Drive decision-engine doc. Replaces the invented `damageScore()` weights, which cite a spec section that never contained them. Inputs: ±72h date-of-loss match, RCV vs ACV, deductible % of home value, prior claims in 3 years, carrier denial behavior, two-year corroboration limit — 2026-08-03
- [ ] **Add pre-climb Safety engine** (SAFE / USE_CAUTION / UNSAFE from forecast: wind, gusts, precip, temp, lightning) — gates the Quick Inspection entry point — 2026-08-03
- [ ] **Long Report (8-section) + Insurance report variant (6-section)** — the Long Report doc's `{{inspection_json}}` contract (report layer never recalculates RC or contradicts stored booleans) plus the Professional Report doc's insurance structure: test-square table (Slope | Count | Size), brittleness narrative, per-finding HAAG rule citations — synthesis 2026-08-16
- [ ] **Insurance Claim mode (sections VI–IX)** — Insurance-vs-General toggle, 7-value Cause-of-Loss enum, required per-observation `causation` field, collateral evidence checklist capture (gutters/HVAC/screens/vents, each photographed), brittleness field protocol with mandatory photos, inspector credentials + code-compliance notes — synthesis 2026-08-16
- [ ] **Detection hardening in the Gemini prompt** — `shingleScaleEstimate` calibration logging, anti-fabrication guard (no roof in frame → no findings), ridge-cap false-positive instruction, <80% confidence auto-queue wired into Train — synthesis 2026-08-16
- [ ] **Storm validation to the public spec** — ≥0.25" hail floor in `stormMatch.ts`, 3–4-year address lookback, per-job storm view, Triple-Check discrepancy flag (AI hail + no storm on date → review) — synthesis 2026-08-16
- [ ] **19-area slope/subject tagging + Single-Shingle vs 10x10-Square capture modes** with separately aggregated counts; label burned into photo — synthesis 2026-08-16
- [ ] **Restore the desktop/responsive layout.** The scaffold had `theme/useResponsive.ts` plus `Sidebar` + `TopBar` for ≥1100px and bottom tabs under 768px. All three are gone from the current tree; the app is mobile-only — surfaced by the owner's uploaded scaffold-era CLAUDE.md, 2026-08-03
- [ ] **Device pass on a real iPhone** — verify (a) rectangle overlays + withheld-detections toast against a live analysis [#39], and (b) the new 2560px analyze profile is actually selected (not the SAFE fallback), with no OOM on a long capture session [#41] · built and typechecked, but not yet seen with live Gemini output

## Soon (from the 2026-08-16 Drive synthesis — after Now clears)

- [ ] Damage Score reconciliation — Kanban PRD defines 1–100 INVERTED (1–30 red/severe, 61–100 green/repair); reconcile `DamageScoreBar` semantics explicitly, don't silently flip — synthesis
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
- [ ] AR/LiDAR capture, 3D/GLB export, custom model + Sunday cloud retraining, desk-adjuster portal, Guidewire/Duck Creek/Xactimate, carrier API, data licensing, white-label, DJI drone ingestion, calendar sync/SMS/gamification, pricing tiers/freemium — synthesis 2026-08-16 · v2/post-raise per Drift #10, the 12-month custom-model milestone, and Phase 2/3 GTM (docs/PRODUCT_SYNTHESIS.md §5.13). Do not quietly resurrect.
- [ ] Time-travel storm slider (3–4 yr map history browsing) — Dashboard Spec via synthesis · needs the storm-history API depth first
- [ ] Circle-to-focus secondary Gemini pass ("2D virtual chalk") — Camera prompt via synthesis

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
