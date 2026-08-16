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

- [ ] **OWNER DECISION — the HIGH claim-viability band is unreachable in the field.** `assessClaimViability` requires `is_discontinued === true` as one of six HIGH criteria and nothing populates it, so every claim lands MEDIUM or LOW. The code is faithful: `docs/HAAG_DECISION_ENGINE.md` §6 reads "**HIGH** — all of: … Material is discontinued". Deliberately NOT patched (Drive docs win on logic — CLAUDE.md). Three options: (a) spec is right and HIGH is genuinely rare — capture `is_discontinued` in claim mode so it can be met; (b) discontinued belongs in MEDIUM's supporting factors, not HIGH's gate — amend §6 and the code together; (c) HIGH requires 5-of-6. **Do not resolve this by quietly loosening the criterion.** — #51
- [ ] **Device pass on a real iPhone** — now covering (a) rectangle overlays + withheld-detections toast against a live analysis [#39], (b) the 2560px analyze profile with no OOM [#41], (c) claim-evidence photo attach + responsive shell on tablet [#50], and NEW from #51: (d) capture dock height on an SE-class screen (three 56pt rows ≈310–330pt leaves ~270pt of viewfinder — functional but cramped), (e) up-swipe → edit → save → star round trip (`useFocusEffect` behavior was reasoned from types, not exercised), (f) pure-JS SHA-256 wall time on a photo-heavy multi-MB report on Hermes (est. 0.1–1s synchronous on the JS thread), (g) star-row width on a 320pt device (lands at exactly 56pt) — #51
- [ ] **Long Report CTA has no finalize gate** — the brittleness-evidence gate is wired to the HAAG packet CTA only (`haagPdf.ts:674` insurance supplement); the Long Report can still be generated without it — #51
- [ ] **Mode-bucket counts go stale on manual marker edits** — `squareHitCount`/`singleShingleHitCount` are written only by `analyzeSlope`; edit-detection / swipe-review / DamageMarkerLayer recount `hailCount` through the store's `withRecount` but leave the buckets untouched, so hand-edited slopes feed the engine a stale per-square denominator — #51

## Soon (from the 2026-08-16 Drive synthesis — after Now clears)

- [ ] **Homeowner-summary copy rewrite needs owner sign-off** — a straight band re-key would have printed "the damage on your roof is below the threshold a carrier uses" (LOW) on reports whose Sections 02/05 say the opposite, so the reports-core builder rewrote the opening clauses in `longReport.ts` to resolve the contradiction. That is approved-copy drift made for a good reason; read it and confirm — #51
- [ ] Watch Train-tab queue volume — the new <80% expert-review gate queues far more photos than the old avg<60 rule (store caps at 500); consider queueing only the sub-80 subset per photo — #50
- [ ] `lib/noaa.ts` `severityColor` still keys hail colors at 0.75" with inline hex (pre-existing Drift #11 debt) — #50
- [ ] Damage color coding decided once in `theme/tokens.ts` (recommend severity-based, not peril-based) — synthesis Contradiction 17
- [ ] Speed-stats UI surface — `telemetry.ts` records analysis/report P50/P95 but `getSpeedStats()` has no screen; decide where it shows (Settings → About? Train tab?) — #51
- [ ] Area label as a rendered overlay chip only — pixel burn-in via expo-image-manipulator is deferred; `docs/PRODUCT_SYNTHESIS.md` §1 quotes the Camera prompt wanting the label burned into the photo so it survives export to a carrier — #51
- [ ] Area-tag overlay chips not yet shown on photo thumbnails in job / analyze / swipe-review / edit-detection (stored, just not surfaced there) — #51
- [ ] Pipeline board pager on web — `pagingEnabled` + `onMomentumScrollEnd` are unreliable on react-native-web, so the chip strip can desync from the visible column after a swipe (tapping a chip still works) — #51
- [ ] `areaTag` is typed `string`, not the `AreaTag` union — no compile-time guarantee a stored value is one of the 19 — #51
- [ ] Confirm the storm-alert radius change — alerts are now scoped to 25 mi around the service-area centroid instead of state-wide. Fixes "Plano, TX alerted by Amarillo hail" but a contractor who relied on state-wide coverage will see fewer alerts — #51
- [ ] Confirm Map/Hail-Tracer now hide hail reports with no recorded size (they apply the published ≥0.25" validation floor via `fetchAddressStormHistory`) and crop to 50 mi around the resolved service center — #51
- [ ] Google Weather `currentConditions:lookup` field names for `wind.gust`, `precipitation.probability.percent`, `thunderstormProbability` are parsed defensively but were never verified against a live response (no API key in the build container) — #51
- [ ] `thunderstorm_watch` is derived from a ≥50% probability, not a real NWS watch product (the API exposes no watch feed) — documented as `THUNDERSTORM_PROBABILITY_PERCENT` in `weather.ts` — #51
- [ ] Map draws at most 300 storm pins — the 300 most **recent**, not the 300 most **severe**; the count line always reports the true total. Product call worth confirming — #51
- [ ] Down-swipe is now skip where it used to be up — muscle-memory hazard for anyone on the old build (same destructiveness as before: queue item marked `discarded`) — #51
- [ ] Report-verification endpoint (online hash check) — the local SHA-256 stamp ships now; a hosted verifier needs the Supabase project, which is administered from a different workspace — #51

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

- [x] 19-area slope/subject tagging + Single-Shingle vs 10×10-Square capture modes with separately aggregated counts (`AREA_TAGS`, `captureSession.ts`, `Slope.squareHitCount`/`singleShingleHitCount`) — closed by #51
- [x] Photo-library import wired into the inspection flow, through the same `prepareCapturedPhoto` pipeline and analysis queue as camera captures — closed by #51
- [x] Persist the engine result on the inspection — `storedEngine.ts`; reports restate a stored `HaagEngineResult`, freshness by SHA-256 input fingerprint (stronger than a timestamp), with a write-side freeze so a finalized report can't be silently re-snapshotted — closed by #51
- [x] Wire a real forecast into `HaagEngineInput.forecast` — `getSafetyForecast()` in `weather.ts` → `evaluateSafety()`; `roofer_safety_rating` no longer defaults to "Use caution" — closed by #51
- [x] Real date-of-loss capture in claim mode — replaced a free-text field (which accepted "around mid-May" and silently disabled every downstream date check) with a structured preset + MM/DD/YYYY control that rejects impossible dates and shows the matched storm date beside it — closed by #51
- [x] Claim-evidence photo attach routed through `prepareCapturedPhoto` — closed by #51
- [x] Brittleness-evidence finalize gate on the HAAG packet CTA (informative friction, not a hard block) — closed by #51 · Long Report CTA still ungated, see Now
- [x] Damage Score reconciliation — `DamageScoreBar` renders the HIGH/MEDIUM/LOW band; the deprecated 0–100 score removed from the carrier-facing report narrative, homeowner summary, `urgent` branch, and Section 02 stat tile — closed by #51
- [x] Mobile-first pipeline board — 12-column glove-first column-picker in Leads (11 live stages + terminal `lost`), one-tap Move sheet, no drag-and-drop; List view byte-identical — closed by #51
- [x] Swipe-review completion — up = correct, dominant-axis gesture resolution, 5-star confidence prompt on corrections, `inspectorTrustWeight` stamped neutral — closed by #51
- [x] Report integrity — pure-JS SHA-256 (no new dependency) stamped in both report variants; verified by hand against Node `crypto` across padding boundaries, multibyte UTF-8, emoji, and 500KB bodies; strip/verify round-trips and tamper detection both confirmed — closed by #51 · online verifier still deferred
- [x] Speed instrumentation — local-only `telemetry.ts` recording analysis/report P50/P95 against the ≤60s/≤180s targets, no network (Drift #5) — closed by #51 · no UI surface yet
- [x] Storm-matched lead clustering — `matchLeadsToStorm()` haversine over already-fetched data; "N leads within X mi of the hail core" on the storm hero with tap-through to Map — closed by #51
- [x] Migrate `map.tsx`/`hail-tracer.tsx` to `fetchAddressStormHistory` (4-year clamp) — closed by #51
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
