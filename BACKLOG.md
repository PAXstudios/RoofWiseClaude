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

- [ ] **Implement `docs/DAMAGE_SCORE.md`** — `lib/services/damageScore.ts` (pure, band from the §4 recommendation + 5 rule-cited severity components + confidence), rewire `DamageScoreBar` so the number NEVER renders without its band label, retire the invented `damageScore()`/`claimWorthiness()`, remove the deprecated 0–100 hero from `app/analyze.tsx`. Worked-example tests incl. the 62-hit case — #65
- [ ] **Claim packet still shows "No Functional Damage" on a damaged roof** — the repro in #65 returns FULL/PARTIAL_REPLACEMENT, so that headline comes from a path other than `roofwise_recommendation`; find and fix the label source in the claim-packet screen — #65
- [ ] De-dupe repeated "Shingle Type · None" rows in the claim packet's Documented Findings; validate/clamp the implausible 58° pitch (pitch-gauge never persists — audit P0 #1) — #65

- [ ] **⚡ STANDING TRIGGER — the moment the owner has an Apple Developer account, do ALL of this without being asked** (owner directive 2026-09-01: "Don't forget to do this automatically when I add the apple developer account"). Owner provides: Apple Team ID + an App Store Connect API key (Issuer ID, Key ID, .p8 — role App Manager) either uploaded on expo.dev → roofwise → Credentials, or handed over. Then, in order: (1) `eas credentials` / build profile `production` in `eas.json` (present) with `credentialsSource: remote`; (2) enable the native-only capabilities that Expo Go could not run — **background location for door-knocking trip tracking** (`expo-location` background + `expo-task-manager`, `UIBackgroundModes: ["location"]`, `isIosBackgroundLocationEnabled` in the plugin, the "tracking pauses when you switch apps" copy removed), Google Maps on iOS (`PROVIDER_GOOGLE`, key already in `ios.config`), geofenced mileage auto-tracking, Apple Sign In (Supabase Apple provider), remote push on the real bundle; (3) `eas build --platform ios --profile production --non-interactive --auto-submit` → TestFlight; (4) invite the owner as an internal tester; (5) then start the AR/LiDAR native module work (custom Expo Module wrapping ARKit world tracking + scene depth) behind the existing capture-settings buttons. Every step is in docs/SETUP_ACCOUNTS.md; the bundle id is `com.roofwise.app`. — #57
- [ ] **Map tab crash — trigger still unpinned.** The owner's log proves a JS exception inside a Reanimated worklet on the UI thread (SIGABRT via `worklets::UIScheduler::triggerUI`), not MapView. Wave 7c installs a UI-runtime error trap (records the JS message to Diagnostics instead of aborting) and clusters the ~900 storm overlays; the next device crash log or Diagnostics entry names the worklet — #60
- [ ] Weather page "storms near here" deep-links `/(tabs)/map?focus=point&lat&lng` but the map only handles `focus=storm-leads`; wire the point branch (centre + fetch + clear param) so the tap-through lands on that address — #63
- [ ] **Roof measurement wave (7f)** — satellite overhead + colored roof overlay (Google Solar buildingInsights: real per-segment area/pitch/azimuth/boundingBox + sloped squares, verified live) + a Supabase Edge Function `roof-outline` tracing the Solar mask GeoTIFF for the precise outline; de-brand solar→roof measurement. Spec: scratchpad/spec-roof-measure.md. After 7e — owner 2026-09-02
- [ ] Report footer: print `modelUsed` per analysis (persisted on `slope.photoAnalysis[uri].modelUsed`; spec §1 of the photo wave asked for it) — #60
- [ ] `AnalysisJob.lastError` on the queue store so the queue chip can show why a job failed (per-photo state and notifications already carry it) — #60
- [ ] Learning Loop v2 + dataset pipeline — `docs/LEARNING_LOOP.md`; Supabase project + schema are LIVE (#61); runs right after Wave 7c — #61
- [ ] **Rotate/revoke Supabase secrets pasted in chat:** the service-role key now (unused); the personal access token after the Learning Loop migrations land — #61
- [ ] Device re-test after the #60 build: photo → analysis returns findings on a real roof JPEG; Live overlay boxes land on the right spot; tab bar bottom inset on iPhone; Google imagery on the Map tab now that Map Tiles is enabled; voice-note transcription on the new transport — #60
- [ ] **⚡ STANDING TRIGGER — PRE-LAUNCH, the moment the owner says the app is about to launch, do ALL of this without being asked** (owner directive 2026-09-02: "dont forget this when i tell you the app is about to launched: before public launch I'd switch email confirmation back on"). (1) Supabase Auth: turn email confirmation back ON — `PATCH https://api.supabase.com/v1/projects/epghfumtuxrhonbpnbmr/config/auth {"mailer_autoconfirm": false}` (it was set to true for the test phase in #61) and set `site_url`/redirects to the production domain; (2) rotate every secret ever pasted in chat (Google keys, Gemini key, Expo token, Supabase service-role key + access token); (3) restrict the Google keys (bundle id / package + SHA-1, API list) per docs/SETUP_ACCOUNTS.md; (4) `EXPO_PUBLIC_REQUIRE_AUTH=true` end-to-end re-test; (5) move the app off the Live-overlay/AI defaults that are costly per photo if the owner wants; (6) re-run the full device pass. Record the launch-day state in PROMPT_LOG. — #62
- [ ] **OWNER DECISION — the HIGH claim-viability band is unreachable in the field.** `assessClaimViability` requires `is_discontinued === true` as one of six HIGH criteria and nothing populates it, so every claim lands MEDIUM or LOW. The code is faithful: `docs/HAAG_DECISION_ENGINE.md` §6 reads "**HIGH** — all of: … Material is discontinued". Deliberately NOT patched (Drive docs win on logic — CLAUDE.md). Three options: (a) spec is right and HIGH is genuinely rare — capture `is_discontinued` in claim mode so it can be met; (b) discontinued belongs in MEDIUM's supporting factors, not HIGH's gate — amend §6 and the code together; (c) HIGH requires 5-of-6. **Do not resolve this by quietly loosening the criterion.** — #51
- [ ] **Device pass on a real iPhone** — now covering (a) rectangle overlays + withheld-detections toast against a live analysis [#39], (b) the 2560px analyze profile with no OOM [#41], (c) claim-evidence photo attach + responsive shell on tablet [#50], and NEW from #51: (d) capture dock height on an SE-class screen (three 56pt rows ≈310–330pt leaves ~270pt of viewfinder — functional but cramped), (e) up-swipe → edit → save → star round trip (`useFocusEffect` behavior was reasoned from types, not exercised), (f) pure-JS SHA-256 wall time on a photo-heavy multi-MB report on Hermes (est. 0.1–1s synchronous on the JS thread), (g) star-row width on a 320pt device (lands at exactly 56pt) — #51
- [ ] **Long Report CTA has no finalize gate** — the brittleness-evidence gate is wired to the HAAG packet CTA only (`haagPdf.ts:674` insurance supplement); the Long Report can still be generated without it — #51
- [ ] **Mode-bucket counts go stale on manual marker edits** — `squareHitCount`/`singleShingleHitCount` are written only by `analyzeSlope`; edit-detection / swipe-review / DamageMarkerLayer recount `hailCount` through the store's `withRecount` but leave the buckets untouched, so hand-edited slopes feed the engine a stale per-square denominator — #51

## Soon (from the 2026-08-16 Drive synthesis — after Now clears)

- [ ] **Re-test the #58 fixes on the iPhone** (publish a new EAS Update first): Map tab shows storm pins within seconds and the stat line reads a real count (not "unavailable"); Hail Tracer opens with hail circles on Apple Maps and no ErrorBoundary card; Home tab tap is a single transition with no blank screen; a second tap on the active tab does nothing; New Lead "save" / New Job "Done" / job delete return to the existing shell (swipe-back reveals nothing underneath); voice note plays through the speaker; Job Detail no longer prompts for the mic on open. If Expo Go still exits on "Map", pull the iOS crash log (Settings → Privacy & Security → Analytics Data → "Expo Go-…") — the faulting frame decides between AIRMapManager (nil `onMapReady`) and AIRMap `insertReactSubview` (dynamic marker add/remove) — #58
- [ ] Surface `D` / `O` (TSTM/NON-TSTM WND DMG) reports: IEM sends them with no gust magnitude, so they never pass `qualifiesForValidation` and "wind damage reported here" is invisible on every map. Product call on showing them as unvalidated context (Drift #5-safe: labelled, never counted as validated) — #58
- [ ] Owner call: do `N` (NON-TSTM WND GST) and `A` (HIGH SUST WINDS) count as roofing wind events? `lib/noaa.ts` includes them (parity with the old substring match); excluding them is a one-line `WIND_CODES` change — #58
- [ ] `lib/noaa.ts` severityColor also still uses inline hex for wind bands (now 86/69/58 mph) — fold into the existing Drift #11 item below — #58
- [ ] `MapHeatmap` gate is inert on Android and Google-provider dev builds; the MapCircle fallback has only been reasoned about, not seen — check the swath density/alpha on a device and tune `HAIL_CIRCLE_*` in `app/hail-tracer.tsx` — #58
- [ ] **Rotate after the first device run:** the Expo access token (Admin), the phone Google key, the Gemini key, and the claude.ai-restricted web key — all pasted in chat 2026-09-01 — #56
- [ ] TestFlight via EAS Build — the "real icon + Google Maps on iOS" path; needs the Apple Developer Program ($99) and App Store Connect credentials configured on expo.dev; works from this container once those exist — #56
- [ ] **Device test on SDK 54 / New Architecture** — only the web export was booted. First Expo Go run must exercise: react-native-maps 1.20 (Apple Maps in Go), expo-camera 17 capture + analyze, expo-sensors 15 pitch gauge, **expo-audio voice notes (record + play — a full API rewrite)**, Reanimated 4 animations (hero, aurora, radar, swipe cards, toasts), the `Map.tsx` focus seed on the iOS Simulator SIGSEGV path — #55
- [ ] zustand 4.5 → 5 — would remove the zustand-only package-exports override in `metro.config.js`; behavior-bearing (persist/selector changes), deliberately excluded from the migration — #55
- [ ] expo-file-system: real migration off `/legacy` (deprecated) to the File/Directory API in the 4 call sites — #55
- [ ] `react/no-unescaped-entities` is turned off in `eslint.config.js` (eslint-config-expo 10 newly enforces it on 26 pre-existing JSX copy strings); decide whether to escape the strings instead — #55
- [ ] `components/map/StormHistoryMap{,.native}.tsx` have no importers (dead since the `fetchAddressStormHistory` migration); delete — #55
- [ ] Plan the 54 → 57 hop (pre-cleared: new-arch on, expo-av gone, react-navigation import gone): `expo install --fix` + the expo-router 56 codemod (router drops react-navigation) — do it when Expo Go on the store moves past 54 — #55
- [ ] **Rotate the preview Google key before any real ship** — pasted in chat 2026-09-01; it is website-restricted to `https://claude.ai/*` and API-restricted (Maps JS, Weather, Geocoding), so exposure is bounded, but it is embedded in the published artifact page — #54
- [ ] Verify the artifact frame's origin satisfies the key's `claude.ai/*` website restriction — unknown from the container; if tiles fail with RefererNotAllowed the owner adds the frame origin to the restriction — #54
- [ ] Weather hero: the permission / no-fix / unreachable branches of state C could not be exercised in the keyless container (always `no-key`); verify on a device — #54
- [ ] AreaActivityCard on low-end Android: first paint now stacks aurora + radar + sweep + pulse SVGs (+ up to 15 precipitation streaks); if it stutters, `AuroraWash animate={false}` and fewer `WASH_ORBS` are the designed escape hatches — #54
- [ ] Add `components/ui/index.ts` barrel — the six primitives must currently be imported by exact path — #53
- [ ] react-native-web logs a one-time `"shadow*" style props are deprecated, use "boxShadow"` warning now that shadows carry a `web:` branch; harmless, but worth migrating — #53
- [ ] Hoist the duplicated UI primitives from #52 into shared components — SegmentedControl, Rise (entrance), MiniSwitch are file-local copies in leads/plan/hail-tracer/welcome/settings/inspector-profile because parallel builders couldn't create shared files; converge on `components/` versions — #52
- [ ] Owner review of #52's deliberate design divergences: leads rows dropped the per-row Convert-to-inspection button (now only in lead detail) and the Source meta line; settings icons went textMuted; VerdictPill "Full replace" softened to accentSoft — confirm or restore — #52
- [ ] Add a `lineHeight` scale to `theme/tokens.ts` — numeric literals (18/22) are current repo practice and predate #52 — #52
- [ ] Device motion pass — springs, segmented thumb slide, swipe card stack, tab icon pop are unverifiable on web; judge "does it feel iOS" on hardware; also verify fontVariant tabular-nums and Android elevation clipping in horizontal ScrollViews — #52 integrator risks

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

- [x] UI-runtime crash trap mounted at boot — a worklet throw on the UI thread now records to Diagnostics instead of aborting (was written but never installed) — closed by #63
- [x] Estimator/New Job/New Lead "page regenerates while typing an address" — inline `<Stack.Screen options>` re-presented the modal every keystroke; hoisted to stable constants — closed by #63
- [x] Weather page (`/weather`) the hero opens in every state; honest Google-API-denied surfacing; map StormOverlay with clustering + coordinate guards — closed by #63
- [x] `(tabs)/_layout.tsx` Slot-as-stack → real `<Tabs>` navigator — closed by #60 (was a Soon item from #58)
- [x] `eas.json` with preview/production profiles — closed by #57
- [x] Supabase connected to the owner's own project `epghfumtuxrhonbpnbmr` on web + phone; full schema (sync tables, photo buckets, learning-loop dataset tables, RLS) applied via the Management API and verified — closed by #61
- [x] Photo analysis restored — `gemini-2.5-pro` is retired for new keys (404); newest Flash + fallback chain, typed errors, per-photo failed/retry state, `modelUsed` recorded — closed by #60
- [x] Capture UI rebuilt with Live overlay, honest AR / LiDAR / Guides buttons (Drift #10 rewritten by owner directive) — closed by #60
- [x] Google road/satellite imagery inside Expo Go on iOS via the Map Tiles API (owner enabled Places, Solar, Map Tiles on the key; all verified live) — closed by #60
- [x] `(tabs)/_layout.tsx` is a real `<Tabs>` navigator (JUMP_TO, preserved state) — closed by #60
- [x] `ProgressBar` worklet abort (plain helper called on the UI thread) — closed by #60
- [x] First device run in Expo Go — happened 2026-09-02; owner reported crashes, dead buttons, "map crashes", NOAA unavailable. Root causes traced and fixed (IEM 422 → new services + code-based classification + MPH units; Google-only heatmap gated; tab-shell stacking; expo-audio session) — closed by #58 (device re-test still open above)
- [x] NOAA storm history unavailable on every surface — `lsr.py?fmt=geojson` is rejected with HTTP 422 by IEM; moved to `lsrs_by_point.geojson` (per-point) + `lsr.geojson` (statewide, 24 h only, 10k-cap guard), tz-aware timestamps, User-Agent actually sent, 20 s abort — closed by #58
- [x] App in the owner's hand with zero installs — EAS project `roofwise/roofwise`, `expo-updates` + `sdkVersion` runtime policy, phone keys as sensitive EAS env vars, update published to branch `preview` (runtime `exposdk:54.0.0`, iOS + Android); first keyless publish caught and republished with keys — closed by #56
- [x] Expo SDK 51 → 54 platform migration — RN 0.81.5, React 19.1, New Architecture on, Reanimated 4 + worklets, expo-router 6, expo-av → expo-audio, file-system `/legacy`, splash plugin, flat ESLint; zustand `import.meta` web crash fixed with a scoped Metro override; StrictMode re-run bugs in WeatherHero/AreaActivityCard fixed; all gates green — closed by #55
- [x] Home front page shows a map AND the weather — `WeatherHero` renders its full animated cinematic frame in every state (missing data changes the text, never the design); `AreaActivityCard` is an always-present Google storm map with Leads|Storms layers, keyless NOAA hail/wind pins, and the real storm-lead insight; both above the fold on a 390×844 phone — closed by #54
- [x] Web preview keyed — owner's claude.ai-restricted Google key in the container's gitignored `.env.local`; live weather + basemap in the artifact — closed by #54 (referrer check pending)
- [x] Cinematic redesign — the onboarding's own visual language (Aurora, GlassCard, radar motif) promoted into the app; gradient/depth tokens + six shared primitives; the big weather hero with SVG radar in three honest states; crafted content across Home/Leads/Job/Map/Plan/Train/Settings; royal=interactive, burnt=urgency — closed by #53
- [x] App/onboarding congruence — the app and its onboarding now read as the same product — closed by #53 (owner's explicit complaint)
- [x] iOS × Instagram UI redesign — grouped ground, one-orange-moment discipline, edge-to-edge tab bar, iOS-17 segmented controls, spring motion layer, density pass (Get-set-up checklist, no zero-state voids), greeting bug dead; screenshot-verified by a visual auditor — closed by #52
- [x] Settings "backend: not configured / connected" indicator — Cloud sync row now reads `isSupabaseConfigured` honestly (was hardcoded "Connected") — closed by #52 (was #35)
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
