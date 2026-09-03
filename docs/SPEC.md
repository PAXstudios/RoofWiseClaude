# RoofWise — Full Build Spec for Claude Code

## What you're building

A native iOS app for **roof damage inspectors** — primarily roofing-company sales reps who knock doors after hailstorms, climb roofs to inspect damage, and turn inspections into Haag-compliant insurance reports and homeowner proposals. The app uses AI vision to detect damage from photos, integrates real storm and weather data, and learns from inspector corrections over time.

**Primary user persona:** Field inspector on a roof, wearing work gloves, in direct sun, sometimes wet/dusty hands. Every UI decision must respect this context.

**Branding:** "RoofWise" — confident, professional, contractor-friendly, modern. Navy + burnt orange + cream palette. Logo is a navy roof peak with an orange lightning bolt (roof + storm/AI signal).

---

## Tech stack

- **Native iOS, SwiftUI, Swift 5.9+**, targeting iOS 17+
- **SwiftData** for local persistence
- **MapKit** for map rendering (Apple native, NOT Google Maps SDK — Google Maps SDK is optional and gated)
- **PencilKit** for signatures
- **PDFKit** for Haag PDF report generation
- **AVFoundation** for camera capture
- **CoreLocation** (WhenInUse permission)
- **MessageUI** for SMS proposal links
- **BGTaskScheduler** for background storm scanning + weekly calibration push
- **UserNotifications** for push notifications
- **supabase-swift** SDK (via SPM) for auth + corrections sync
- **Gemini API** (`gemini-2.5-flash` model — NOT `gemini-3` which doesn't exist) for damage detection via HTTPS REST
- **Google Solar API** for roof measurement (HTTPS REST, no SDK needed)
- **Google Weather API** for current weather + forecast (HTTPS REST, no SDK needed)
- **NOAA Storm Events API** for historical storm data (free, keyless)
- **Apple CLGeocoder** for address → lat/lng (keyless)

---

## Brand & design system

### Color palette (use these EXACT values, no inline hex anywhere else)

| Token | Hex | Use |
|---|---|---|
| Navy | `#0C183C` | Headers, primary text, roof-peak mark, navy CTAs |
| Orange | `#FC6018` | Primary CTAs, key stat numbers, lightning bolt, accent |
| Cream | `#F0F0E4` | Backgrounds, secondary surfaces |
| Slate | `#546078` | Secondary text, muted labels |

Create a `Theme.swift` file with these colors as `Color` constants. Every view consumes them via `Theme.navy`, `Theme.orange`, etc. No view should ever contain a raw hex string.

### Typography ramp

Define `Theme.TypeRamp` with these named sizes (Apple-system font):
- `titleXl`: 28pt, semibold — hero headlines
- `titleLg`: 24pt, semibold — page titles
- `titleMd`: 20pt, semibold — section headers
- `titleSm`: 22pt, medium — card titles (yes, 22 not 18 — derived from real usage)
- `bodyLg`: 17pt, regular — body copy
- `bodyMd`: 15pt, regular — secondary body
- `bodySm`: 13pt, regular — labels, chips
- `caption`: 11pt, regular — meta info

Every view uses `Theme.TypeRamp.titleMd` etc., never `.font(.system(size: 20))` directly.

### Card style

Create a `Theme.cardStyle(padding:radius:)` view modifier that applies:
- Background: `Theme.cream` (or white, depending on context)
- Corner radius: 16pt (default) or specified
- Padding: 16pt (default) or specified
- Subtle shadow: `.shadow(color: Theme.navy.opacity(0.06), radius: 8, y: 2)`

Every card-like surface uses `.cardStyle()`, never inline padding/radius/shadow.

---

## Glove-friendly UI rules (MANDATORY — apply to EVERY view)

These are non-negotiable. If you find yourself building something that violates these, stop and rethink.

1. **Minimum touch target: 56pt × 56pt. Preferred: 64pt+. Sticky primary CTAs: 88pt.** No tiny icons, no thin checkboxes, no 32pt chips. A gloved fingertip is ~20pt wide and imprecise.
2. **Spacing between tappable elements: ≥12pt.** A glove that grazes the gap between two buttons shouldn't tap both.
3. **Primary CTAs live in the bottom thumb zone** (lower 30% of screen) as sticky elements when in a flow.
4. **High contrast.** Outdoor sun bleaches light gray text. Body text on cream uses navy or slate (never light gray on white).
5. **Voice input** on every free-text field via `SFSpeechRecognizer`. Show a mic icon inside the field. Inspectors don't want to type with gloves on.
6. **Forms use chips, steppers, segmented controls — not text inputs** wherever possible. Numbers via stepper, choices via chips, dates via 64pt chip picker (Tomorrow / 3 Days / 1 Week / Custom).
7. **Confirm on destructive actions** with a 88pt confirm button. Gloves mistap.
8. **No precision gestures.** No pinch-to-zoom as the only path. No long-press only. No swipe-to-reveal as the only path. Always offer a tap alternative.
9. **One-handed friendly.** Critical controls reachable in the lower 60% of the screen.
10. **Cancel-while-dirty triggers a confirm sheet** with destructive "Discard" + "Keep editing" options.

---

## App architecture

### Navigation: 5 bottom tabs

1. **Home** — dashboard with storm alerts, recent jobs, KPIs, hero CTAs
2. **Leads** — pipeline of prospects, filtered by stage
3. **Map** — storm overlay, lead/job pins, door-knocking mode
4. **Plan** — today's schedule, weekly view, route stops
5. **Train** — AI training queue, lessons, role-play coach (placeholders fine)

### Navigation patterns

- Tabs at bottom (TabView)
- Within tabs, NavigationStack for drill-downs
- Full-screen covers (`fullScreenCover`) for camera, door-knocking mode, swipe review
- Sheets (`sheet`) for editors, action sheets, detail views
- Multi-step wizards use a single full-screen flow with progress strip at top + sticky bottom Next/Back

---

## Data models

### Inspection (SwiftData)

The Haag-compliant JSON schema. Snake_case JSON, camelCase Swift, manual decoder for the bridge.

```swift
@Model class Inspection {
    var id: UUID
    var reportId: String            // auto-minted "RW-2026-####"
    var createdAt: Date
    var status: InspectionStatus    // lead / scheduled / in_progress / complete

    // Customer & Property
    var customerName: String
    var customerPhone: String?
    var customerEmail: String?
    var address: String
    var lat: Double?
    var lng: Double?

    // Insurance
    var carrier: String?            // one of 8 supported carriers
    var policyNumber: String?
    var claimNumber: String?
    var adjusterName: String?

    // Roof System
    var material: String            // 3-tab asphalt / architectural / metal / wood / concrete / clay / etc.
    var ageYears: Int
    var geometry: String            // gable / hip / mansard / flat / mixed
    var condition: String           // excellent / good / fair / poor
    var collateralChecklist: [String: Bool]  // brittleness test, layers, etc.

    // Event (storm)
    var event: StormEvent?          // hail/wind event auto-filled from NOAA

    // Slopes
    var slopes: [Slope]             // typed relationship

    // Roof-level outputs
    var roofRecommendation: String? // Repair / Partial / Full Replacement
    var roofVerdictReasoning: String?
    var verifyWithInspector: Bool   // set when confidence_avg < 0.5

    // Traceability
    var originEstimateId: UUID?     // if converted from CostEstimator

    // Signatures
    var inspectorSignaturePNG: Data?
    var homeownerSignaturePNG: Data?
    var signedAt: Date?
}

@Model class Slope {
    var id: UUID
    var orientation: String         // N / NE / E / SE / S / SW / W / NW / Flat
    var pitch: Double?              // 4/12, 6/12, etc.
    var area_squares: Double        // 1 square = 100 sq ft
    var detected_area_squares: Double?  // from Solar API
    var damage: [DamageMarker]      // photo markers
    var hailCount: Int
    var windLiftCount: Int
    var wearCount: Int
    var missingCount: Int
    var bruisingCount: Int
    var functional: Bool            // toggle: functional vs cosmetic damage
    var verdict: String?            // Repair / Partial / Replace
    var verifyWithInspector: Bool   // when confidence_avg < 0.5
    var aiFindings: [InspectionFinding] = []  // transient; not encoded
    var photoPaths: [String]
}

struct StormEvent: Codable {
    var date: Date
    var kind: String                // hail / wind / mixed
    var hailSizeInches: Double?
    var windSpeedMph: Double?
    var noaaEventId: String?
    var distanceMiles: Double?
    var source: String              // "NOAA" / "manual"
}

struct DamageMarker: Codable {
    var id: UUID
    var category: DamageCategory    // hail / wind / wear / missing / granuleLoss / bruise / lifted / torn / exposedMat
    var severity: Severity          // minor / moderate / severe
    var x: Double                   // normalized 0-1 of image width
    var y: Double                   // normalized 0-1 of image height
    var radius: Double              // normalized 0-1 of min(width, height)
    var confidence: Int             // 0-100
    var note: String?
}
```

### Other models (sketch)

- `Customer` — name, contact info, address, status (lead/active/customer/lost)
- `Lead` — stage, value, source, last contact, follow-up date
- `Job` — bridges Inspection + crew + install timeline
- `Estimate` — CostEstimator output, line items, total, status
- `Proposal` — Estimate + signed terms + line items, status (DRAFT/SENT/VIEWED/SIGNED/DECLINED/EXPIRED), sent_to, sent_at, viewed_at, signed_at, signature PNG
- `Knock` — lat/lng, address, outcome (NOT_HOME/INTERESTED/NOT_INTERESTED/INSPECTION_SCHEDULED/FOLLOW_UP), notes, follow_up_date, created_lead_id
- `KnockSession` — id, started_at, ended_at, route_storm_alert_id?, knocks: [Knock]
- `ServiceArea` — list of ZIPs/cities the rep covers
- `StormAlert` — fired_at, event_kind, area_label, property_count, status (new/dismissed/acted_on)
- `TrainingItem` — pending corrections queue item (id, photoPath, originalAnalysis, inspectionId, slopeOrientation, status)
- `Correction` — full delta tracking of user corrections (id, inspectionId, photoId, originalDetection, correctedDetection, correctionType, delta, syncStatus)
- `UserCorrectionProfile` — rolling stats (per_category_accuracy, under_count, over_count, calibration_offset)
- `ActivityEvent` — 14+ event kinds for the activity feed
- `Proposal`, `ProposalLink` — proposal + tokenized share URL

### Stores (one per major model)

Each store is `@Observable`, owns a SwiftData query or JSON file, and exposes simple CRUD + computed properties. E.g. `InspectionStore.shared.create(...)`, `LeadStore.shared.filter(stage:)`, `CorrectionsStore.shared.pendingSyncCount`.

---

## Services layer

| Service | Purpose | Live impl | Mock fallback |
|---|---|---|---|
| `GeminiAnalysisService` | Damage analysis from photos | HTTPS POST to `generativelanguage.googleapis.com`, `gemini-2.5-flash` | None — real only |
| `SolarService` | Roof measurement (squares) | HTTPS GET to `solar.googleapis.com/v1/buildingInsights:findClosest` | None — real only |
| `WeatherService` | Current weather + 24h forecast | HTTPS GET to Google Weather API | None — real only |
| `StormEventsService` | Hail/wind events for a coord + radius + date range | HTTPS GET to NOAA NCEI | None — real only |
| `GeocodingService` | Address ↔ lat/lng | Apple `CLGeocoder` | None — real only |
| `DecisionEngine` | Pure rules engine: per-slope + roof-level verdict from damage + material | Local Swift | N/A |
| `HaagReportGenerator` | 9-section PDF report | PDFKit | N/A |
| `ProposalPDFGenerator` | Branded proposal PDF | PDFKit | N/A |
| `CostEstimatorService` | Line items + regional pricing | Local Swift | N/A |
| `SupabaseService` | Auth + corrections sync | supabase-swift, PKCE | N/A |
| `CorrectionsStore` | Local corrections + sync queue | SwiftData + JSON outbox | N/A |
| `LocalLearningEngine` | Per-user confidence threshold calibration | Local Swift | N/A |
| `StormPushService` + `CalibrationPushService` | Local push notifications | UNUserNotificationCenter | N/A |
| `StormWatchService` | Background NOAA polling + BGAppRefreshTask | BGTaskScheduler | N/A |
| `ActivityStore` | Per-inspection activity log + tap-trace | JSON in Application Support | N/A |

**No mocks anywhere.** When a service can't reach its API (no key, network down, etc.), throw a clear error and surface a clean "Not available" state in the UI. Never synthesize fake data.

---

## Feature breakdown by phase

You can build these in this order — each builds on the last, each is independently testable. Build-pass between each phase. Glove rules + Theme tokens applied throughout.

### Phase 1 — Home dashboard

- Welcome header ("Hi Derrick" / time + weather chip)
- Storm Alert hero card (when `StormAlertStore.latestActiveAlert != nil`): orange "Severe Hail" chip, navy bg, white "View Impacted Properties" 64pt CTA — hides when nil, never shows stale "Severe Hail" placeholder
- Two hero CTAs side by side: Quick Inspection (orange 80pt card) and New Job (cream 80pt card with navy border)
- KPI tiles row: Revenue / Leads / Pipeline — small cream cards with navy numbers
- Recent Jobs horizontal carousel: 240×220 photo cards, address scrim overlay, status pill, Damage Score chip
- Pipeline mini-Kanban strip: 110×84 stage chips, taps drive Leads tab filter
- Today's Plan card with first scheduled stop

### Phase 2A — Data foundation + 4-step New Job wizard

- `Inspection` model with full Haag JSON schema, snake_case ↔ camelCase
- `InspectionStore.shared` with SwiftData, auto-mints `RW-2026-####` IDs
- `NewJobWizard` (full-screen cover from "New Job" CTA):
  1. Customer & Property — name, phone (optional), email (optional), address with Places autocomplete + "Use my current location" 64pt button
  2. Insurance — 8-carrier grid (State Farm, Allstate, USAA, Liberty Mutual, Farmers, Travelers, Nationwide, Erie), policy + claim + adjuster fields
  3. Roof System — material chips, age stepper, geometry chips, condition chips, collateral checklist
  4. Review — summary card with pencil-edit jump-back to any prior step
- Sticky 88pt Next button at bottom of each step
- `JobDetailView` placeholder — opens from Recent Jobs tap

### Phase 2B — Slope capture + Decision Engine

- `QuickInspectionView` (full-screen cover from Quick Inspection CTA): full-screen camera preview, capture button, slope orientation chip selector at bottom
- `SlopePhotosSheet`: thumbnails grid per slope, tap to enlarge
- `InspectionSession` orchestrates: capture photo → call GeminiAnalysisService.analyze → write findings to slope.aiFindings via `InspectionStore.setAIFindings` → render `PhotoDamageOverlayView` with detected markers
- `PhotoDamageOverlayView`: photo + circle markers positioned relative to the photo's display rect (NOT the screen — use GeometryReader scoped to the image)
- `SlopeCaptureView`: per-category cards (Hail/Wind/Wear) with steppers + live cost computation (D × U × R × A), Functional/Cosmetic chips, sticky 88pt Save bar
- `DecisionEngine`: pure Swift rule engine, per-material HAAG thresholds, per-slope + roof-level recommendation
- When `confidence_avg < 50`, attach `verifyWithInspector = true` to the slope

### Phase 3 — Haag PDF report + signatures

- `HaagReportGenerator` (PDFKit, 9 sections):
  1. Cover (logo, report ID, customer, address, inspector, date)
  2. Weather verification (storm event details from NOAA)
  3. Roof system (material, age, geometry, condition, measurements)
  4. Slope-by-slope findings (color-coded verdict pills, damage marker overlays)
  5. Collateral checklist
  6. Summary callout (overall verdict + reasoning)
  7. Insurance-grade narrative (longer, professional)
  8. Homeowner summary (plain language)
  9. Signature blocks
- `SignaturesView`: PencilKit canvases (240pt) for inspector + homeowner, Save/Clear
- Generate Haag Report 88pt button on JobDetailView → PDF Preview sheet → native iOS share sheet

### Phase 4 — Map, Weather, Solar, Cost Estimator

- **4A Map:** `MapHubView` using Apple MapKit, filter chips (Leads / Jobs / Storms / Knocks), 56pt zoom column, MOCK/LIVE pill removed (we're always live now), camera centers on user's real location on first appear via CLLocationManager
- `AddressPickerSheet`: Google Places autocomplete via REST
- `StormDetailSheet`: storm pin tap → date / size / source / distance / 2-5-10-20 mi radius picker → "Find inspections nearby" 64pt CTA
- **4B Weather:** `WeatherService` calling Google Weather API for current + hourly forecast. `WeatherTile` on Home, weather chip on NewJobWizard Step 1, Site Weather pill on JobDetailView
- **4C NOAA:** `StormEventsService` (free, no key). `GeocodingService` (Apple, no key). MapHubView date scrubber (3/6/12/24 months). `InspectionStore.autoPopulateEvent` runs on inspection save — if hail ≥0.75" or wind ≥58 mph within 5mi and ±30 days, auto-fills `Inspection.event{}`
- **4D Solar:** `SolarService` calling `solar.googleapis.com/v1/buildingInsights:findClosest`. Roof + Slope gain `detected_area_squares`. NewJobWizard Step 3 detection card with "Use detection" / "Enter manually" CTAs. JobDetailView roof-measurements card with color-coded MKPolygon slope outlines
- **4E Cost Estimator:** `CostEstimatorService` with regional pricing tables (asphalt/3-tab/metal/wood/concrete/clay). `EstimatesStore`. `CostEstimatorWizard` 4-step: Address → Roof Detection → Material → Result with Low/Mid/High range. Saved Estimates section on Home. "Convert to New Job" sticky CTA prefills NewJobWizard with snapshot

### Phase 5 — Traceability, Activity Feed, Training Queue

- **5A:** `Inspection.originEstimateId` field. When user clicks "Convert to New Job" from an Estimate, snapshot the estimate state into the new Inspection. JobDetailView shows mint "From estimate" chip that reopens the source estimate at Step 4.
- **5B Activity Feed:** `ActivityEvent` with kinds (jobCreated, slopeSaved, photoCaptured, analysisRan, weatherChecked, proposalSent, signatureRecorded, knockLogged, knockConvertedToLead, routeCompleted, aiCalibrationUpdated, etc.). `ActivityStore.log(...)`. `ActivityFeedSheet` timeline accessed from JobDetailView "Activity" 64pt button
- **5C AI Training Queue:** `TrainingItem` (kind, status). `TrainingQueueStore` auto-enqueues items when `confidence_avg < 60` OR detection count > 10. `TrainingQueueView` with "Pending Review" + "Stats" tiles, glove-friendly review cards. AI Tools section + Lessons section as placeholders ("Coming soon")

### Phase 6 — Service Area, Storm Watch, Push, Storm Hero, Door Knocking

- **6A:** `ServiceArea` model + `ServiceAreaStore`. `Settings/ServiceAreaView`: search ZIP/city → 64pt "Add to my service area", saved list with swipe-to-remove + explicit Remove button. First-launch prompt to add at least one area before Storm Watch arms.
- **6B Storm Watch Service:** `StormWatchService` does foreground 30-min `Timer` polling + 4-hour `BGAppRefreshTask` when backgrounded. NOAA dedup by event_id. Hail ≥0.75" OR wind ≥58 mph thresholds (configurable). For each new event in any saved ServiceArea: count properties (leads + jobs) within 5mi → emit `StormAlert`. Debug 3× long-press on DashboardHeader title fires `injectMockStorm()` for testing.
- **6C Push Notifications:** `StormPushService`. Request `UNAuthorizationOptions(.alert, .sound, .badge)` on first ServiceArea save with `NotificationsRationaleView` (88pt Allow / Maybe Later). On new StormAlert: local notification "Severe Hail Warning · {area}", body "{count} properties impacted · Open to start route", with 2 actions: "View Impacted" (deep link → Map filtered) and "Snooze 4h". `AppNotificationDelegate` routes the deep link.
- **6D Dynamic Storm Alert hero:** Home card consumes real `StormAlertStore.latestActiveAlert`, hides when nil. "View Impacted Properties" → MapHubView with `focusedStorm` + 5mi filter via new `DashboardRoute.stormImpact` case. Long-press OR tap-then-confirm dismiss.
- **6E Door Knocking Mode:** `KnockSession`, `Knock`, `KnockSessionStore`. `DoorKnockingModeView` full-screen cover from MapHubView "Door Knocking Mode" 64pt CTA: live route stats at top (count, % interested, time), center MapKit canvas with user location + color-coded knock pins, sticky bottom 88pt "Log Knock at My Location" → `LogKnockSheet` with 2×3 outcome chips, optional voice notes (SFSpeechRecognizer), follow-up date 64pt chips (Tomorrow/3 Days/1 Week/Custom), Save 88pt. INTERESTED + INSPECTION_SCHEDULED auto-create a Lead. "Wrap Route" 64pt → `EndRouteSummarySheet` with conversion stats, logs `routeCompleted` to ActivityStore.

### Phase 7 — Proposals & Closing Loop

- `Proposal` model with full line-item structure
- `ProposalStore` (SwiftData)
- `ProposalGenerator` — auto-builds line items from a Job's Inspection: tear-off, decking, underlayment, ice/water shield, drip edge, ridge, valley, shingles, ventilation, gutters, flashing, labor — pulled from DecisionEngine output + Solar squares + regional pricing
- `ProposalEditorView` 6-step wizard: Cover → Scope of Work (auto narrative + edit, voice input) → Line Items (tap-edit, swap-with-confirm) → Pricing (subtotal/tax/deposit, real-time math, number pads) → Terms (warranty + payment schedule + expiration) → Review
- `ProposalPDFGenerator` (PDFKit, branded cover w/ logo placeholder, line-item table, signature block)
- "Send to Homeowner" 88pt sticky CTA on Review step → sheet with Email / SMS / Generate Link / Copy Link
  - Email: native share sheet w/ prefilled subject+body+PDF
  - SMS: `MFMessageComposeViewController` w/ prefilled link
  - Generate Link: mock service creates `roofwise.app/p/<8-char-token>`, stored in `ProposalLinkStore`
- Debug menu: "Open as Homeowner" → read-only sheet (scope, items, total) → "Sign Proposal" 88pt CTA → PencilKit canvas → records `signed_at` + signature PNG → status flips to SIGNED → ActivityStore logs `proposal_signed`
- JobDetailView gains Proposal card with status pill + Open / Edit / Resend buttons

### Phase 8 — Real Gemini structured confidence (additive, behind feature flag)

- `APIKeys.useStructuredConfidence: Bool = false` (default OFF; set to true to activate)
- When ON, `TrainingQueueStore` switches enqueue logic from deterministic stub to real `confidence_avg < 60` check
- `SlopeCaptureView`: per-category cards show "AI confidence: NN%" chip when flag ON, sourced from per-category avg in latest AnalysisResult for that slope. Tap chip → info sheet explaining low confidence
- `DecisionEngine`: when flag ON AND `confidence_avg < 50`, attach `verifyWithInspector = true` to slope. JobDetailView renders mint "Verify with inspector" badge next to verdict pill when true.
- Strictly additive — existing analyze path stays untouched
- Gemini prompt unchanged; we just consume the existing per-finding/per-marker `confidence: 0-100` fields

### Phase 9 — Recursive Learning Loop (Tinder swipe + corrections)

- **9A SwipeReviewView:** Full-screen card stack reachable from TrainingQueueView "Pending Review" tile and JobDetailView "Review AI" 64pt button
  - Each card = one TrainingItem photo + AI overlays + per-category confidence chips
  - Top: AI verdict header ("HAIL · 12 hits · 87% confidence")
  - Bottom thumb-zone: 88pt "Correct" (green) + 88pt "Edit" (orange) + 56pt Skip + 56pt "Not damage"
  - Swipe right = Correct, left = Edit (opens OverlayEditorView), up = Skip, down = Not damage. Each direction ALSO has a button (glove rule).
  - Card tap = pinch-to-zoom photo without affecting swipe gesture
  - Progress strip at top
  - Done state: summary card with stats + "Apply corrections" 88pt CTA
- **9B OverlayEditorView:** From swipe-left / Edit
  - Photo + AI markers in light orange
  - Tap marker → 56pt action sheet: Move / Resize / Delete / Change Category
  - "+ Add Damage" 64pt FAB → tap on photo → drop marker → category chip grid → severity chips → save
  - Voice notes per marker
  - Sticky 88pt Save
  - Cancel-while-dirty → confirm sheet
  - Save produces `DetectionDelta` (list of marker ops: added/moved/resized/deleted/recategorized)
- **9C Correction model + CorrectionsStore:** Every swipe + edit writes a Correction with original + corrected snapshots, delta, real inspectionId + photoId (NOT placeholder UUIDs — thread from TrainingItem), sync_status
- **9D LocalLearningEngine:**
  - `UserCorrectionProfile`: rolling stats over last 100 corrections per category (accuracy, under_count, over_count, confidence_calibration_offset)
  - `LocalLearningEngine.recomputeFromStore()` runs after each correction
  - `effectiveThreshold(forCategory:)` returns per-user confidence cutoff
  - `userStylePromptPrefix()` returns a small prompt prefix to prepend to GeminiAnalysisService's system prompt when user has ≥20 corrections
  - Emits `ActivityEvent.aiCalibrationUpdated` when threshold deltas land
  - `TrainingView` calibration row: "Calibrating to your inspection style — N corrections recorded"
- **9E CorrectionsSyncService:** JSONL outbox in Application Support, 5MB rotation, `syncEnabled` toggle. Stubbed POST to `correctionsEndpoint` placeholder URL in APIKeys (real backend lives in a separate Next.js + Supabase project)
- **9F Visible learning feedback:**
  - `AICalibrationCard` on Home: "AI accuracy: NN%" — hides until ≥5 corrections recorded
  - Per-correction toast on save: "Thanks — improved hail detection 0.4% for you"
  - Weekly calibration push: `CalibrationPushService` BGAppRefreshTask `com.roofwise.calibration_weekly` — fires after 7 days + ≥1 correction
  - `ActivityStore` logs `aiCalibrationUpdated` events

### Phase 10 (optional, separate project — DON'T build inside iOS app) — Corrections backend

Separate Next.js + Supabase + Vercel project that:
- Ingests Corrections from iOS via `POST /api/v1/corrections/batch`
- Admin UI for curating corrections into a training dataset
- Authority weighting (Haag-certified inspectors weighted higher)
- Feeds an eventual fine-tuning pipeline

This lives in `roofwise-backend` (separate repo). Set `correctionsEndpoint` in APIKeys.swift to the deployed URL.

---

## Configuration

### `Configuration/APIKeys.swift`

```swift
enum APIKeys {
    static let googleMapsApiKey = "<YOUR_KEY>"
    static let googleSolarApiKey = "<YOUR_KEY>"   // same key works if Solar API enabled on same project
    static let googleGeocodingApiKey = "<YOUR_KEY>"
    static let googlePlacesApiKey = "<YOUR_KEY>"
    static let googleWeatherApiKey = "<YOUR_KEY>"

    // Gemini key comes from EXPO_PUBLIC_GEMINI_API_KEY env var OR a SwiftPlist entry — NOT hardcoded
    static var geminiApiKey: String {
        ProcessInfo.processInfo.environment["GEMINI_API_KEY"] ?? Bundle.main.infoDictionary?["GeminiApiKey"] as? String ?? ""
    }

    // Supabase
    static let supabaseUrl = "<YOUR_SUPABASE_URL>"
    static let supabaseAnonKey = "<YOUR_ANON_KEY>"

    // Backend
    static let correctionsEndpoint = "https://api.roofwise.app/v1/corrections/batch"

    // Feature flags
    static let requireAuth: Bool = false                  // dev bypass; flip to true to enforce sign-in
    static let useStructuredConfidence: Bool = true       // Phase 8 chips + verify-with-inspector badge

    // NOAA
    static let noaaUserAgent = "RoofWise iOS / contact@roofwise.app"
}
```

### Info.plist keys required

- `NSLocationWhenInUseUsageDescription` — "RoofWise uses your location to map storm activity, find nearby leads, and log door-knocking visits."
- `NSCameraUsageDescription` — "RoofWise uses the camera to capture roof damage photos for AI analysis."
- `NSMicrophoneUsageDescription` — "RoofWise uses the microphone for voice-to-text notes during inspections."
- `NSSpeechRecognitionUsageDescription` — "RoofWise uses speech recognition to transcribe your voice notes."
- `BGTaskSchedulerPermittedIdentifiers` — array containing `app.roofwise.stormwatch` and `com.roofwise.calibration_weekly`
- `CFBundleURLTypes` — array with `CFBundleURLName = "com.paxconsulting.roofwise.deeplink"` and `CFBundleURLSchemes = ["roofwise"]`

### Swift Package Manager dependencies

- `https://github.com/supabase/supabase-swift` at 2.40.0+
- Optionally `https://github.com/googlemaps/ios-maps-sdk` (gated by `#if canImport(GoogleMaps)` — only needed if you want Google's map tiles instead of Apple MapKit)

---

## Operating principles (carry through every phase)

1. **No mocks anywhere.** Every service has only a Live implementation. When a service can't reach its API, throw a clear error and show a clean "Not available" empty state.
2. **No seeded sample data.** App boots to an empty state — no fake customers, leads, jobs, or storms.
3. **Theme tokens everywhere.** Never inline hex. Never inline font sizes. Always go through `Theme.navy` / `Theme.TypeRamp.bodyMd` / `.cardStyle()`.
4. **Glove rules on every new view.** 56-64pt touch targets, ≥12pt spacing, sticky bottom CTAs in thumb zone, voice input on free text, confirm on destructive, no precision gestures.
5. **Build-pass between phases.** Don't move to the next phase until the previous one compiles green.
6. **Additive when extending.** When you add a feature behind a flag (like Phase 8), the OFF path must be byte-identical to before the change.
7. **Tap-trace logging.** Every primary action calls `ActivityStore.logTap(target: "<screen>.<element>")` so future "nothing happened" reports point straight at the dead element.
8. **No precision gestures.** Tap alternative for every swipe, long-press, or pinch.
9. **Verbose error logging.** Every non-200 HTTP response from external APIs logs the full response body with a `[ServiceName]` prefix.
10. **The camera flow is sacred.** `QuickInspectionView`, `SlopePhotosSheet`, `InspectionSession`, `CameraCaptureService` should stay byte-identical once they're working. Don't refactor them when adding new features.

---

## What NOT to do

- Don't use Google Maps SDK as the default — Apple MapKit is fine and avoids the SDK install hassle. Keep the GMS branch gated by `#if canImport(GoogleMaps)` for users who want it later.
- Don't use Apple WeatherKit — it requires the Apple Developer entitlement, which adds friction. Use Google Weather API (same key as Maps).
- Don't add `response_schema` (strict JSON schema) to the Gemini request — it's caused HTTP 400s in real testing. Use plain JSON-mode parsing.
- Don't change the Gemini model from `gemini-2.5-flash`. There is no `gemini-3-flash` (this is a hallucination).
- Don't add grid-hallucination detection or confidence-threshold filters to GeminiAnalysisService without verifying on real photos first. These can be added later as additive layers behind feature flags.
- Don't put auth gating in front of the app during initial build. Set `APIKeys.requireAuth = false` so you can use the app without logging in. Flip it to true when you're ready to ship.
- Don't put sample customers, leads, jobs, or storms in the app. Empty state always.

---

## Build order recommendation

If you're starting fresh, build in this order:

1. Theme.swift (colors + TypeRamp + cardStyle modifier)
2. APIKeys.swift (with placeholder keys)
3. Phase 2A (Inspection model + InspectionStore + NewJobWizard) — gives you something to test
4. Phase 1 (Home dashboard with placeholder data from store)
5. Phase 2B (Slope capture + camera + Gemini + Decision Engine) — biggest functional chunk
6. Phase 3 (Haag PDF report)
7. Phase 4A → 4E (Map, Weather, NOAA, Solar, Cost Estimator) — can do in any sub-order
8. Phase 5A → 5C (Traceability, Activity Feed, Training Queue)
9. Phase 6A → 6E (Service Area, Storm Watch, Push, Dynamic Hero, Door Knocking)
10. Phase 7 (Proposals)
11. Phase 8 (Structured confidence, behind flag)
12. Phase 9 (Recursive learning loop)
13. Auth wiring + URL scheme (when ready to ship)
14. Phase 10 (separate Next.js project for corrections backend)

Each phase ships as a discrete diff that builds clean.

---

## Verification checklist before shipping each phase

- [ ] Build passes
- [ ] All new views use `Theme.cardStyle` + `Theme.TypeRamp`, no inline hex, no inline font sizes
- [ ] All new touch targets ≥56pt
- [ ] Primary CTAs sticky in thumb zone where appropriate
- [ ] Voice input on free text fields
- [ ] Confirm sheets on destructive actions
- [ ] No precision-only gestures
- [ ] Tap-trace logging on primary actions
- [ ] No mocks, no seeded sample data
- [ ] Empty states are friendly and informative
- [ ] Tests on derrick's iPhone (or wherever the target device is)

---

## When in doubt

The user is a roofer on a roof in gloves under direct sun. Build for that user. Every other design decision falls out of that.

---

# EXPANDED FEATURE SPECIFICATIONS

The sections below add depth to the phases above and introduce features that should be planned for but can be deferred to later phases. Use the build order to know what's first.

---

## HAAG Inspection Algorithm — Full Specification

The Decision Engine must implement HAAG (Haag Engineering) inspection standards. This is the standard insurance carriers and adjusters use to qualify hail damage claims. Get this wrong and reports get rejected.

### Test Square Methodology

A "test square" is a 10' × 10' area on a single slope inspected for hail strikes. Per HAAG:

1. Pick the **most-damaged slope** (or one per orientation if doing thorough inspection).
2. Mark off 10' × 10' (100 sq ft) area on that slope.
3. Count visible hail strikes within the test square.
4. Apply material-specific threshold to determine if the slope qualifies for replacement vs repair.

### Material-Specific Damage Thresholds

| Material | "Functional damage" threshold per test square | Source |
|---|---|---|
| 3-tab asphalt shingles | 8+ hits | HAAG guidelines |
| Architectural / laminated asphalt | 10+ hits | HAAG guidelines |
| Luxury/designer asphalt | 8-10 hits depending on weight | HAAG guidelines |
| Wood shake | Visible fractures with displaced wood | HAAG / IICRC |
| Wood shingle | Split or fractured shingles, granular crushing | HAAG |
| Metal (standing seam, shingles) | Functional dents only — cosmetic dents don't count under most policies | HAAG / insurance-state laws vary |
| Clay tile | Cracked or shattered tiles | HAAG |
| Concrete tile | Cracked or shattered tiles | HAAG |
| Slate | Cracked, fractured, or displaced slates | HAAG |
| Synthetic slate/shake | Visible impact fractures | HAAG |
| Composite | Material-dependent | HAAG |
| Rolled roofing | Granule loss, exposed mat, punctures | HAAG |
| TPO / EPDM (flat) | Punctures, exposed scrim | HAAG |

These thresholds go in `Services/HaagThresholds.swift` as a lookup function:

```swift
enum HaagThresholds {
    static func functionalDamageHitThreshold(for material: RoofMaterial) -> Int {
        switch material {
        case .threeTabAsphalt: return 8
        case .architecturalAsphalt: return 10
        case .luxuryAsphalt: return 8
        case .metalStandingSeam, .metalShingle: return 0  // functional damage = penetration only
        case .clayTile, .concreteTile, .slate, .syntheticSlate: return 1  // any crack qualifies
        // ...
        }
    }
}
```

### Decision Engine Rule Set

`DecisionEngine.evaluate(inspection: Inspection) -> RoofVerdict`:

**Per-slope:**
1. Count `hailCount` markers in the test square area (or all markers if no test square defined).
2. If `hailCount >= HaagThresholds.functionalDamageHitThreshold(for: material)` → slope qualifies for replacement.
3. If slope qualifies but `windLiftCount + missingCount > 0` and inspector confirmed via brittleness test → slope qualifies for full replacement on wind alone too.
4. Otherwise → repair (mark individual damage spots).

**Roof-level:**
1. If **any slope** qualifies for full replacement AND material is one of the "all-or-nothing matching" types (asphalt architectural, certain stone-coated metal, certain tile) → recommend **Full Replacement** with cited reason.
2. If multiple slopes qualify but material allows partial replacement (e.g. metal standing seam) → recommend **Partial Replacement** with list of qualifying slopes.
3. If 1-2 slopes have minor damage → recommend **Repair** with itemized scope.
4. If `roofAgeYears > 25` AND any damage → flag age-related deterioration as confounding factor; verdict drops to "Verify with inspector."

**Confidence layer (when `useStructuredConfidence == true`):**
- If `confidence_avg < 0.5` across detected markers → attach `verifyWithInspector = true`
- If `confidence_avg < 0.7` → recommendation stays but flag "AI uncertainty — recommend on-site verification"

### Brittleness Test (collateral evidence)

For asphalt shingles, HAAG also wants a brittleness test:

1. Lift a corner of a shingle on a non-damage slope (control).
2. Apply firm pressure to fold the lifted corner.
3. If shingle cracks/breaks at the fold → it's brittle (age-related).
4. If shingle flexes without breaking → still functional.

Add a `BrittlenessTest` model field with values `notTested / passed / failed` and a 64pt chip selector in the `NewJobWizard` Step 3 (Roof System). If failed, the DecisionEngine cites age-related deterioration as a confounding factor.

### Required Photo Documentation (per HAAG)

For each slope:
- One overall photo of the slope
- One close-up of each major damage type
- Test square photo with reference object (tape measure, chalk square)
- Slope identifier in frame (chalk marking, photo metadata, etc.)
- Direction indicator (compass overlay on photo if possible)

`HaagReportGenerator` checks the slope's `photoPaths` and warns if any required photo type is missing.

---

## Damage Taxonomy — What Each Type Looks Like

This is what the Gemini prompt should teach the model AND what should be in the inspector training materials in the Train tab.

### Hail Damage

**Visual characteristics (any one is sufficient):**
- Round circular impact spot, 1/4" to 2" diameter (penny-to-half-dollar size range, larger for severe hail)
- Granule loss exposing the dark asphalt mat underneath
- Bruise or "soft spot" — surface depression visible from the side at low angle
- Fracture line radiating from impact point
- Sharp-edged discoloration distinct from normal granule pattern variation

**NOT hail damage (common false positives):**
- Manufacturing pattern variations in granule distribution
- Lichen, moss, or algae spots (irregular shape, often greenish)
- Foot traffic blemishes (smudged, not circular)
- Mechanical damage from tools (often elongated or with tool-mark shapes)
- Tree branch impacts (often elongated, with bark/debris traces)
- Vent gas etching (concentric rings near vents)
- Heat blistering (raised bumps, not depressed)
- Normal weathering granule loss (uniform across whole roof)

**Distribution pattern:** Hail damage is **clustered and random** — some areas of a roof get hit, others don't. Real hail does NOT produce uniform grid patterns covering every shingle.

### Wind Damage

**Visual characteristics:**
- Missing shingles or tabs (gap visible to underlayment or mat)
- Lifted or creased shingles (visible bend, not flat against roof)
- Torn shingles (jagged edges along tear)
- Displaced flashing
- Damaged ridge cap
- Sealant strip failure (bottom edge of shingle no longer adhered)

**Wind speed correlations:**
- 40-50 mph: minor lifting on aged shingles
- 60-70 mph: missing tabs, lifted ridge caps
- 80+ mph: missing shingles, structural damage

### Wear & Tear (NOT covered by storm claims)

**Visual characteristics:**
- Uniform granule loss across entire roof or slope
- Curling or cupping shingle corners
- Aging-related cracking in straight lines (not radial)
- Loss of color uniformity
- Algae/moss growth
- Sagging deck or visible structural issues

**Why it matters:** Insurance adjusters reject claims that confuse wear with storm damage. The DecisionEngine should distinguish and call out wear as a separate category that does NOT qualify for storm coverage.

### Granule Loss

**Visual characteristics:**
- Bald spots where the protective granule layer has worn off
- Black or dark asphalt mat exposed
- Patches of varying size, often near valleys and drainage paths
- Granules collected in gutters or downspouts (look for build-up)

**Causes (different remediation):**
- Hail impact → covered as hail damage
- Aging → wear and tear (not covered)
- Foot traffic → not covered

### Bruising

**Visual characteristics:**
- Soft spot when pressed with thumb (springy feeling)
- Bull's-eye discoloration where the granule mat has been crushed but granules are still in place
- Often paired with granule loss in same impact area

### Exposed Mat

**Visual characteristics:**
- Black asphalt fiberglass mat visible (no granules)
- Often the center of a larger damaged area
- Vulnerable to UV degradation if not repaired

### Lifted / Torn Shingle

**Visual characteristics:**
- Shingle no longer flat against the deck
- Visible bend or crease where it's been bent up
- Sealant strip broken or visible
- Adjacent shingles may show stress at the seam

### Missing Shingle

**Visual characteristics:**
- Bare deck visible (no shingle present)
- Adjacent shingles may show tear marks
- Underlying felt or synthetic underlayment visible
- Often follows wind events along the leading edge of a slope

### Flashing Damage

**Visual characteristics:**
- Bent, missing, or improperly sealed metal flashing
- Around chimneys, valleys, skylights, walls
- Often the source of leaks even when shingles look intact
- Should be photographed close-up with context

### Algae / Moss / Lichen

**Visual characteristics:**
- Black streaks (algae) along slope direction
- Green or fuzzy patches (moss)
- Crusty grey-green growth (lichen)
- NOT storm damage but should be noted on report (affects roof age estimate)

### Structural Issues (escalate to engineer)

**Visual characteristics:**
- Visible sagging or dips in roof line
- Cracked or broken sheathing visible from attic
- Water staining on interior ceilings/walls
- Sagging gutters indicating fascia damage
- These warrant a structural engineer's review, not just a roofer's repair

### Damage Taxonomy in Code

```swift
enum DamageCategory: String, CaseIterable, Codable {
    case hail
    case wind
    case wear
    case granuleLoss
    case bruising
    case exposedMat
    case lifted
    case torn
    case missing
    case flashing
    case algae
    case moss
    case lichen
    case structural

    var displayName: String { ... }
    var coveredByStormClaim: Bool { ... }
    var requiresEngineerReview: Bool { ... }
    var typicalRemediation: String { ... }
}

enum Severity: String, CaseIterable, Codable {
    case minor      // single instance, cosmetic
    case moderate   // multiple instances, functional impact
    case severe     // widespread, immediate replacement needed
}
```

---

## Gemini System Prompt for Damage Detection

This is the system prompt to use in `GeminiAnalysisService.swift`. It's been refined through real testing to balance detection with hallucination prevention.

```
You are a forensic roof inspector trained on HAAG (Haag Engineering) standards.

Analyze the attached roof photograph. Identify the roof covering material and any visible damage. Be conservative — only flag damage you can actually see in the pixels. Empty arrays are correct when nothing is visible.

Return STRICT JSON only (no markdown wrapper), with this exact schema:

{
  "analyzed": true|false,
  "shingle_type": {
    "type": "3-tab asphalt|architectural asphalt|luxury asphalt|wood shake|wood shingle|metal standing seam|metal shingle|clay tile|concrete tile|slate|synthetic slate|composite|rolled roofing|TPO|EPDM|unknown",
    "confidence": 0-100,
    "note": "<short evidence>"
  },
  "findings": [
    {
      "label": "hail_damage|granule_loss|missing_shingles|wind_creasing|blistering|cracking_splitting|flashing_damage|algae_moss|bruising|structural_sagging",
      "detected": true|false,
      "severity": "none|minor|moderate|severe",
      "confidence": 0-100,
      "count": <int>,
      "note": "<short pixel evidence>"
    }
  ],
  "damage_markers": [
    {
      "type": "hail_strike|crack|granule_loss|missing_shingle|wind_crease|blister|flashing|algae|other",
      "x": 0.0-1.0,
      "y": 0.0-1.0,
      "radius": 0.0-1.0,
      "severity": "minor|moderate|severe",
      "confidence": 0-100,
      "note": "<short pixel-level observation>"
    }
  ]
}

Coordinate system: x and y are normalized fractions of the image dimensions where (0,0) is top-left and (1,1) is bottom-right. Radius is normalized to min(width, height).

Include all 10 damage categories in `findings` (set `detected: false` for categories you don't see).

Mark each visible damage instance individually in `damage_markers`. If the image is NOT a roof (grass, sky, indoors, person, vehicle), set `analyzed: false`, return empty `damage_markers`, and add a finding with `label: "no_roof_detected"`.

DAMAGE TYPE DEFINITIONS:
- hail_strike: Round impact spot 1/4" to 2" diameter, with granule loss exposing dark mat, OR visible bruise/depression, OR fracture radiating from impact, OR sharp-edged discoloration distinct from granule pattern. Do NOT confuse with normal granule color variation, shadows, lichen, or weathering stains.
- granule_loss: Bald patches where protective granules have worn or been knocked off, exposing the dark mat. If uniform across the whole slope, mark as wear; if clustered, mark as hail-related.
- missing_shingles: Bare deck or underlayment visible where a shingle should be. Often follows wind events along leading edges.
- wind_creasing: Shingle no longer flat against deck; visible bend or fold; sealant strip broken.
- blistering: Raised bumps in the shingle surface (NOT depressed). Heat-related.
- cracking_splitting: Straight-line cracks in shingles (aging) or radial cracks from a point (impact).
- flashing_damage: Bent, missing, or improperly sealed metal flashing around penetrations or walls.
- algae_moss: Black streaks (algae) or fuzzy green patches (moss).
- bruising: Soft-spot depression in granule mat, often with bull's-eye discoloration.
- structural_sagging: Visible dips or sags in the roof line.

CONFIDENCE SCORING:
- 90-100: damage characteristics are unmistakable and multiple indicators present
- 70-89: clear damage with at least one definitive indicator
- 50-69: probable damage but some ambiguity (lighting, angle, partial view)
- 30-49: possible damage but more evidence needed
- Below 30: do not include this marker — too uncertain

When in doubt, mark fewer. False positives waste inspector time more than missing borderline cases. A confident "no damage detected" is more valuable than a hallucinated list.
```

This goes in `GeminiAnalysisService.swift` as a constant. Append the per-user `LocalLearningEngine.userStylePromptPrefix()` to the start of it once the user has 20+ corrections.

---

## Historical Storm Data Integration

The Map tab should let inspectors see hail and wind storms over the past 2 years, overlaid on a map of their service area.

### Data sources

| Source | Coverage | Cost | Use |
|---|---|---|---|
| **NOAA Storm Events Database** | US, since 1950, official record | Free, keyless | Primary historical hail + wind events |
| **NWS Forecast Office** | US, real-time + recent | Free, keyless | Real-time alerts |
| **HailTrace** | US, near-real-time hail swaths with size estimates | Paid subscription | Higher-resolution hail data when budget allows |
| **OpenMeteo** | Global historical + forecast | Free | Backup weather + wind data |
| **Google Weather** | Global current + forecast | Paid per call | Primary current conditions in app |
| **Weather Underground** | Global historical | API has costs | Fallback historical |

### Implementation

`Services/StormHistoryService.swift`:

```swift
class StormHistoryService {
    /// Fetch all storm events of given kinds within radius of coordinate over a date range.
    /// Combines NOAA + (optionally) HailTrace data with deduplication.
    func events(
        near coordinate: CLLocationCoordinate2D,
        radiusMiles: Double,
        from startDate: Date,
        to endDate: Date,
        kinds: Set<StormKind>
    ) async throws -> [StormEvent]
}
```

### Map overlay implementation

In `MapHubView`:

1. **Storm pin layer** — for each StormEvent, drop a colored MKAnnotationView (orange for hail, blue for wind, purple for tornado). Pin size = severity. Tap → `StormDetailSheet`.

2. **Storm swath overlay** — for each significant event, render an MKPolygon showing the affected area (NOAA provides bounding boxes for severe events; HailTrace provides actual swath polygons). Translucent fill (~20% opacity) in event color.

3. **Date scrubber** — 64pt chips at top: 3 mo / 6 mo / 12 mo / 24 mo. Each chip filters the visible events.

4. **Magnitude filter** — segmented control: All / ≥1" hail / ≥1.5" hail / ≥58mph wind / ≥75mph wind.

5. **Service area boundary overlay** — display the rep's saved ServiceArea ZIPs as a semi-transparent navy overlay so they can see "this storm hit MY area."

6. **Property impact analysis** — for any selected storm, count leads + jobs within 5mi of the storm centroid. Display as "X properties impacted" in the StormDetailSheet.

### Inspection.event auto-fill

When a user creates an inspection at a property:

1. `GeocodingService` resolves address → coordinate
2. `StormHistoryService` queries events within 5mi over the past 365 days
3. Find the closest significant event (≥0.75" hail or ≥58 mph wind) within ±30 days of the inspection date
4. If found, auto-populate `Inspection.event{}` with NOAA event_id, date, size, distance, source
5. Surface in JobDetailView as "Storm Match" card: "Hail event May 15, 2025 — 1.5" hail, 2.3 mi away, confirmed by NOAA"

This is the linchpin for insurance claim defensibility — having a NOAA-verified storm event tied to a damaged property is what makes the claim stick.

---

## Roof Measurement via Google Solar API

You're using the Solar API to measure roofs, NOT to install solar. That's fine — the API returns the geometry data even if you never use the energy-production output.

### Endpoint

```
GET https://solar.googleapis.com/v1/buildingInsights:findClosest
  ?location.latitude=<lat>
  &location.longitude=<lng>
  &requiredQuality=HIGH
  &key=<API_KEY>
```

### Response structure (relevant fields)

```json
{
  "name": "buildings/...",
  "center": { "latitude": ..., "longitude": ... },
  "boundingBox": { ... },
  "imageryDate": { "year": 2024, "month": 8, "day": 15 },
  "imageryQuality": "HIGH",
  "solarPotential": {
    "wholeRoofStats": {
      "areaMeters2": 156.7,        // ← total roof area in m²
      "sunshineQuantiles": [...]
    },
    "roofSegmentStats": [           // ← per-slope!
      {
        "pitchDegrees": 22.5,
        "azimuthDegrees": 180.0,    // south-facing
        "stats": { "areaMeters2": 45.2 },
        "center": { ... },
        "boundingBox": { ... },
        "planeHeightAtCenterMeters": ...
      }
    ]
  }
}
```

### Service implementation

`Services/SolarService.swift`:

```swift
struct RoofMeasurement {
    let totalSquares: Double          // 1 sq = 100 sq ft = 9.29 m²
    let slopes: [SlopeMeasurement]
    let imageryDate: Date
    let imageryQuality: String        // "HIGH" / "MEDIUM" / "LOW"
}

struct SlopeMeasurement {
    let orientation: String           // N / NE / E / ... from azimuth
    let pitchDegrees: Double
    let pitchRatio: String            // "6/12", "4/12", etc.
    let squares: Double
    let center: CLLocationCoordinate2D
    let boundingBoxCorners: [CLLocationCoordinate2D]  // for map overlay
}

class SolarService {
    func measureRoof(at coordinate: CLLocationCoordinate2D) async throws -> RoofMeasurement
}
```

Conversion: `squares = areaMeters2 / 9.290304`

Azimuth → orientation:
- 337.5° to 22.5° → N
- 22.5° to 67.5° → NE
- 67.5° to 112.5° → E
- ... etc. through to NW

Pitch degrees → standard pitch ratio:
- 14° → 3/12
- 18° → 4/12
- 22° → 5/12
- 27° → 6/12
- 30° → 7/12
- 33° → 8/12
- 37° → 9/12
- 40° → 10/12
- 50° → 12/12

### UI integration

**NewJobWizard Step 3 (Roof System):** after the user enters address, automatically call SolarService. Show a "Detected roof" card:

```
┌─────────────────────────────────────┐
│ Detected roof                       │
│                                     │
│  Total: 18.4 squares (1,840 sq ft)  │
│  6 slopes detected                  │
│  Imagery: Aug 2024 (HIGH quality)   │
│                                     │
│  [Use detection]    [Enter manually] │
└─────────────────────────────────────┘
```

**JobDetailView:** show measurements card with color-coded MKPolygon outlines of each slope on a small embedded map. Tap to open MapHubView centered on the property with slopes outlined.

**DecisionEngine:** prefers `detected_area_squares` over manually-entered `area_squares` when available, but NEVER overrides inspector input. Inspector can override detection if they think it's wrong.

### Failure modes

- **Coverage gap:** Solar API only covers buildings in datasets Google has imagery for. ~80% of US single-family homes. Outside that, returns 404 / `NOT_FOUND`. Fall back to manual entry with a friendly empty state: "Aerial measurement not available for this address — enter manually below."
- **Low quality imagery:** if `imageryQuality != HIGH`, show a yellow chip warning "Imagery date: 3 years ago — verify on-site" and the user should re-measure manually for any structural changes since.
- **Old imagery:** if imageryDate > 2 years old, prompt: "Has the roof been modified since {date}? If so, enter measurements manually."

---

## Pitch / Slope Angle Measurement on Device

For when Solar API isn't available OR inspector wants to verify, iPhone can measure roof pitch using the accelerometer.

### Implementation

`Services/PitchGaugeService.swift`:

```swift
import CoreMotion

class PitchGaugeService {
    private let manager = CMMotionManager()

    /// Real-time pitch angle in degrees. Update at 30 Hz.
    /// Inspector holds phone flat against slope surface, screen up.
    func startStreamingPitchDegrees(_ handler: @escaping (Double) -> Void)
    func stopStreaming()
}
```

`PitchGaugeView` (full-screen sheet from SlopeCaptureView "Measure pitch" 56pt button):
- Live large numeric readout (96pt font, navy) of current pitch in degrees
- "X / 12" equivalent displayed below (e.g. 22° → 5/12)
- Bull's-eye level indicator (centered when phone is flat against slope)
- Sticky 88pt "Save pitch" button writes to current slope
- Glove rule: numbers are huge, buttons are huge, no fiddly inputs

---

## ARKit / LiDAR Roof Measurement (iPhone Pro feature)

For iPhone Pro models with LiDAR (12 Pro+), use ARKit to measure roof slopes by walking around them at ground level.

### Implementation

`Services/ARKitRoofMeasureService.swift`:

```swift
import ARKit
import RealityKit

class ARKitRoofMeasureService {
    /// Returns true if device has LiDAR and ARKit is supported.
    static var isAvailable: Bool { ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) }

    /// Starts a measurement session. User taps corners of the roof on AR view.
    func startMeasurement(in arView: ARView) -> AnyPublisher<MeasurementUpdate, Never>
}
```

`ARRoofMeasureView`: full-screen ARKit camera view with crosshair overlay. Inspector taps each corner of a visible slope (3D world coordinates captured), then "Calculate" computes the slope area from the 3-4 tapped points.

Optional / Phase X — not first priority but powerful for properties Solar API doesn't cover.

---

## Photo Quality Scoring

Bad photos = bad AI analysis. Before sending a photo to Gemini, run quality checks and warn the inspector if a recapture is needed.

### Service

`Services/PhotoQualityService.swift`:

```swift
struct PhotoQuality {
    let blurScore: Double         // Laplacian variance; <100 = blurry
    let brightnessScore: Double   // average luminance; should be 60-200
    let damageLikelihood: Double  // % of pixels that match damage texture (separate from AI)
    let isAcceptable: Bool        // composite verdict
    let issues: [String]          // human-readable problems
}

class PhotoQualityService {
    func evaluate(_ image: UIImage) async -> PhotoQuality
}
```

Use `CIFilter.laplacian()` to compute blur, simple histogram for brightness.

In `QuickInspectionView`, after capture but before sending to Gemini:
1. Run PhotoQualityService.evaluate()
2. If `!isAcceptable`, show a sheet: "Photo issues: blurry / too dark / too far / too close" with "Retake" 88pt button + "Use anyway" 64pt button
3. If user picks Retake, return to camera

---

## Voice-Driven Inspection Mode

Hands-free inspection for inspectors who can't easily tap the screen with gloves. Activates via persistent floating mic button.

### Service

`Services/VoiceCommandService.swift`:

```swift
import Speech

enum VoiceCommand {
    case captureSlope(orientation: String)        // "Capture south slope"
    case nextSlope                                 // "Next slope"
    case markHailHit(severity: Severity)           // "Mark hail moderate"
    case markWindLift                              // "Mark wind lift"
    case markWear                                  // "Mark wear"
    case noteVerbatim(String)                      // "Note: shingles brittle on west side"
    case savePhoto                                 // "Save"
    case retake                                    // "Retake"
    case openLastReport                            // "Show me the report"
    // ... more
}

class VoiceCommandService: NSObject, SFSpeechRecognizerDelegate {
    func startListening(_ handler: @escaping (VoiceCommand) -> Void)
    func stopListening()
}
```

Floating mic button (88pt circle, bottom-right of screen, low opacity until tapped) toggles voice mode. Visible icon when listening. Recognized commands trigger same code paths as taps.

Privacy: speech recognition runs on-device when possible (`requiresOnDeviceRecognition = true`), no audio sent to Apple servers.

---

## Insurance Carrier-Specific Report Templates

Different carriers prefer different report formats. Some want HAAG-strict, others want their own template (e.g. Xactimate-compatible exports).

### Approach

`Services/ReportTemplateService.swift`:

```swift
enum CarrierTemplate {
    case haagStandard       // default
    case xactimate          // estimate XML format
    case stateFarmHAAG      // State Farm's modified HAAG
    case allstateExpress    // Allstate's claim format
    case usaaStandard       // USAA's preferred format
    // ... 8+ carrier templates
}

class ReportTemplateService {
    func generatePDF(inspection: Inspection, template: CarrierTemplate) -> Data
    func generateXML(inspection: Inspection, template: CarrierTemplate) -> Data?  // Xactimate
    func generateJSON(inspection: Inspection, template: CarrierTemplate) -> Data?  // future
}
```

Template registry lives in `Templates/` directory, one Swift file per carrier with their preferred sections, order, and formatting.

JobDetailView "Generate Report" CTA opens a sheet with carrier picker (defaults to the carrier on the inspection) and format picker (PDF / Xactimate XML / JSON).

---

## Customer / Homeowner Portal (Phase X)

A separate web app where the homeowner can:
- View their proposal
- Sign it electronically
- See install progress
- Pay deposit / final invoice
- Track warranty start date

Tech stack:
- Next.js + Supabase (same backend as corrections service — share infrastructure)
- Hosted at `roofwise.app/p/<token>` (tokenized one-per-proposal URLs)
- Mobile-responsive (homeowners often open on phone)
- Stripe for deposit/final payment

Not iOS work — separate web project. Spec when ready.

---

## Offline Mode + Sync Queue

Inspectors are often on roofs with bad cellular reception. The app must work offline and sync when reconnected.

### Implementation

1. **All writes go through stores** — `InspectionStore`, `SlopeCaptureView`, etc. write to SwiftData immediately, with `syncStatus: .pending`.
2. **Network monitor** — `NetworkMonitor` (NWPathMonitor wrapper) exposes `isReachable` publisher.
3. **Sync orchestrator** — `SyncOrchestrator` watches network reachability. When reconnected, walks each store's pending queue and flushes to backend (Supabase, corrections endpoint, etc.) in order.
4. **Visible indicator** — DashboardHeader shows a small "Offline" chip when network is down. When syncing, shows progress dot.
5. **All AI calls (Gemini, Solar, Weather) are queued** when offline. AI analysis specifically: photo captured offline → marked as "Pending AI analysis" with offline icon → when reconnected, batch-analyze all pending photos.

---

## Materials Supplier Integration (Phase X)

Inspector finishes inspection → proposes specific materials → can order directly from app.

Integration points:
- **ABC Supply API** — major roofing materials distributor with developer API for pricing + order
- **Beacon Building Products** — similar
- **Home Depot Pro** — public-API for some material lookups

Service `MaterialsSupplierService.swift`:
- Look up real-time pricing for the line items in a Proposal
- Place orders directly (with user confirmation)
- Order tracking + delivery ETAs

Phase X — not first priority. Major value-add for established roofing companies.

---

## Multi-User / Team Support (Phase X)

Eventually, a roofing company has multiple inspectors. Each has their own AuthStore session + correction profile, but they share:
- Customer/lead/job database
- Service areas
- Pricing tables
- Storm alerts
- Manager dashboard

Implementation:
- `Organization` model in Supabase (id, name, owner_user_id)
- `OrganizationMember` model (org_id, user_id, role: owner/manager/inspector)
- All Inspections / Customers / Leads keyed by `organization_id` AND `created_by_user_id`
- RLS policies in Supabase ensure users only see their org's data
- Manager dashboard (web, separate project) shows team performance + assignment

Phase X — only matters for ≥2 inspectors. Single-inspector users don't need this.

---

## Subscription / Billing (Phase X)

Eventual monetization. Tiers like:
- **Free** — 10 inspections/month, watermarked PDFs
- **Pro** — unlimited inspections, no watermark, $49/mo
- **Team** — multi-user, manager dashboard, $99/inspector/mo
- **Enterprise** — custom pricing, custom report templates, API access

Implementation: RevenueCat SDK for App Store-compliant in-app purchases. Server-side validation via Supabase + webhooks.

Phase X — figure out product-market fit first, then monetize.

---

## Drone / Aerial Imagery Integration (Phase X)

Some inspectors use drones for steep or unsafe roofs. App should accept drone-captured images and run analysis on them.

Implementation:
- Photo import from Files app or Photos library (in addition to live camera)
- DJI SDK integration for direct import from DJI drones
- Mark photos as "aerial source" in metadata so reports note it
- Higher-resolution analysis profile for drone photos

Phase X.

---

## Comparable Damage Assessment

Inspector wants to know "have other inspectors in my area found similar damage from this storm?" Helps build claim narrative.

### Backend service

Aggregates anonymized Correction + Inspection data across all users:
- "147 inspections completed in this ZIP in the last 30 days"
- "73% of inspections in this ZIP from the May 15 storm event found qualifying hail damage on the south slope"
- "Average damage score: 78 (your job: 82)"

Shows on JobDetailView as a "Comparable Inspections" card with privacy-preserving aggregated stats.

Requires the corrections backend (Phase 10) to be live AND have data volume. Phase X.

---

## Safety + OSHA Checklists

Roofing is dangerous. App can include pre-roof checklists.

### Features

Pre-inspection sheet (one-time on iPhone first launch + before each inspection):
- "Safety harness on" (toggle)
- "Roof access secured" (toggle)
- "Conditions safe" (toggle — no wet/icy/slippery)
- "Cellular reception confirmed" (auto-checked)
- "Notified office of location" (toggle)
- "Emergency contact accessible" (toggle)

Sticky bottom 88pt "I'm safe to climb" button only enabled when all toggles checked.

Optional but valuable for liability. Add as a setting toggle to enable/disable for users who don't want it.

---

## Pre-Inspection Property Lookup

Before the inspector arrives, they should know about the property.

### Sources

| Data | Source | Cost |
|---|---|---|
| Tax/assessor records (roof age, sq ft, build year) | County records (free, varies by county) or RentCast API | Free / paid |
| Permit history | County permit records | Free, varies |
| Previous insurance claims (this property) | Public records or paid services | Paid |
| Recent comparable storms in area | NOAA (already integrated) | Free |
| Recent comparable jobs (your customers) | Your own database | Free |
| Property photos (historical Street View) | Google Street View Static API | Per-call |
| Recent sale price + condition | Zillow / Redfin / public records | Varies |

`PrePropertyView`: opens when user enters an address in NewJobWizard or CostEstimator. Shows whatever data is available with sources cited.

Phase X — high effort, high value. Probably build after Phase 9.

---

## Job Crew Assignment + Install Tracking (Phase X)

After proposal is signed, the inspection becomes a Job with an install timeline.

### Features

- `Job` model — bridges Inspection + Proposal + install crew + status
- Crew assignment (pick from team members)
- Install date scheduling
- Material delivery tracking
- Daily install photos
- Install completion + final inspection
- Warranty start date set
- Customer satisfaction survey

Requires multi-user support (Phase X). Single-inspector users don't need crew assignment.

---

## Real-time Storm Alerts via Push (already in Phase 6)

Already covered in Phase 6C. Adding here for emphasis: this is a **product moat.** Inspectors who get a "Severe hail just hit Plano! 4 of your past customers in affected zone — open Door Knocking Mode" push notification at 3pm have a massive competitive edge over inspectors who learn about the storm tomorrow.

---

## AI Coaching During Inspection (Phase X)

While the inspector is capturing photos, the AI can give real-time feedback:

- "Move closer — distance too far for hail-strike detection"
- "Photo blurry — hold steadier"
- "Photo too dark — find better lighting"
- "Good photo — analyzed. 3 hail strikes detected. Move to next slope?"
- "Make sure to get a wide shot of this slope before close-ups"

Implementation: low-frequency real-time analysis via Gemini (every 3 seconds of live preview, downsampled) returns coaching tips overlaid on camera view.

Phase X — costs API calls but transformative UX. Optional toggle in settings.

---

## Property History Map Layer

In MapHubView, beyond storms + leads + jobs + knocks, add a "History" filter chip showing every property previously inspected by you (or your org) with a small chip showing the inspection date.

Tap a history pin → opens that Inspection's JobDetailView. Useful for "Did I inspect this house in 2023? What did I find?"

Already accessible via Leads/Jobs lists but the map view makes geographic patterns visible.

---

## Compass + Pitch Overlay on Camera

When capturing photos, overlay on the live camera view:
- **Compass direction** — small north arrow + degree readout in top-left
- **Pitch indicator** — bull's-eye level showing current phone tilt
- **Slope direction prompt** — based on selected slope (N, S, E, W, etc.), arrow pointing where to face

Helps inspector ensure each slope is captured from the correct orientation, and ensures photo metadata includes accurate slope identification.

---

## Building Permit + Code Lookup (Phase X)

Some jurisdictions require permits for roof work over a certain dollar amount. Some require specific code compliance (impact-resistant shingles in hail zones, fire-rated underlayment in wildfire zones, etc.).

Integration:
- City / county permit databases (varies wildly)
- Building code lookups by ZIP
- "This jurisdiction requires Class 4 impact-resistant shingles for storm-damage replacements" — surface in proposal

Phase X — high research effort. Worth it for compliance-focused regions.

---

## Aerial Measurement Competitor Comparison

EagleView and Hover dominate aerial roof measurement. Our Solar API approach is "good enough for free." But for serious estimates, inspectors sometimes want EagleView precision.

### Optional integrations

- **EagleView API** — paid, returns highly-precise PDF reports with measurements. Service `EagleViewService.swift`. Add as optional paid feature for inspectors who want it.
- **Hover API** — similar.

JobDetailView "Order EagleView report" CTA — costs ~$15-20 per report — surfaces precise measurements that overwrite Solar API estimates if accepted.

Phase X — opt-in paid feature.

---

# REVISED BUILD ORDER (with all features)

If you're starting completely fresh with the full feature set:

**Tier 1 — Core (must-have to ship MVP):**
1. Theme + APIKeys + Inspection model
2. Phase 2A (Wizard) + Phase 1 (Home)
3. Phase 2B (Camera + Gemini + DecisionEngine + HAAG thresholds)
4. Phase 3 (Haag PDF + signatures)
5. Phase 4A-E (Map + Weather + NOAA + Solar + Cost Estimator)
6. Phase 5B (Activity feed)
7. Glove rule audit
8. Auth bypass flag wired in from day one

**Tier 2 — Differentiation (build for v1 launch):**
9. Phase 5C + 6A-E (Training Queue + Service Area + Storm Watch + Push + Door Knocking)
10. Phase 7 (Proposals)
11. Pitch Gauge (CMMotion)
12. Photo Quality scoring
13. Comprehensive damage taxonomy in Gemini prompt

**Tier 3 — Moat (build for v1.x):**
14. Phase 8 + 9 (Structured confidence + Recursive learning)
15. Phase 10 (Corrections backend in separate project)
16. Voice command service
17. Offline mode + sync queue
18. Insurance carrier-specific templates

**Tier 4 — Scale (build when revenue justifies):**
19. Multi-user / team support
20. Customer/homeowner portal
21. Subscription billing
22. Materials supplier integration
23. ARKit LiDAR measurement
24. Drone integration
25. Pre-property lookup
26. Building permit + code lookup
27. AI coaching during inspection
28. EagleView/Hover integration

---

## Final reminder for Claude Code

The user is a roofer in gloves on a hot roof. Every architectural decision, every UI choice, every default behavior should optimize for that user's success. When choosing between a clever feature and a glove-friendly one, pick glove-friendly. When choosing between a beautiful UI and a high-contrast outdoor-readable one, pick high-contrast. When choosing between elegant code and a working feature, ship the working feature first and refactor later.

Build in tiers. Ship MVP first. Add moat features after MVP is in inspector hands and generating real data. Don't build Tier 4 features before Tier 1 is rock-solid.

Good luck.

---

# PRODUCT POSITIONING (from the pitch deck)

This is what the company is, in the founder's own words. Internalize this — every UI decision, every prompt, every microcopy choice should reinforce it.

## The one-line pitch

> **RoofWise is the objective layer between roofing contractors and insurance carriers.**

## The thesis (the load-bearing insight)

> **The AI isn't the product. The AI is the moat that protects the product: objective, Haag-protocol-compliant evidence that insurance carriers accept.**

Most AI-for-roofing startups pitch damage detection. That's commoditized — EagleView, Hover, Loveland all do some version. RoofWise's product is *evidence the insurance industry accepts*. The only universally accepted evidence standard is the Haag protocol. RoofWise is the first and only company automating it.

## The problem

- $2-3B in roof insurance claims get denied every year — not because damage isn't there, but because contractors can't prove it
- A traditional Haag-compliant inspection: 6-8 hours, manual photos, handwritten notes, manually counted hail hits
- 40% of the time the adjuster disagrees → claim denied or underpaid → contractor eats $5K-$20K
- 50% of denied claims could be reversed with better evidence
- 106,000 US contractors × this pain = an industry hemorrhaging cash on broken documentation

## The solution (what the app does in one paragraph)

> **6-8 hours collapsed to 10-15 minutes.** Contractor opens RoofWise, holds the iPhone to the roof. AR overlay guides them through 4 angled photos in 10×10 foot test squares (the same methodology Haag-certified inspectors use). AI runs in real-time, detects every hail strike, bruise, and granule-loss spot at the shingle level. Contractor reviews each detection — swipe right to accept, left to reject, up to correct (Tinder pattern, works with gloves in bright sun). Five minutes later, cloud generates a Haag-protocol-compliant PDF: slope-by-slope analysis, damage counts, material classification, weather validation. Everything insurance carriers actually require.

## The wedge (why contractors pay)

> A single denied claim costs the contractor $5K-$20K. A single approved claim is worth $10K-$50K. RoofWise costs $79-$299/month. **Pays for itself with ONE additional approval per month — 33-300x ROI.**

## The data flywheel (what makes the moat)

1. Every contractor inspection generates corrections
2. AI Insights Training Queue surfaces inspections needing forensic review
3. Geographic clustering auto-identifies leads near recent hail events (e.g., "3 leads within 2mi of Apr 18 hail core")
4. Confidence-graded review — detections under threshold automatically queued for expert correction
5. Trust-weighted feedback — Haag-certified inspectors weighted higher in retraining cycles
6. Weekly automated retraining — accuracy compounds with every inspection
7. After 50,000 inspections — defensible moat competitors cannot replicate

This is the recursive learning loop. It MUST be implemented exactly this way. It's the actual moat.

## The vision (where this ends up)

> **In 5 years, RoofWise is the standard.** Every major insurance carrier requires RoofWise reports for roof claims. Every roofing contractor in North America uses our platform. Our damage taxonomy = the industry-wide accepted standard. Strategic acquisition target for Verisk, AccuLynx, or major carrier (reference: the blocked AccuLynx-Verisk deal at $2.35B tells you exactly what this category is worth).

---

# INSURANCE CARRIERS (the 8 core + tier-1 insurtechs)

The app needs to know these carriers cold — for selection in the NewJobWizard insurance step, for proposal/report templating, and for go-to-market.

## Tier 1 — Top US Property Carriers (must support)

These 8 are the must-have list in the NewJobWizard Step 2 carrier grid. All have heavy roof claim volume.

| Carrier | Notes |
|---|---|
| **State Farm** | Largest US property insurer. Strict on documentation. HAAG-friendly. |
| **Allstate** | Second largest. Uses Xactimate. "Allstate Express" claims format. |
| **USAA** | Military-focused. Smaller volume but high-touch claims. |
| **Liberty Mutual** | Major P&C player. Standard HAAG acceptance. |
| **Farmers Insurance** | Network of agents. Variable on tech adoption. |
| **Travelers** | Strong commercial + residential. Detailed adjuster reports. |
| **Nationwide** | Mid-to-large carrier. HAAG-friendly. |
| **Erie Insurance** | Regional dominance in Mid-Atlantic. |

## Tier 2 — Tier-1 Insurtechs (for early carrier pilots — go-to-market path)

These are the carriers to target FIRST for API integration, per the pitch deck Slide 11 GTM strategy. They have faster sales cycles (60-90 days vs 12 months for the majors).

| Carrier | Notes |
|---|---|
| **Hippo** | Smart-home / IoT-focused insurtech. Open to API integrations. |
| **Lemonade** | AI-native insurer. Highly receptive to data integrations. |
| **Kin Insurance** | Direct-to-consumer property insurtech. Hurricane-prone state focus. |
| **Branch Insurance** | Newer insurtech with bundle focus. |
| **Openly** | Premium homeowners insurtech via independent agents. |

## Tier 3 — Regional & Specialty (good for hail-belt focus)

These matter heavily in the **hail belt** (TX, CO, OK, KS, NE) where RoofWise's beachhead is.

| Carrier | Region |
|---|---|
| **Texas Farm Bureau** | TX (large hail-claim volume) |
| **Oklahoma Farm Bureau** | OK |
| **Kansas Farm Bureau** | KS |
| **Mercury Insurance** | CA, TX, others |
| **AAA / Auto Club Insurance** | Multi-region member-based |
| **American Family** | Midwest focus |

## Implementation

`Models/InsuranceCarrier.swift`:

```swift
enum InsuranceCarrier: String, CaseIterable, Codable {
    case stateFarm = "State Farm"
    case allstate = "Allstate"
    case usaa = "USAA"
    case libertyMutual = "Liberty Mutual"
    case farmers = "Farmers Insurance"
    case travelers = "Travelers"
    case nationwide = "Nationwide"
    case erie = "Erie Insurance"
    // Insurtechs
    case hippo = "Hippo"
    case lemonade = "Lemonade"
    case kin = "Kin"
    case branch = "Branch"
    case openly = "Openly"
    // Regional
    case texasFarmBureau = "Texas Farm Bureau"
    case oklahomaFarmBureau = "Oklahoma Farm Bureau"
    case kansasFarmBureau = "Kansas Farm Bureau"
    case mercury = "Mercury"
    case aaa = "AAA Auto Club"
    case americanFamily = "American Family"
    case other = "Other"

    var tier: CarrierTier { ... }
    var reportTemplate: ReportTemplate { ... }
    var typicalClaimCycleDays: Int { ... }
    var requiresHaagCompliance: Bool { ... }
}
```

`NewJobWizard Step 2` carrier grid: 4-wide grid of 80pt carrier tiles, each showing the carrier logo (or initials if no logo available) and name. Tier 1 carriers at top, then Insurtechs, then Regional. "Other" as a free-text fallback at the bottom.

---

# THE 13-CATEGORY AI DAMAGE TAXONOMY

The pitch deck specifically names "13-category AI Findings." This is the exact set the Gemini prompt must use. These are the categories the AI Damage Map renders and that the Haag report tabulates.

| # | Category | What it indicates |
|---|---|---|
| 1 | **Hail Hits** | Round impact spots with granule loss, the primary covered damage type |
| 2 | **Bruising** | Soft-spot depression in granule mat (often paired with hail hits) |
| 3 | **Granule Loss** | Bald patches exposing the dark asphalt mat |
| 4 | **Wind Damage** | General wind-related damage category |
| 5 | **Wind Creasing** | Visible bend or fold in shingle from wind lift |
| 6 | **Blistering** | Raised bumps in shingle surface (heat-related, not storm) |
| 7 | **Cracking** | Straight-line or radial cracks in shingles |
| 8 | **Flashing Damage** | Bent/missing/improperly-sealed metal flashing |
| 9 | **Algae/Moss** | Black streaks (algae), green patches (moss), grey crust (lichen) |
| 10 | **Missing Shingles** | Bare deck/underlayment where shingles should be |
| 11 | **Splitting** | Lengthwise splits in shingles (often aging) |
| 12 | **Lifted Shingles** | Sealant strip failure, shingle no longer flat |
| 13 | **Structural Sagging** | Visible dips in roof line — escalate to engineer |

Per-photo metadata captured automatically:
- **Pitch** (e.g., 65°) — via CMMotion pitch gauge
- **Elevation** (e.g., 295 ft) — via CoreLocation altitude
- **Shingle count** (e.g., ~30) — AI counts visible shingles for test-square density verification
- **Test square methodology** indicator — 10×10 ft area identified, hits-per-test-square computed

Per-finding output: severity classification (**None / Minor / Moderate / Severe**) and confidence score (0-100).

---

# LIVE AR DAMAGE DETECTION (the killer demo feature)

This is the single most important UX feature in the app — the one investors point at and contractors get excited about. It's referenced in pitch deck Slide 4: *"AR overlay guides them through 4 angled photos in 10×10 foot test squares ... AI runs in real-time. Detects every hail strike, every bruise, every granule loss, at the shingle level. Pixel-precise."*

## What it does

Inspector opens the camera. Live video preview shows their iPhone's view of the roof. Overlaid on the live preview:

1. **Test square outline** — a 10×10 ft semi-transparent box that aligns to the roof surface using ARKit world tracking. Inspector positions phone so the box overlays the area they want to inspect.

2. **Real-time damage markers** — colored dots / circles render directly on the live preview wherever the AI is currently detecting damage. Updates 2-3x per second. Different colors per category (orange for hail, blue for wind, green for granule loss, etc.).

3. **Slope orientation indicator** — small compass arrow + N/S/E/W label in corner of preview, derived from device heading + ARKit. Tells inspector which slope they're currently looking at.

4. **Pitch / angle indicator** — bullseye level showing the current device tilt relative to the slope. Helps inspector get a "head-on" photo of each slope (best angle for AI accuracy).

5. **Confidence meter** — small bar at the bottom of preview showing the AI's current confidence in detections (green ≥0.7, yellow 0.4-0.7, red <0.4). When confidence is low, prompt: "Move closer" / "Better lighting needed" / "Get directly above slope."

6. **Photo-quality indicator** — real-time blur + brightness scoring. Camera button is disabled and grayed if quality is too poor for analysis.

7. **Capture button** — large 88pt orange shutter button in the bottom thumb zone. Tap captures the current frame + the live AI's findings. Pre-analyzed at point of capture (no waiting for cloud).

## Technical implementation

### ARKit + Vision pipeline

```swift
class LiveAnalysisCameraView: UIViewControllerRepresentable {
    func makeUIViewController(...) -> ARViewController { ... }
}

class ARViewController: UIViewController, ARSessionDelegate {
    private var arView: ARView!
    private var analysisOverlayLayer: CAShapeLayer!
    private var lastAnalysisTime: TimeInterval = 0
    private let analysisIntervalSec: TimeInterval = 0.5  // 2 Hz live analysis

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        // 1. Capture current camera frame (downsampled to 640px for speed)
        let pixelBuffer = frame.capturedImage
        let image = downsample(pixelBuffer, to: 640)

        // 2. Throttle to 2 Hz
        let now = CACurrentMediaTime()
        guard now - lastAnalysisTime >= analysisIntervalSec else { return }
        lastAnalysisTime = now

        // 3. Call Gemini Vision (background queue, async)
        Task {
            let result = try await GeminiAnalysisService.shared.analyzeLive(image)
            await MainActor.run {
                renderMarkers(result.markers, in: arView)
            }
        }

        // 4. Update test square overlay using ARKit raycasting
        renderTestSquareOverlay(frame: frame)
    }
}
```

### Test square AR placement

Use ARKit raycasting to project a 10×10 ft square onto the detected roof plane:

```swift
func placeTestSquare(in arView: ARView, frame: ARFrame) {
    let centerOfScreen = CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)
    guard let raycast = arView.makeRaycastQuery(from: centerOfScreen, allowing: .estimatedPlane, alignment: .any) else { return }

    let results = arView.session.raycast(raycast)
    guard let hit = results.first else { return }

    // Place a 10x10 ft (3.048m x 3.048m) plane at the hit location
    let testSquareMesh = MeshResource.generatePlane(width: 3.048, depth: 3.048)
    let testSquareMaterial = SimpleMaterial(color: .orange.withAlphaComponent(0.15), isMetallic: false)
    let testSquareEntity = ModelEntity(mesh: testSquareMesh, materials: [testSquareMaterial])

    let anchor = AnchorEntity(world: hit.worldTransform)
    anchor.addChild(testSquareEntity)
    arView.scene.addAnchor(anchor)
}
```

### Live damage marker overlay

For each marker from the latest analysis, render a colored circle at the marker's normalized (x, y) coordinates projected onto the camera preview:

```swift
func renderMarkers(_ markers: [DamageMarker], in arView: ARView) {
    analysisOverlayLayer.sublayers?.removeAll()

    for marker in markers {
        let pixelX = arView.bounds.width * CGFloat(marker.x)
        let pixelY = arView.bounds.height * CGFloat(marker.y)
        let radius = arView.bounds.width * CGFloat(marker.radius)

        let circle = CAShapeLayer()
        circle.path = UIBezierPath(arcCenter: CGPoint(x: pixelX, y: pixelY),
                                    radius: radius,
                                    startAngle: 0,
                                    endAngle: .pi * 2,
                                    clockwise: true).cgPath
        circle.strokeColor = color(for: marker.category).cgColor
        circle.fillColor = color(for: marker.category).withAlphaComponent(0.2).cgColor
        circle.lineWidth = 2

        // Animation: pulse on first appearance
        let pulse = CABasicAnimation(keyPath: "transform.scale")
        pulse.fromValue = 0.5
        pulse.toValue = 1.0
        pulse.duration = 0.3
        pulse.timingFunction = CAMediaTimingFunction(name: .easeOut)
        circle.add(pulse, forKey: "pulse")

        analysisOverlayLayer.addSublayer(circle)
    }
}
```

### Performance budget

- Live analysis runs at 2 Hz (every 500ms), not full camera framerate
- Downsample to 640px before sending to Gemini (smaller payload = faster response)
- Marker render < 5ms on main thread (no JS-style allocations)
- Test square anchor uses `.estimatedPlane` (cheaper than `.existingPlaneGeometry`)
- Gemini Vision API average latency: ~400-600ms — we get a fresh analysis every ~1 second in practice

### Fallback when ARKit not available

iPhones without LiDAR don't get the test square overlay (no plane detection), but live damage markers still render over a regular AVFoundation camera preview. Surface a small "AR mode unavailable on this device — using standard camera" pill.

---

# DEVICE MOTION & SENSORS — Accelerometer, Gyroscope, Compass, Altimeter

The iPhone is a precision sensor platform. RoofWise should use every relevant sensor to capture data automatically rather than asking the inspector to enter it. This eliminates manual data entry friction (huge with gloves) and produces richer, more defensible inspection records.

## Sensors used and what they enable

| Sensor | Used for |
|---|---|
| **Accelerometer** | Slope pitch measurement, bullseye level indicator on camera, fall detection (safety), shake-to-undo gestures, "on roof vs walking" activity classification |
| **Gyroscope** | Camera orientation tracking (so AR overlays stay locked to the world even when phone rotates), enhanced pitch precision when combined with accelerometer |
| **Magnetometer (Compass)** | Slope orientation (N/S/E/W) auto-detection, compass arrow overlay on camera, NewJobWizard auto-populates which slope the inspector is currently facing |
| **Barometric Altimeter** | Roof elevation in feet (per-photo metadata), distinguishes ground-level shots from on-roof shots, validates that the inspector was actually on the roof during inspection |
| **GPS** | Property location, knock-pin placement, storm-event proximity matching, geographic clustering in Training Queue |
| **Pedometer / Activity** | Door-knocking step count + route distance, "on-roof vs walking" detection for context-aware UI |
| **Ambient Light Sensor** | Auto-adjust screen brightness for outdoor visibility, gate photo capture when too dark for AI accuracy |
| **Proximity Sensor** | Detect when phone is held to face (voice command mode) vs held to roof (capture mode) |
| **Face ID / Touch ID** | Optional auth biometric (when `requireAuth = true`) |

## Service architecture

`Services/DeviceMotionService.swift`:

```swift
import CoreMotion
import CoreLocation

@Observable
class DeviceMotionService: NSObject, CLLocationManagerDelegate {
    static let shared = DeviceMotionService()

    private let motionManager = CMMotionManager()
    private let altimeter = CMAltimeter()
    private let pedometer = CMPedometer()
    private let locationManager = CLLocationManager()

    // Published state (drives UI in real time)
    var currentPitchDegrees: Double = 0     // 0° = phone flat, 90° = vertical
    var currentRollDegrees: Double = 0      // tilt left/right
    var currentYawDegrees: Double = 0       // compass heading 0-360
    var currentAltitudeFeet: Double = 0     // sea level + relative
    var currentRelativeAltitudeFeet: Double = 0  // change since session start
    var currentCoordinate: CLLocationCoordinate2D?
    var currentHorizontalAccuracyMeters: Double = 0
    var inspectorActivity: InspectorActivity = .unknown  // walking | onRoof | stationary | inVehicle
    var pedometerStepsThisSession: Int = 0
    var pedometerDistanceMeters: Double = 0

    // Start streaming sensor data (call when entering camera or door-knocking)
    func startStreaming() {
        startDeviceMotion()
        startAltimeter()
        startLocation()
        startActivityTracking()
        startPedometer()
    }

    // Stop streaming (call on exit to save battery)
    func stopStreaming() {
        motionManager.stopDeviceMotionUpdates()
        altimeter.stopRelativeAltitudeUpdates()
        pedometer.stopUpdates()
        locationManager.stopUpdatingLocation()
    }

    private func startDeviceMotion() {
        guard motionManager.isDeviceMotionAvailable else { return }
        motionManager.deviceMotionUpdateInterval = 1.0 / 30.0  // 30 Hz
        motionManager.startDeviceMotionUpdates(using: .xMagneticNorthZVertical, to: .main) { [weak self] motion, _ in
            guard let self, let motion else { return }
            // Convert quaternion to Euler angles (degrees)
            let attitude = motion.attitude
            self.currentPitchDegrees = abs(attitude.pitch * 180 / .pi)
            self.currentRollDegrees = attitude.roll * 180 / .pi
            self.currentYawDegrees = (attitude.yaw * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
        }
    }

    private func startAltimeter() {
        guard CMAltimeter.isRelativeAltitudeAvailable() else { return }
        altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
            guard let self, let data else { return }
            // CMAltimeter returns meters; convert to feet
            self.currentRelativeAltitudeFeet = data.relativeAltitude.doubleValue * 3.28084
        }
    }

    // ... etc for location, activity, pedometer
}

enum InspectorActivity {
    case unknown
    case stationary
    case walking
    case onRoof          // detected via altitude change + sustained position
    case inVehicle
}
```

## Specific feature wiring

### 1. Pitch Gauge view (slope angle measurement)

Already in spec. Reads `DeviceMotionService.shared.currentPitchDegrees`. Big numeric readout (96pt navy), bullseye level, "X / 12" pitch ratio conversion, sticky 88pt Save.

### 2. Live bullseye level on camera preview

In `LiveAnalysisCameraView`, overlay a small bullseye target in the upper-right corner that visualizes current device tilt:
- Dot moves around within a circle as device rolls/pitches
- Centered + green when device is at correct angle for the current slope
- Pulses red when device is way off-angle
- Helps inspector hold phone "head-on" to the slope for best AI accuracy

```swift
struct BullseyeLevel: View {
    @Bindable var motion = DeviceMotionService.shared
    var targetPitch: Double  // expected pitch for current slope

    var body: some View {
        ZStack {
            Circle().stroke(Theme.cream.opacity(0.6), lineWidth: 2).frame(width: 60, height: 60)
            Circle().stroke(Theme.cream.opacity(0.3), lineWidth: 1).frame(width: 40, height: 40)
            Circle().stroke(Theme.cream.opacity(0.3), lineWidth: 1).frame(width: 20, height: 20)
            Circle().fill(dotColor).frame(width: 12, height: 12)
                .offset(x: rollOffset, y: pitchOffset)
                .animation(MotionToken.quick, value: motion.currentPitchDegrees)
        }
    }

    private var rollOffset: CGFloat { CGFloat(motion.currentRollDegrees) * 0.5 }
    private var pitchOffset: CGFloat { CGFloat(motion.currentPitchDegrees - targetPitch) * 0.5 }
    private var dotColor: Color {
        let delta = abs(motion.currentPitchDegrees - targetPitch)
        if delta < 5 { return Theme.green }
        if delta < 15 { return Theme.cream }
        return Theme.orange
    }
}
```

### 3. Auto-populated slope orientation from compass heading

In `QuickInspectionView`, when the inspector aims their phone at a slope and taps capture, automatically populate the slope orientation by reading `DeviceMotionService.shared.currentYawDegrees`:

```swift
extension Double {  // yawDegrees
    var slopeOrientation: SlopeOrientation {
        switch self {
        case 337.5...360, 0..<22.5: return .north
        case 22.5..<67.5: return .northeast
        case 67.5..<112.5: return .east
        case 112.5..<157.5: return .southeast
        case 157.5..<202.5: return .south
        case 202.5..<247.5: return .southwest
        case 247.5..<292.5: return .west
        case 292.5..<337.5: return .northwest
        default: return .unknown
        }
    }
}
```

The orientation is captured automatically per photo. Inspector can override via chip selector if compass got confused (e.g., near metal).

### 4. Per-photo metadata auto-capture

Every photo captured in `QuickInspectionView` gets these fields stamped automatically:

```swift
struct PhotoMetadata: Codable {
    var capturedAt: Date
    var pitchDegrees: Double         // device tilt = slope pitch when phone is held flat against slope
    var pitchRatio: String           // "5/12", "6/12" etc.
    var compassHeading: Double       // yaw degrees
    var slopeOrientation: SlopeOrientation
    var altitudeFeetAGL: Double      // height above ground level (from altimeter relative reading)
    var coordinate: CLLocationCoordinate2D?
    var horizontalAccuracyMeters: Double
    var deviceModel: String
    var inspectorActivity: InspectorActivity
    var ambientLightLux: Double?     // from ambient light sensor (if available)
}
```

This metadata flows into the Haag report as documentation: "Photo captured at 65° pitch, 295 ft AGL, facing S, GPS accuracy ±3m." Defensible documentation that holds up against insurance adjuster challenges.

### 5. Activity detection — context-aware UI

`CMMotionActivityManager` classifies what the inspector is doing:
- **Walking** — probably on the ground between properties. Show route map + door-knocking CTA.
- **Stationary on roof** (detected via altitude + low motion) — show inspection capture UI primed.
- **In vehicle** — disable photo capture, surface "Drive Mode" with large-text upcoming-job card.
- **Climbing** — detect via vertical acceleration patterns; surface safety checklist.

```swift
private func startActivityTracking() {
    guard CMMotionActivityManager.isActivityAvailable() else { return }
    let manager = CMMotionActivityManager()
    manager.startActivityUpdates(to: .main) { [weak self] activity in
        guard let self, let activity else { return }
        if activity.automotive { self.inspectorActivity = .inVehicle }
        else if activity.walking || activity.running { self.inspectorActivity = .walking }
        else if activity.stationary && self.currentRelativeAltitudeFeet > 5 { self.inspectorActivity = .onRoof }
        else if activity.stationary { self.inspectorActivity = .stationary }
        else { self.inspectorActivity = .unknown }
    }
}
```

### 6. Door-knocking route — pedometer + GPS

In `DoorKnockingModeView`, use `CMPedometer` for step count and `CLLocationManager` for distance walked. Display live in the top route-stats bar:
- "47 knocks · 38% interested · 2.3 mi · 1h 12m walked"

The pedometer is more battery-efficient and accurate at low speeds than GPS alone.

### 7. Shake-to-undo gesture

On any data-entry screen (NewJobWizard, SlopeCaptureView, OverlayEditorView), a vigorous shake (high acceleration spike) triggers an undo for the last entry. Standard iOS pattern — UIDevice posts a `motionShake` event.

```swift
.onShake {
    if let lastAction = undoStack.popLast() {
        lastAction.revert()
        // Haptic feedback
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
}
```

Useful when gloves cause an accidental tap that selects the wrong chip — shake to undo.

### 8. Fall detection (safety feature)

`CMMotionManager` can detect freefall (acceleration ≈ 0g for >100ms followed by sudden impact). When detected during an inspection session:
- App pops a "Are you OK?" alert with 30-second countdown
- If no response, automatically calls the inspector's pre-configured emergency contact (set in Settings)
- Logs the fall location + timestamp to the inspector's employer dashboard (if multi-user)

This is critical safety functionality for solo inspectors on roofs.

### 9. Ambient light sensor — auto screen brightness

In outdoor sun, the screen needs maximum brightness for visibility. `UIScreen.main.brightness` can be programmatically raised, but iOS's auto-brightness usually handles this. The light sensor reading can also gate photo capture:
- If `ambientLightLux < 100` (dusk / interior) → warn "Too dark for accurate AI detection — find better lighting"
- If `ambientLightLux > 50000` (direct sun on screen) → boost screen brightness to max + show a sun-shield reminder

### 10. Battery & thermal awareness

`ProcessInfo.processInfo.thermalState` and `Device.batteryLevel` should be monitored. If:
- Battery < 20% → disable live AR analysis to conserve (still allow capture, just no live overlay)
- Thermal state = `.serious` or `.critical` → throttle live analysis frequency, surface "Phone running hot — using lower-power mode"

Inspectors on long days need their phone to last all 8 hours.

## Info.plist additions for sensors

```
NSMotionUsageDescription — "RoofWise uses motion sensors to measure roof pitch, detect slope orientation, and ensure safe inspections."
```

(GPS, camera, microphone, speech recognition already covered in earlier section.)

## Battery-conscious sensor usage

- Sensors run only when needed (start on view appear, stop on view disappear)
- Pedometer + activity detection can run continuously at low cost (system-level optimized)
- Accelerometer/gyroscope at 30 Hz costs ~3% battery/hour — fine
- GPS at high accuracy is the most expensive; use `kCLLocationAccuracyBest` only during knock logging, drop to `kCLLocationAccuracyHundredMeters` for ambient tracking

---

# ANIMATION + MOTION DESIGN SPEC

The app should feel **alive**. Heavy animation, springy physics, satisfying micro-interactions. Every meaningful state change has motion.

## Core motion principles

1. **Spring physics, not linear.** Use SwiftUI `.spring(response:dampingFraction:blendDuration:)` modifiers. Springs feel natural. Linear curves feel robotic.
2. **Hierarchy through motion.** Foreground elements move faster and farther than background elements (parallax). A modal sliding up should be faster than the card stack settling behind it.
3. **Anticipation + follow-through.** Disney animation principles. A button about to be tapped slightly pre-compresses. A card being dismissed slightly overshoots in the direction of motion.
4. **Coordinated motion.** When multiple elements animate together (a card opening into a detail view), they share timing. SwiftUI `matchedGeometryEffect` is your friend.
5. **Respect user motion preferences.** Honor `accessibilityReduceMotion` — fall back to crossfades for motion-sensitive users.

## Motion tokens (define once, use everywhere)

```swift
enum MotionToken {
    // Standard easing curves
    static let quick = Animation.spring(response: 0.25, dampingFraction: 0.85, blendDuration: 0)
    static let standard = Animation.spring(response: 0.4, dampingFraction: 0.8, blendDuration: 0)
    static let gentle = Animation.spring(response: 0.6, dampingFraction: 0.85, blendDuration: 0)
    static let bouncy = Animation.spring(response: 0.5, dampingFraction: 0.65, blendDuration: 0)

    // Linear (sparingly — only for continuous animations like rotation)
    static let linear = Animation.linear(duration: 0.2)

    // Stagger delay for sequential element appearance
    static let staggerDelay: Double = 0.06
}
```

Every `withAnimation` call uses a token: `withAnimation(MotionToken.standard) { ... }`. Never inline `Animation.spring(...)` literals.

## Specific animation specs by screen

### App launch
- **Splash → Dashboard:** Logo scales from 0.8 → 1.0 with `MotionToken.bouncy`, fades in over 0.6s, then translates up + scales down to 0.3 as it settles into the DashboardHeader. `matchedGeometryEffect` makes the logo's transition feel like one continuous element.
- **Welcome message:** "Hi Derrick" types in character-by-character (0.05s per char) — gives the impression the app is acknowledging YOU specifically.
- **Cards stagger in:** Home cards (Storm Alert hero, Recent Jobs carousel, Pipeline mini-Kanban) appear sequentially with `MotionToken.standard` and staggered delay `0.06s × index`. Feels like the screen is composing itself for you.

### Tab switching
- Tab icons scale to 1.1 on tap, then settle with `MotionToken.bouncy`
- New tab's content slides in from the side of the previous tab (left for back-tabs, right for forward-tabs) over 0.3s with `MotionToken.standard`
- Active tab indicator slides between tabs with `matchedGeometryEffect`

### Storm Alert hero
- **Initial appearance:** Pulses orange every 4 seconds (gentle scale 1.0 → 1.02 → 1.0 over 1.2s, then waits) — draws the eye without being annoying
- **Dismissal:** Card scales down to 0.95 + opacity to 0 over 0.3s with `MotionToken.quick`, then collapses its height with `MotionToken.standard`
- **"View Impacted Properties" tap:** Button compresses (scale 0.95) on press, releases with `MotionToken.bouncy`, then triggers the navigation push

### New Job Wizard
- **Step transitions:** Steps slide in from the right with `MotionToken.standard`, previous step slides out to the left simultaneously. Progress bar fills with `MotionToken.gentle`.
- **Chip selection:** Selected chip background scales from 1.0 → 0.95 → 1.0 with `MotionToken.bouncy`. Color fills in with `MotionToken.quick`. Other chips in the same group dim to 0.6 opacity.
- **Pencil-edit jump-back:** Tap pencil icon → step number animates in a circular motion to indicate "rewind," then current step slides off to the right while target step slides in from the left.

### Quick Inspection / Live AR
- **Test square placement:** When ARKit anchors a test square, it scales from 0 to full size with `MotionToken.bouncy` over 0.4s. Slight overshoot.
- **Damage marker pulse:** Each new detected marker pulses (scale 0.5 → 1.2 → 1.0) over 0.3s with `easeOut`. Subsequent updates to same marker just opacity-update.
- **Camera shutter:** Tap shutter button → screen flashes white for 80ms → captured photo zooms in from the center of frame and settles into the photo carousel thumbnail strip with `matchedGeometryEffect`. Feels like a real camera.
- **Photo carousel scroll:** Snap-to-photo with `MotionToken.standard` springiness on settle.

### Slope Capture
- **Stepper +/- buttons:** Number rolls (vertical slide of old digit out, new digit in) instead of jumping. Use a custom `RollingNumberView`.
- **Cost calculation:** Live D × U × R × A computation animates the total — old number fades down + scales 0.8, new number fades in from above + scales to 1.0, with `MotionToken.quick`. Subtle but satisfying.
- **Functional/Cosmetic toggle:** Pill slides between options with `matchedGeometryEffect` + `MotionToken.standard`. Background fills with brand color.

### SwipeReviewView (Tinder cards)
- **Card swipe:** Drag gesture moves card with physics — rotation follows drag (max ±15°), opacity stays 1 until ⅔ of swipe threshold, then fades. On release past threshold: card flies off-screen with momentum-based `MotionToken.standard` (faster if you swiped fast). Next card scales up from 0.9 to 1.0 to take center.
- **Action button feedback:** Tap "Correct" green button → button compresses, screen flashes green tint for 100ms, card slides off to the right with `MotionToken.quick`. Same pattern for "Edit" (orange + slide left), "Skip" (slide up), "Not damage" (slide down).
- **Progress strip:** Fills like a video scrubber, with each tick representing a card.
- **Done state:** Last card animates off → "All caught up" empty state slides up with `MotionToken.standard` + celebratory confetti or sparkle particles (optional, but the app should feel rewarding for completing review).

### OverlayEditorView
- **Marker selection:** Tap marker → it scales to 1.2 + pulses + a 56pt action sheet slides up with `MotionToken.standard`. Other markers dim to 0.5 opacity.
- **Move marker:** Drag gesture with real-time position update + spring snap-back if invalid. Haptic feedback (.medium) on snap.
- **Resize:** Pinch gesture scales the marker with `MotionToken.linear`.
- **Add marker:** Tap "+ Add Damage" FAB → FAB compresses + rotates 45° to become a "X" cancel. Next tap on photo drops a marker with a "pop" animation (scale 0 → 1.2 → 1.0).

### Door Knocking Mode
- **Log Knock CTA tap:** Button compresses → sheet slides up from bottom with `MotionToken.gentle` (slower than other sheets — this is a deliberate action).
- **Knock pin drop:** When a knock is logged, the corresponding map pin drops from above with `MotionToken.bouncy` and ripples outward (concentric circles fading out over 0.6s).
- **Route summary on wrap:** Numbers count up from 0 to final value with `easeOut` over 0.8s (knocks count, conversion %, time). Feels like a slot machine.

### Generate Report
- **PDF generation:** When user taps "Generate Haag Report" → button transforms into a progress indicator (animated dots), then expands to a checkmark on success. PDF preview slides up from bottom.
- **Page transitions in PDF preview:** Use PDFView's native page-curl animation.

### Send Proposal
- **Send sheet:** Slides up with `MotionToken.standard`. Email/SMS/Generate Link options stagger in with `MotionToken.staggerDelay`.
- **Generate Link tap:** Token URL appears with a typing animation (characters appear one-by-one over 0.6s) — feels like the link is being magically generated for them.
- **Copy Link confirmation:** Brief toast slides in from top with "Copied to clipboard" + checkmark, then slides out after 1.5s.

### AI Calibration feedback
- **Per-correction toast:** Slides in from top after a SwipeReview action with "Thanks — improved hail detection 0.4%" + animated up-arrow icon. Auto-dismisses after 2s.
- **Home AI Accuracy tile:** Number updates with a count-up animation when a new correction lands. Pulse the tile briefly with brand-orange glow to call attention.

### Background ambient motion (optional but recommended)

- **Storm Alert hero:** Subtle animated rain or hail particles in the background when an alert is active (very low intensity, ~5% opacity)
- **Map tab:** Subtle parallax when scrolling — closer pins move slightly faster than farther ones
- **Pull-to-refresh:** Custom refresh indicator: a tiny animated roof with a rain cloud forming above as the user pulls

### Haptic feedback patterns

| Event | Haptic |
|---|---|
| Primary CTA tap | `.medium` |
| Destructive action confirm | `.heavy` |
| Toggle / chip select | `.light` |
| Successful save | `.success` notification |
| Error | `.error` notification |
| Swipe action complete | `.medium` |
| Capture photo | `.medium` + camera shutter sound |
| AI detection (new marker found in live view) | `.light` (subtle — don't spam) |
| Storm alert push received | `.success` notification + sound |

---

# RECURSIVE LEARNING LOOP — FULL SPECIFICATION

This is the moat. It must be implemented with all the depth described below. The pitch deck specifically calls this out as "the live feature actively collecting forensic review feedback."

## The complete loop

```
        ┌─────────────────────────────────────────┐
        │  1. Inspector takes photos                │
        │     (live AI runs at 2 Hz)               │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  2. Gemini returns findings + markers    │
        │     per photo with confidence scores     │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  3. DecisionEngine applies HAAG rules    │
        │     produces per-slope + roof verdicts   │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  4. Low-confidence detections + flagged   │
        │     ones queue to TrainingQueue           │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  5. Inspector opens SwipeReviewView       │
        │     swipes through pending items          │
        │     (Tinder pattern with gloves)         │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  6. Each swipe → Correction record        │
        │     original + corrected delta            │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  7. LocalLearningEngine recomputes        │
        │     per-user confidence thresholds        │
        │     + prepends user-style prompt prefix   │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  8. CorrectionsSyncService POSTs          │
        │     batch to corrections backend          │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  9. Backend ingests, applies trust-       │
        │     weighting (Haag-cert × 5x weight)    │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  10. Admin curates corrections into       │
        │      training_examples (gold dataset)     │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  11. Weekly automated fine-tuning job      │
        │      retrains on the curated dataset      │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  12. New model version deploys behind     │
        │      A/B test → gradually rolls out       │
        └──────────────┬──────────────────────────┘
                       ↓
        ┌─────────────────────────────────────────┐
        │  13. Every inspector benefits             │
        │      Loop back to step 1                 │
        └─────────────────────────────────────────┘
```

## On-device pieces (in the iOS app)

Already covered in Phase 9. Implementation hardening details:

### TrainingQueue auto-enqueue rules
- Any detection with `confidence < 60` (per-category, 0-100 scale)
- Any inspection with `count > 10` detections in a single category (suspicious uniformity)
- Any photo flagged by photo-quality service as borderline (would benefit from inspector review)
- Random 5% sampling of high-confidence detections (for calibration / ground-truth diversity)

### LocalLearningEngine threshold adjustments
- Track rolling stats over the last 100 corrections per category
- If user has rejected ≥30% of "hail" markers across recent corrections → raise hail confidence threshold for this user (filter out more low-confidence hail)
- If user has added ≥20% missed "wind" markers → lower wind threshold (be more aggressive on wind detection for this user)
- Cap adjustment range at ±20% from baseline (don't drift wildly)

### User-style prompt prefix
After user has 20+ corrections, prepend a small line to the Gemini system prompt:
```
Inspector tends to: identify wind damage AI often misses; be conservative on hail in low-light conditions. Calibrate detection accordingly.
```
Generated dynamically from `UserCorrectionProfile`.

## Cloud pieces (in the corrections backend)

### Trust weighting algorithm

```typescript
function trustWeight(user: User): number {
  let weight = 1.0;
  if (user.haag_certified) weight *= 5.0;
  if (user.years_experience >= 10) weight *= 1.5;
  if (user.corrections_approved / user.total_corrections >= 0.9) weight *= 1.3;
  return Math.min(weight, 10.0);
}
```

### Weekly retraining cycle (cron job, Sunday 2am)

```typescript
async function weeklyRetraining() {
  // 1. Pull all training_examples from past week
  const examples = await db.training_examples.find({
    promoted_at: { gte: oneWeekAgo() }
  });

  // 2. Apply trust weighting (sample more examples from high-authority users)
  const weightedDataset = applyTrustWeighting(examples);

  // 3. Format for Gemini fine-tuning API
  const formatted = formatForGemini(weightedDataset);

  // 4. Submit fine-tuning job
  const job = await geminiClient.tuningJobs.create({
    base_model: 'gemini-2.5-flash',
    training_data: formatted,
    epochs: 3,
    learning_rate: 0.001
  });

  // 5. Wait for completion, eval on held-out set
  const newModel = await job.waitForCompletion();
  const evalScore = await evaluateModel(newModel, heldOutSet);

  // 6. If accuracy improved, deploy behind A/B test
  if (evalScore > currentModelScore + 0.01) {
    await deployModel(newModel, rolloutPercent: 5);
  }
}
```

### A/B testing rollout

- New model starts at 5% of traffic
- After 24 hours, if model error rate hasn't increased: bump to 25%
- After 48 hours, if still healthy: 100%
- If any threshold breach: instant rollback to previous model

### Geographic clustering for the AI Insights Training Queue

This is the "3 leads within 2mi of Apr 18 hail core" feature from the pitch deck. The Training Queue auto-organizes pending items by geographic proximity to recent storms:

```typescript
async function clusterTrainingItemsByGeography() {
  const pendingItems = await getPending();
  const recentStorms = await getStormsLastDays(30);

  return pendingItems.map(item => {
    const nearestStorm = findNearestStorm(item.location, recentStorms);
    return {
      ...item,
      cluster: nearestStorm
        ? `${nearestStorm.kind} ${nearestStorm.date} (${nearestStorm.distanceMi}mi)`
        : 'No nearby storm event'
    };
  });
}
```

UI: TrainingQueueView shows items grouped by storm cluster with header "3 leads within 2mi of Apr 18 hail core" — visible signal to inspector that AI noticed the pattern.

---

# COMPLETE SUPABASE SETUP

The app needs Supabase fully wired from day one for auth + corrections sync. Even if auth is bypassed during dev (`requireAuth = false`), the infrastructure should be in place.

## Supabase project structure

### Tables (already in Phase 10 spec — repeated here for completeness)

```sql
-- users (inspector accounts, anonymous device-id keyed)
create table public.users (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  auth_user_id uuid references auth.users(id) on delete set null,
  email text unique,
  display_name text,
  haag_certified boolean not null default false,
  haag_certification_number text,
  years_experience int default 0,
  authority_score numeric(3,1) not null default 1.0,
  total_corrections int not null default 0,
  corrections_approved int not null default 0,
  corrections_rejected int not null default 0,
  organization_id uuid references public.organizations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- organizations (for future multi-user team support)
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references public.users(id) on delete cascade,
  subscription_tier text default 'free',
  created_at timestamptz not null default now()
);

-- inspections (synced from iOS for org-wide visibility)
create table public.inspections (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  organization_id uuid references public.organizations(id),
  report_id text not null,
  customer_name text not null,
  address text not null,
  lat double precision,
  lng double precision,
  carrier text,
  status text not null default 'in_progress',
  damage_score int,
  roof_recommendation text,
  inspection_data jsonb not null,  -- full Inspection schema as JSON
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- corrections (the recursive learning data)
create table public.corrections (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  inspection_id uuid not null,
  photo_id uuid not null,
  slope_id uuid,
  correction_type text not null,
  categories_affected text[] not null default '{}',
  original_detection jsonb not null,
  corrected_detection jsonb not null,
  delta jsonb not null,
  photo_url text,
  photo_hash text,
  status text not null default 'pending',
  admin_notes text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  corrected_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- training_examples (curated gold-standard set)
create table public.training_examples (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null unique references public.corrections(id) on delete cascade,
  photo_url text not null,
  labels jsonb not null,
  authority_weight numeric not null,
  dataset_version text,
  promoted_by uuid not null references public.users(id) on delete restrict,
  promoted_at timestamptz not null default now()
);

-- audit_log (every admin action)
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- model_versions (track deployed models)
create table public.model_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  base_model text not null,
  training_examples_count int not null,
  eval_accuracy numeric,
  status text not null default 'training',  -- training / evaluating / staged / live / retired
  rollout_percent int default 0,
  deployed_at timestamptz,
  created_at timestamptz not null default now()
);
```

### Row Level Security policies

```sql
-- users: own row + admin
create policy "users_select_own_or_admin" on public.users for select
  using (auth.uid() = auth_user_id or auth.jwt()->'app_metadata'->>'role' = 'admin');

-- corrections: insert via service role only (API endpoint); select admin only
create policy "corrections_insert_service_role_only" on public.corrections for insert
  with check (auth.jwt()->>'role' = 'service_role');

create policy "corrections_select_admin" on public.corrections for select
  using (auth.jwt()->'app_metadata'->>'role' = 'admin');

create policy "corrections_update_admin" on public.corrections for update
  using (auth.jwt()->'app_metadata'->>'role' = 'admin');

-- training_examples: admin only
create policy "training_examples_admin" on public.training_examples for all
  using (auth.jwt()->'app_metadata'->>'role' = 'admin');

-- inspections: own row + same-org + admin
create policy "inspections_select_own_or_org" on public.inspections for select
  using (
    user_id = (select id from public.users where auth_user_id = auth.uid())
    OR organization_id = (select organization_id from public.users where auth_user_id = auth.uid())
    OR auth.jwt()->'app_metadata'->>'role' = 'admin'
  );

create policy "inspections_insert_own" on public.inspections for insert
  with check (user_id = (select id from public.users where auth_user_id = auth.uid()));
```

### Auth configuration

In Supabase Dashboard:
- **Site URL:** `roofwise://auth/callback` (custom URL scheme for iOS app)
- **Redirect URLs allowlist:**
  - `roofwise://**`
  - `https://roofwise.app/**` (for future web companion)
  - `https://roofwise-backend.vercel.app/**` (for admin UI)
- **Email confirmations:** Required (or off if using SMTP rate limits during dev)
- **Custom SMTP:** Resend (recommended) — `smtp.resend.com:465`, auth user `resend`, password = Resend API key

### Storage buckets

```sql
-- Create storage bucket for damage photos (used by corrections backend)
insert into storage.buckets (id, name, public) values ('damage-photos', 'damage-photos', false);

-- Policy: signed URLs only; no public access
create policy "damage_photos_signed_only" on storage.objects for select
  using (bucket_id = 'damage-photos' and auth.jwt()->'app_metadata'->>'role' = 'admin');
```

Photos are uploaded by the iOS app via signed upload URLs requested from the backend. They're stored with hashes as filenames for dedup.

## iOS-side Supabase integration

### Initialization

`Services/SupabaseService.swift`:

```swift
import Supabase

class SupabaseService {
    static let shared = SupabaseService()
    let client: SupabaseClient

    private init() {
        let url = URL(string: APIKeys.supabaseUrl)!
        let options = SupabaseClientOptions(
            db: .init(schema: "public"),
            auth: .init(
                storage: KeychainStorage(),  // secure storage for sessions
                flowType: .pkce,              // important for deep-link auth
                autoRefreshToken: true
            ),
            global: .init(headers: ["x-roofwise-version": Bundle.main.appVersion])
        )
        self.client = SupabaseClient(supabaseURL: url, supabaseKey: APIKeys.supabaseAnonKey, options: options)
    }
}
```

### Deep link handler (already in spec — repeated)

In `RoofWiseApp.swift`:

```swift
.onOpenURL { url in
    guard url.scheme == "roofwise" else { return }
    Task {
        do {
            try await SupabaseService.shared.client.auth.session(from: url)
        } catch {
            print("[Auth] deep link session error: \(error)")
        }
    }
}
```

### Corrections sync

`Services/CorrectionsSyncService.swift`:

```swift
class CorrectionsSyncService {
    static let shared = CorrectionsSyncService()

    func syncPending() async {
        guard NetworkMonitor.shared.isReachable else { return }
        let pending = await CorrectionsStore.shared.pendingCorrections()
        guard !pending.isEmpty else { return }

        let batch = pending.prefix(50).map { $0.toSyncPayload() }
        let payload = ["device_id": DeviceID.current, "corrections": batch]

        do {
            let url = URL(string: APIKeys.correctionsEndpoint)!
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(payload)

            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
                print("[CorrectionsSync] \(resp)")
                return
            }

            let result = try JSONDecoder().decode(SyncResult.self, from: data)
            await CorrectionsStore.shared.markSynced(result.acceptedIds)
            print("[CorrectionsSync] Synced \(result.accepted) (\(result.duplicates) duplicates)")
        } catch {
            print("[CorrectionsSync] error: \(error)")
        }
    }
}
```

Sync triggers:
- Every 5 minutes when app is foregrounded (Timer)
- On NetworkMonitor reachability becoming true
- Every BGAppRefreshTask cycle (4h cadence)
- Manually on demand (e.g., user taps "Sync now" in settings)

### Inspection sync (when multi-user org is needed)

When `Inspection.complete == true`, push the full inspection JSON to `public.inspections` table so other team members and the manager dashboard can see it. Same pattern as CorrectionsSync.

## Environment variables required in iOS

`Configuration/APIKeys.swift` (already covered, repeated for completeness):

```swift
enum APIKeys {
    // Supabase
    static let supabaseUrl = "https://YOUR_PROJECT.supabase.co"
    static let supabaseAnonKey = "eyJhbGc..."

    // Corrections backend
    static let correctionsEndpoint = "https://api.roofwise.app/v1/corrections/batch"

    // Google
    static let googleMapsApiKey = "AIza..."
    static let googleSolarApiKey = "AIza..."
    static let googleGeocodingApiKey = "AIza..."
    static let googlePlacesApiKey = "AIza..."
    static let googleWeatherApiKey = "AIza..."

    // Gemini (from env var or Info.plist)
    static var geminiApiKey: String {
        ProcessInfo.processInfo.environment["GEMINI_API_KEY"]
        ?? Bundle.main.infoDictionary?["GeminiApiKey"] as? String
        ?? ""
    }

    // NOAA
    static let noaaUserAgent = "RoofWise iOS / contact@roofwise.app"

    // Feature flags
    static let requireAuth: Bool = false
    static let useStructuredConfidence: Bool = true
    static let useLiveARAnalysis: Bool = true   // toggle for the live AR overlay feature
}
```

---

# THE COMPLETE PRODUCT IDENTITY (one-page summary)

Everything in one place so any AI agent or developer can absorb the product fast.

## What we are
**RoofWise** — the objective layer between roofing contractors and insurance carriers. AI-powered, Haag-protocol-compliant roof damage detection that eliminates claim denials.

## What we do
Collapse 6-8 hours of manual Haag inspection into 10-15 minutes. AR-guided photo capture → real-time AI damage detection → Tinder-swipe inspector review → automated Haag-compliant PDF that insurance carriers accept.

## Who we serve
- **Primary:** Roofing contractors in the US hail belt (TX, CO, OK, KS, NE) — 106K contractors nationwide
- **Secondary:** Insurance carriers needing standardized damage assessment (Top 8 carriers + tier-1 insurtechs)
- **Future:** Adjusters, homeowners (via portal), distributor networks

## How we make money
1. SaaS subscriptions to contractors ($79-$299/mo)
2. Per-report fees ($12-$15)
3. Insurance carrier APIs ($5-$15/inspection consumed + $10K-$50K annual integration)
4. Data licensing (anonymized labeled damage dataset for fraud detection models)

## Why we win
- First and only automated Haag-protocol-compliant reporting platform
- Real-time AR damage detection (no one else has this UX)
- Recursive learning loop creates a data moat that compounds with every inspection
- Trust-weighted feedback (Haag-certified inspectors weighted 5x)
- 18-24 month head start on any competitor who tries to replicate the dataset

## Visual identity
- **Logo:** Navy roof peak + orange lightning bolt (roof + storm/AI signal)
- **Palette:** Navy #0C183C / Orange #FC6018 / Cream #F0F0E4 / Slate #546078
- **Personality:** Confident, professional, contractor-friendly, modern. Restraint over decoration. The brand is the promise.

## Tone of voice
Direct. Substantive. No fluff. Talks like an experienced inspector, not like a tech startup. "We found 12 hail strikes" not "Our AI detected 12 potential indicators of impact damage."

## The build mantra
The user is a roofer in gloves on a hot roof. Every architectural decision, every UI choice, every default behavior should optimize for that user's success.
