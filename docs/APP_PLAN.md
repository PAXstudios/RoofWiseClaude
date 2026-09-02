# THE PLAN — RoofWise: Make It Fully Functional & Fully Loaded

Owner directive: "Make sure everything is fully functional. Add additional features where you see fit... Really think as an app builder." This plan turns the four audits into a worklist, a navigation redesign, a ranked feature roadmap, and a 6-wave build sequence that dodges the in-flight capture (`quick-inspection.tsx`), map (`map.tsx` crash + `7f` roof-measure), and `analysisQueue.ts` work.

**Non-negotiable framing:** every fix respects the 3 Rules (PROMPT_LOG + BACKLOG discipline), Drift #5 (no mocks / boots empty), Drift #7 (HAAG thresholds from `docs/HAAG_DECISION_ENGINE.md`), and the branch policy (`claude/wonderful-franklin-HuSTl` only). The `Job` model already carries `inspectionId`/`proposalId`/`status` and there is a `proposalLinkStore` + `wizardPrefillStore` — several "chain" fixes are wiring, not new schema.

---

## 1. Broken / stub inventory — the "make everything functional" worklist

Grouped by severity. Each line: **file:line — defect → one-line fix.**

### P0 — Broken behavior / data loss (fix first)
1. **Pitch Gauge discards its own measurement.** `app/pitch-gauge.tsx:151` — the sticky "Save pitch (X°)" CTA only calls `router.back()`; the value is thrown away. → Persist to the target slope (`inspectionStore.setSlopePitch`) or write to `wizardPrefillStore` when launched from a wizard; when launched standalone, offer "attach to job."
2. **Cloud LWW conflict resolution is unreliable.** `supabase/schema.sql:212-221` `touch_updated_at` BEFORE-UPDATE triggers on `inspections`/`leads` overwrite `updated_at=now()`, but `leadSync.ts:73-80` resolves conflicts on the *client's* `updatedAt`. Upsert stamps sync-arrival time → last-**syncer**-wins, not last-**editor**-wins. → Drop the two triggers (let client `updated_at` persist) via a new migration; keep `inspectionSync` doing the same. Do NOT decide conflicts on a column the server rewrites.
3. **Corrections never reach Supabase.** `correctionsSync.ts:33` POSTs to `EXPO_PUBLIC_CORRECTIONS_ENDPOINT` (a Vercel URL) while `schema.sql:53` provisions `public.corrections` that nothing writes; a device wipe loses the entire training signal, and it re-POSTs every 5 min forever if the backend is down. → Point `correctionsSync` at `supabase.from('corrections').upsert(...)`; delete the unused endpoint path (or the table) so wiring and schema agree.
4. **Photo sync starves cross-device.** `photoSync.ts:17,69` — `MAX_UPLOADS_PER_RUN=8`, foreground-only, runs only after an inspection sync; a 40-photo job drains 8 per app-open, second device shows broken `file://` URIs, and a genuinely-missing original loops silent forever. → Loop-until-drained under a time budget, mark truly-missing originals `failed` (surface it), trigger photo sync independently of inspection-sync.

### P1 — Store/persistence hazards
5. **No persist versioning on 21 stores.** `inspectionStore.ts:679` (and all `*.v1` stores) declare no `version`/`migrate`; a shape change rehydrates stale blobs with `undefined` fields → silent corruption or render crash. → Add `version` + `migrate` to at minimum `inspection`, `lead`, `corrections`, `captureSettings` stores; bump on the shape changes this plan introduces.

### P1 — Half-closed learning loop
6. **`effectiveThreshold()` computed but never called.** `learning/localLearningEngine.ts:16` — exported, consumed nowhere; a user who keeps rejecting a category never gets it filtered. → Apply it as a per-category confidence gate in `analyzeSlope.ts` when mapping Gemini findings to markers (or delete it if prompt-prefix is the sole intended mechanism — pick one, document in PROMPT_LOG).
7. **Learning Loop v2 is schema-only.** `schema.sql:104-177` defines `photos/detections/labels/prompt_releases` + dataset bucket; no client writes them and `gemini.ts` uses a hardcoded local prompt. → Already a BACKLOG "Now" item (#61). Either wire the dataset writers + `prompt_releases.active` fetch in `gemini.ts`, or move the tables to a clearly-labeled future migration so schema stops implying live wiring.
8. **Mode-bucket counts go stale on manual edits.** (BACKLOG #51) `squareHitCount`/`singleShingleHitCount` written only by `analyzeSlope`; `edit-detection`/`swipe-review`/`DamageMarkerLayer` recount `hailCount` but not the buckets → engine gets a stale per-square denominator. → Recount buckets inside the store's `withRecount`.

### P2 — Dead ends / stubs (visible "coming soon")
9. **Activity rows are dead ends.** `activity.tsx:106-117` and Home's Recent Activity `index.tsx:709-721` are non-pressable `<View>`s though events carry `inspectionId`/`proposalId`. → Wrap in `PressableScale` → `router.push('/job/[inspectionId]')` or `/proposal/[jobId]`.
10. **Train "Lessons" stub.** `train.tsx:381` static "Coming soon." → Replaced by the AI Coach + lesson cards (roadmap item, Wave 5).
11. **Settings "Coming soon" group inert.** `settings.tsx:362` — AI thresholds, Team & roles, integrations as dead copy. AI-threshold tuning is a spec feature. → Ship the AI-threshold control (Wave 3, pairs with #6); leave Team/integrations honestly labeled until Wave 6.
12. **Reports has no export.** `reports.tsx:78` — "reports export" promised, none exists. → Add CSV/PDF export (Wave 3) reusing `expo-print`/`expo-sharing`.
13. **Long Report has no finalize gate.** (BACKLOG #51) brittleness-evidence gate wired only to the HAAG CTA (`haagPdf.ts:674`); Long Report generates without it. → Apply the same gate in `longReport.ts`.

### P2 — In-flux coordination (confirm during the owning wave, do not collide)
14. **Quick Inspection may not enqueue AI.** `analyze.tsx:51` is the only `enqueue` call site; `quick-inspection.tsx` (being rewritten) has none. → During the capture wave, wire `enqueue` + `drainAnalysisQueue()` into quick-inspection (mirror `analyze.tsx:307`).
15. **No offline banner / "analysis queued" affordance.** `analysisQueue.ts` is being edited. → Add a global connectivity banner + "N photos waiting for signal" chip fed by `analysisQueueStore` — coordinate with the capture-wave owner.

---

## 2. UX / IA redesign — the navigation the app SHOULD have

The core defect across the audit: **the job/inspection — the roofer's actual work object — has no home, the Lead→Job→Proposal chain is lossy and one-way, and the day's real next actions plus the business dashboard are buried.** Keep the 5 tabs (Drift #2: Home / Leads / Map / Plan / Train) but fix what lives where.

### Tab-by-tab

**HOME** — the cockpit. Keep weather hero + the two hero CTAs (Quick Inspection + New Job, Drift #3) + Storm Alert (hides when none, Drift #4). ADD, in priority order:
- **"Today" module** (new): today's appointments/inspections + follow-ups due + going-cold leads, each row tappable to the job/lead. Reuse `plan.tsx` `followUpsDue`/`scheduleItems` logic (finding: Home has no agenda). This is the single highest-impact IA fix.
- **Make the stat cards live** (`index.tsx:455-477`): Revenue/Leads/Pipeline → tap into `/reports` (finding: stat cards non-interactive, Reports buried).
- **Recent Activity rows pressable** (fix #9).

**LEADS** → becomes **Pipeline (Leads + Jobs unified).** The audit's #1 finding is there is no Jobs home and the pipeline never reflects real job progress. Fix by making jobs first-class pipeline cards:
- Add a **segmented control "Leads | Jobs"** at the top of the Leads tab (or a Jobs filter), giving the job list the persistent home it lacks. The `/inspections` full list stops being gated behind Home's "View all" (finding: `index.tsx:573`).
- **Card quick-actions** on every pipeline card: Call / Text / Directions / Book (finding: board is view+move only) — `tel:` / `sms:` / maps / appointment sheet.
- **Filter chips + sort** (carrier / score / source / follow-up-set) for the 40-lead reality.
- **Unify the state model:** proposal-sent, proposal-signed, and job-complete events auto-advance the *linked lead's* stage (fixes the disjoint-worlds finding `job/[id].tsx:325`, `proposal/[jobId].tsx:264`). A won proposal moves the board with no double-entry.

**MAP** — leave the core alone (crash trap + `7f` roof-measure are in flight). ADD later (Wave 6): storm-opportunity clustering surface entry + territory polygons — coordinate hard with the map wave, do not touch `map.tsx` focus handling now.

**PLAN** — already the real Today/Week agenda. ADD:
- **Real appointments** (not `createdAt`-derived): appointment objects with start times, a booking sheet, surfaced here and on Map (roadmap).
- **A "Reports" entry row** and a **"Jobs" entry row** so both are reachable without going through Settings/Home (findings: Reports buried, Settings unreachable off-Home).
- **"Going cold" surface** driven by `stageChangedAt` (roadmap: stage automation).

**TRAIN** — replace the "Lessons coming soon" stub with the **AI Coach** chat (grounded in `HAAG_DECISION_ENGINE.md` + current inspection) plus real lesson cards. Keep AI-calibration content.

### Settings & detail-screen reachability
- **Settings reachable from every tab root** (finding `settings.tsx:347`): add a shared header affordance (the person-icon) to Leads/Map/Plan/Train roots, not just Home.
- **Reports gets a front door** (findings: buried two levels deep): Home stat-cards link + a Plan row. Keep the Settings→Business path too.

### Fix the Lead → Job → Inspection → Proposal chain (the money path)
This is the connective tissue the audit flagged five separate times. Concrete moves:
- **`lead/[id]` convert** (`lead/[id].tsx:114`): store the lead id on the created inspection **and** the inspection id back on the lead; on save route to `/job/[id]` (or straight into Quick Inspection), not Home (finding `new-job.tsx:533`).
- **"Start inspection now" on the lead** carrying the prefill straight into Quick Inspection (finding `lead/[id].tsx:114`); and let a standalone Quick Inspection optionally attach to / create a lead (finding: unnamed disconnected job).
- **Job detail gets the customer action row** — Call / Text / Email / Directions + follow-up scheduling (finding `job/[id].tsx:112`): the phone/email are already on the inspection, just surface them. Show the linked lead on the job screen.
- **Post-signature actions** on proposal/job (finding `proposal/[jobId].tsx:264`): Schedule Install / Create Invoice / Mark Won→advance pipeline / Set Follow-up. The money chain must not terminate at "signed."

---

## 3. "Fully loaded" feature roadmap — ranked by (roofer value ÷ effort)

All shippable in **Expo Go now** unless marked ⚡**NATIVE** (needs the Apple Developer account — see BACKLOG STANDING TRIGGER #57). Ranked highest ROI first.

| # | Feature | Rationale (one line) | Effort | Dep |
|---|---|---|---|---|
| 1 | **Pricing Settings** (editable per-square material/labor/markup/tax/deposit/accessory catalog) | A proposal built on national numbers is unsellable; `costEstimator.ts:49` is hardcoded — the estimator is a toy without it. | M | new store → `costEstimator`+`proposalGenerator` |
| 2 | **Company branding on PDFs** (logo, company name, license/insurance block, brand color) | Unbranded proposals/reports look amateur and lose adjuster trust; `inspectorProfileStore.ts:5` has no company block. | M | `expo-image-picker` (present), `proposalPdf`/`haagPdf` |
| 3 | **Stage-driven follow-up automation** (auto-set `followUpAt` on stage change; "going cold" surface via `stageChangedAt`) | 40% of storm leads go to the first responder; automatic cadence is the highest-ROI solo-CRM feature. `leadStore.ts:71` is fully manual. | M | `leadStore`, `pushNotifications` (present) |
| 4 | **In-app document delivery** (email/SMS to homeowner + adjuster with templates, log `sentAt`) | "Send the packet" and "text the link" are the two money moments; the raw Share sheet loses the template and the send record. `proposal/[jobId].tsx:118`. | M | ⚙️ `expo-mail-composer`+`expo-sms` (install) |
| 5 | **Contingency agreement / AOB e-sign** (contract variant from same job data) | Storm roofing runs on the contingency signed at the door; a quote is not that document. `proposalGenerator.ts:16`. | M | `proposalPdf` pattern + `SignaturePad` (present) |
| 6 | **Photo annotation "virtual chalk"** (svg freehand/circle/arrow/caption, flattened copy; optional circle-to-focus re-run) | Adjusters trust annotated evidence; CompanyCam's signature feature. `edit-detection.tsx`. | M | `react-native-svg` (present), `gemini.ts` |
| 7 | **In-capture photo delete + reorder** (add `reorderPhoto` to store) | You shoot fast on a hot roof and get duds; report reads photos in array order. Owner explicitly asked. `inspectionStore.ts:181`. | S-M | `gesture-handler` (present) — **coordinate w/ capture wave** |
| 8 | **Storm Opportunities worklist** (cluster matched leads by event, rank by distance/hail/recency, "start route → door-knocking") | The pitch's headline feature is computed (`stormWatch.ts:345`) but only a field on a lead; value is realized as a tappable worklist. | M | `stormWatch`+`knockSession` (present) |
| 9 | **AI Coach** (Gemini chat grounded in HAAG doc + current inspection: "hail or blistering?", adjuster rebuttal drafts, pitch rehearsal) | Genuine differentiator, reuses the model already paid for; fills the empty Train tab. `train.tsx:384`. | M-L | `gemini.ts` (present) |
| 10 | **Real appointments + device calendar sync** (Appointment model, booking sheet, ⚡`expo-calendar` two-way) | "Book Thursday 2pm and remind me" is table-stakes; Plan can only show what already happened. `plan.tsx:188`. | M-L | ⚙️ `expo-calendar` (install), `pushNotifications` |
| 11 | **Notification center + push coverage** (inbox via `activityStore`; push on storm-match / signature / stage-change; per-category prefs) | The storm-matched-leads push is the pitch payoff; roofers need to know the instant a homeowner signs. `pushNotifications.ts:47`. | M | `pushNotifications`+`stormWatch` (present) |
| 12 | **Customer/Contact entity** (timeline, notes, tags, 1-to-many leads/jobs) | Repeat/referral business needs "what did we talk about last time"; today a customer is a single lead row. `types.ts:717`. | M-L | `activityStore` pattern |
| 13 | **Reports v2** (monthly trend charts, lead-source & carrier breakdown, date-range picker, CSV/PDF export) | "Am I trending up" and "which carrier pays" change behavior; flat YTD scalars can't answer. `reports.tsx:98`. | M | `react-native-svg` (present) — use the **dataviz** skill |
| 14 | **Per-finding voice notes** (attach voice + transcript to slope/detection) | Gloved hands can't type; "north slope, three hits left of the ridge vent" spoken on-roof is the fastest defensible note. `VoiceNoteRecorder.tsx`. | S-M | `expo-audio`+`transcribeAudio` (present) |
| 15 | **Door-knocking analytics + goals** (rolling knocks→contacts→appts→sales, streaks, daily goal) | Canvassing is a numbers game; reps improve when they see the funnel over time. `door-knocking.tsx:173`. | M | `knockSessionStore` (present) |
| 16 | **Video walk-through capture** (20s slope pan, store on inspection, surface in share/proposal) | Most persuasive "roof condition" artifact; every competitor has it. `components/capture`. | M | `expo-camera` video (present), Supabase storage |
| 17 | **IRS mileage-log export** (dated CSV/PDF with purpose/start/end/miles) | The deductible number is useless to an accountant without an exportable dated log. `mileage.tsx`. | S | `expo-print`/`expo-sharing` (present) |
| 18 | **Setup checklist + first-run coach-marks** (profile→service area→keys→first scan; capture-HUD marks) | Fastest path to activation is a checklist ending in a completed inspection; coach-marks prevent the "held the phone wrong" bad first scan. `onboarding.tsx:59`. | S-M | `onboardingStore` (present) |
| 19 | **Territories** (drawable polygons, coverage shading) | Systematically working a hail swath neighborhood-by-neighborhood; foundation for multi-user assignment. `Map.tsx`. | M | Map polygons (present) — **after map wave** |
| 20 | ⚡**Multi-user / team / roles / comments** (Supabase org membership, RLS, assignment, comment threads) | A roofing business is a team; unlocks territories/leaderboards/assignment. `settings.tsx:365`. | L | Supabase restore + RLS (launch blocker), auth |
| 21 | ⚡**Leaderboards** (rank reps on knocks/appts/close-rate/revenue) | Retention engine of crew tools; nothing to rank in single-user. | M | **blocked on #20** |

⚡**NATIVE (need the Apple Developer account, auto-triggered by BACKLOG #57):** #10 background calendar/geofence pieces, #11 remote push on real bundle, Apple Sign In, LiDAR/AR. Everything else ships in Expo Go today.

---

## 4. Proposed wave sequence (dependency order, collision-aware)

In-flight and OFF-LIMITS this month: `app/quick-inspection.tsx`, `app/(tabs)/map.tsx` + `components/map/*`, `lib/services/analysisQueue.ts` + `analysisQueueStore` (capture wave, map crash-trap 7c, roof-measure 7f). Coordinate, never collide.

### Wave A — Foundation fixes (data integrity + chain) — no UI-heavy files
**Goal: stop losing data and connect the money chain.**
- Fix #1 pitch-gauge persist, #2 LWW triggers (new `supabase/` migration), #3 corrections→Supabase, #4 photo-sync throughput, #5 persist versioning, #8 mode-bucket recount.
- Chain wiring: lead↔inspection cross-references, `new-job` route-to-job-not-Home.
- Touches: `pitch-gauge.tsx`, `correctionsSync.ts`, `photoSync.ts`, `leadSync.ts`, `supabase/schema.sql`+migration, `inspectionStore.ts`, `leadStore.ts`, `new-job.tsx`, `lead/[id].tsx`. **No overlap with capture/map.**

### Wave B — IA / navigation redesign — the reachability + dead-end sweep
**Goal: give jobs a home, kill dead ends, surface the day.**
- Leads tab "Leads|Jobs" segmented control + card quick-actions + filters; `/inspections` de-gated.
- Home "Today" module + live stat cards + pressable activity (#9).
- Activity rows pressable (#9); Settings reachable from all tab roots; Reports front doors (Plan row + Home cards).
- Job-detail customer action row + follow-up + linked-lead display; post-signature actions on proposal/job; pipeline auto-advance on proposal/job events (unify state model).
- Touches: `(tabs)/index.tsx`, `(tabs)/leads.tsx`, `(tabs)/plan.tsx`, `(tabs)/settings.tsx`, `(tabs)/train.tsx`, `activity.tsx`, `job/[id].tsx`, `proposal/[jobId].tsx`, `p/[token].tsx`, shared header component. **No overlap with capture/map.**

### Wave C — Business configuration (makes the app sellable-with)
**Goal: the roofer's real numbers and brand on every document.**
- Feature #1 Pricing Settings, #2 Company branding, #12/#13/#17 Reports v2 + exports + mileage export, fix #11 AI-threshold control, fix #12 reports export.
- Touches: new `pricingStore` + `costEstimator.ts`, `proposalGenerator.ts`, `inspectorProfileStore.ts`, `proposalPdf.ts`, `haagPdf.ts`, `longReport.ts` (fix #13 gate), `reports.tsx`, `mileage.tsx`, new Settings screens. Use **dataviz** skill for charts. **No overlap.**

### Wave D — CRM depth + delivery (the follow-up engine)
**Goal: nothing falls through the cracks; documents leave the app cleanly.**
- Feature #3 stage automation, #4 doc delivery (install `expo-mail-composer`/`expo-sms`), #5 contingency e-sign, #11 notification center + push, #12 Contact entity.
- Touches: `leadStore.ts`, `pushNotifications.ts`, `proposal/*`, new contract template, `activityStore.ts`, new notification-center route, Settings prefs. `npx expo install` for the two native-safe modules; run `expo-doctor`. **No overlap.**

### Wave E — Capture enrichment — **runs WITH / AFTER the capture wave, co-owned**
**Goal: the evidence a claim is won on.**
- Feature #6 annotation, #7 delete/reorder, #14 per-finding voice notes, #16 video; fixes #14 enqueue coverage, #15 offline banner, #6 `effectiveThreshold` gate, #7 dataset writers.
- Touches: `edit-detection.tsx`, `quick-inspection.tsx`, `inspectionStore.ts`, `VoiceNoteRecorder.tsx`, `analyzeSlope.ts`, `gemini.ts`, capture camera, `analysisQueueStore`. **HIGH collision risk — sequence after the capture rewrite lands or pair with its owner; do not start these files mid-rewrite.**

### Wave F — Growth surfaces + platform — **after map wave + native account**
**Goal: the pitch's headline features and team scale.**
- Feature #8 Storm Opportunities, #9 AI Coach + Train lessons, #15 door analytics, #18 onboarding checklist/coach-marks, #10 appointments + calendar, #19 territories.
- Then ⚡, gated on BACKLOG #57 STANDING TRIGGER: #20 multi-user/RLS, #21 leaderboards, native push/calendar/AR.
- Touches: new storm-opportunities route, `train.tsx` + coach route, `door-knocking.tsx`, `onboarding.tsx`, new appointment model/store, `Map.tsx` (territories — **after roof-measure 7f ships**). Multi-user needs Supabase restore (current launch blocker).

---

### Cross-cutting discipline (every wave)
- Append a PROMPT_LOG entry per change; move BACKLOG items to Done with the closing entry; add new deferrals to BACKLOG in the same commit (Rule 2 + backlog rule).
- Theme tokens only, ≥56pt targets, sticky 88pt CTAs, confirm sheets on destructive actions (Drift #1, #11).
- HAAG thresholds stay sourced from `docs/HAAG_DECISION_ENGINE.md`; do not touch the unresolved HIGH-band owner decision (BACKLOG #51) without sign-off.
- New native modules via `npx expo install`; keep `expo-doctor` green.
- Push only to `claude/wonderful-franklin-HuSTl`; no PR unless asked.

**Sequencing rationale:** A before B (chain data must exist before the UI links to it); C is independent and parallelizable; D depends on C's contact/pricing groundwork lightly; E is gated by the capture rewrite; F is gated by the map wave and the Apple account. Waves A–D are 100% Expo-Go-shippable now and touch zero in-flight files — start there.
