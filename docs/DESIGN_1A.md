# Design 1A — "Field Standard" — the app's visual system

Source of truth for the 2026-09-03 redesign. Extracted from the owner's Claude
Design mock (`claude.ai/design/p/fd8c8c40-…`, option **1a** of a 4-direction
round — 1a/1b/1c + a 2a–2d hybrid pass). The mock's own one-line brief:

> **Field Standard** — the disciplined evolution. Keeps the floating pill tab
> bar and card rhythm, swaps navy for royal blue and warms the orange. Grain
> sits low, only in the colour fields. Archivo throughout, tight and
> utilitarian. Damage reads as a scored bar plus numbered heat zones. Safest
> to ship.

**The mock covers 8 screens** (6-step onboarding, Home, Capture, Damage
Report, Lead Detail, Storm Map, Pipeline Board). RoofWise has far more surface
than that — Knock Planner, Door Knocking, Job tabs, Estimator, Mileage,
Settings, Train, Reports, annotations, and every sheet/modal in between. Per
owner instruction: **extend this system consistently to every screen it
doesn't literally show**, rather than leaving them on the old palette.

If this doc and a screen's old styling disagree, this doc wins — it is the
new Drift-Warning-#11-equivalent contract ("theme tokens everywhere," now
pointed at these values). Never hand-pick a hex from the mock's raw markup;
resolve it through `theme/tokens.ts`.

---

## 1. Palette

Every hex below lives in `theme/tokens.ts` under `brand`; nothing outside
that file should hold a literal.

| Role | Hex | Old token it replaces | Used for |
|---|---|---|---|
| `royalInk` | `#0B1A5C` | `royalInk` (`#0E1330`) | Deep anchor — mesh gradient start/40%, dark surfaces, primary text-on-cream headings, filled "Signed" pipeline cards |
| `royal` | `#1235B8` | `royal` (`#2B4EF5`) | Primary blue — buttons, "New" pipeline stage, stage-progress fill, the New-Job card |
| `royalBright` | `#2447E8` | *(new)* | Brighter blue accent — mesh 50% stop, wind-LSR dots, gradient highlights |
| `royalSoft` | `#EBEDF7` | `royalSoft` (`#E4E9FE`) | Light blue tint — "cited storm event" card, info chips |
| `magenta` | `#8A3A73` | *(new)* | Mesh transition stop (62–82%) between blue and orange. Variants seen: `#7A2E5E` (deep), `#9C3A5E` (warm), `#6B3BC4`/`#5B3BD6` (violet, on Lead/Sign-in screens) — treat as one role, `brand.magenta`, and let callers choose the exact stop via the gradient helper below |
| `burnt` | `#E8631A` | `burnt` (`#D9541E`) | Primary orange — CTAs, active states, "Signed" stage colour |
| `burntDeep` | `#C1490E` | `burntDeep` (`#A63C12`) | Severe/dark orange — score badges, deep gradient stops |
| `burntLight` | `#FF8A3D` | *(new)* | Light orange highlight — progress dots and glow accents; excluded from bottom navigation by the later owner override in §4 |
| `amber` | `#FFC43D` | *(new)* | Caution/moderate — granule-loss findings, "MODERATE" score badge |
| `paper` | `#F2F0E7` | `colors.bg` was `#F6F6FA` | Warm paper ground — replaces the old cool light-gray background everywhere. This is also the "white" text colour used over dark heroes (never pure `#FFFFFF` on a mesh) |
| `paperBorder` | `#DDDED1` | `colors.border` was `#E6E8F0` | Card borders on the paper ground |
| `paperHairline` | `#EDEEE4` | `colors.hairline` | List-row dividers inside white cards |
| `ink` | `#0B1A5C` | `colors.text` was `#0E1330` | Primary text on light surfaces (same value as `royalInk` — text and the deep brand anchor are the same colour by design) |
| `inkMuted` | `#546078` | `colors.textMuted` was `#5A6180` | Secondary text |
| `success` | `#2BB673` | `colors.success` (`#1E9E62`) | Signed/paid, permission toggles-on |

Untouched: `colors.danger`/`dangerSoft`, `colors.warn`/`warnSoft` (semantic,
deliberately separate from brand hue per the existing contract) — keep as-is
unless a screen literally shows otherwise.

### Grain
Every mesh hero and every dark capture/map background in the mock carries a
low-opacity fractal-noise overlay:
```
background-image: <SVG feTurbulence, baseFrequency 0.8–0.95, 2–3 octaves>, 140–160px tile
opacity: .16–.26 (screens vary; .2 is the house default)
mix-blend-mode: overlay
```
On native this is **one shared static noise PNG/SVG asset**, tiled, not a
per-screen SVG string (React Native doesn't run `<feTurbulence>`). Generate
it once (`assets/images/grain.png`, ~160×160, tileable, mid-grey noise) and
apply via an `<Image resizeMode="repeat">` (or `ImageBackground`) layer at
`opacity: 0.2`. Never regenerate noise per-screen — one asset, one look.

---

## 2. The mesh gradient — the system's signature

A 5-stop linear gradient, angle and exact stop positions vary slightly by
screen but the **colour sequence never changes**: `royalInk → royalInk →
royalBright → magenta → burnt`. Observed variants:

| Screen | Angle | Stops |
|---|---|---|
| Onboarding 1 / Sign-in | 115° | ink 0%, ink 40%, royalBright 50%, magenta(`#7A2E5E`) 62%, burnt 100% |
| Home hero | 150° (3-stop short form) | `royalInk → royal → magenta(`#8A3A73`) 82% → burnt 100%` |
| Damage report / Lead detail | 135–140° | `royal → royalBright 60% → magenta(violet `#6B3BC4`) 100%` (a bluer 3-stop cut of the same ramp — no orange stop) |
| Pipeline board header | 140° | `royalInk → royal 70% → magenta(`#7A2E9E`, violet-leaning)` (also no orange — headers that aren't the primary Home hero stay cooler) |
| Onboarding splash (screen 08) | 158° | `royalInk 0%, royal 46%, magenta(`#8A3A73`) 78%, burnt 100%` |
| Storm map bg | 160° | `#101c3f → royalInk 40% → #182a6b` (a **desaturated**, no-orange variant — the map needs to stay legible under pin colours) |

Build **one** shared gradient system rather than one array per screen:
`gradients.mesh(variant)` in tokens, or a `<MeshBackground variant="hero" |
"cool" | "night" | "splash">` component (§5) that encodes these five angle/stop
combinations by name. Do not let each screen invent its own stop list.

---

## 3. Typography

- **Archivo** (Google Font) for everything except data labels — headlines,
  body, buttons, nav labels. Weights used: 400, 500, 600, 700, 800. Install
  `@expo-google-fonts/archivo`, load in the root layout behind the splash
  screen (blocking — Archivo must be ready before first paint; the mock's
  type is load-bearing to the whole identity). Font family tokens:
  `fontFamily.archivo = { regular: 'Archivo_400Regular', medium:
  'Archivo_500Medium', semibold: 'Archivo_600SemiBold', bold:
  'Archivo_700Bold', extrabold: 'Archivo_800ExtraBold' }`.
- **Monospace data labels** — `ui-monospace, Menlo, monospace` in the mock is
  a *system* font stack, not a custom face. On native: `Platform.select({ ios:
  'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' })`
  — zero install cost. Used for: step eyebrows ("STEP 01 · CAPTURE"), stat
  labels ("REVENUE YTD", "LEADS", "PIPELINE"), report/claim ids ("RW-2841",
  "#TX-0418-2261"), confidence scores ("0.94" / "CONF."), timestamps ("TODAY
  8:14 AM"), badge chips ("78 SEVERE", "HEATMAP"). Always **uppercase +
  letter-spacing ~0.1em** at 9.5–11px, weight 500–700. This is a new token:
  `fontFamily.mono` + a text style `dataLabel` (size `caption`, weight
  `semibold`, letterSpacing 1.1, uppercase, colour `inkMuted` or the
  hero's `paper` at low opacity depending on ground).
- Keep the existing `fontSize` scale (11/13/15/17/22/24/28/34) — the mock's
  sizes (44/34/32/27/26/25/22/19/17/15/14/13/12.5/11/10.5/10/9.5/9) map onto
  it closely enough (44≈`display`+10, 34≈`display`, 32≈`titleXl`+4, use
  judgement per-screen rather than adding a parallel scale). Do not fork the
  type ramp — extend `display` upward only if a screen genuinely needs 44px
  (the onboarding hero) via a one-off style, not a new named token.

---

## 4. Shapes, radii, shadows

- Card radius: **16–22px** (mostly 18) — slightly larger than the current
  `radii.card` (16). Bump `radii.card` to 18, keep `radii.lg` (20) and
  `radii.xl` (24) as the mock's larger cards use those too.
- **Floating pill tab bar — owner's device-review override, 2026-09-04:**
  Keep 1A's suspended `radii.pill` geometry with 16px side margins, but use
  **light/paper bottom controls on every screen**, including Map. No blue/navy
  dock fill and no orange bottom treatment or selected chip. This later
  instruction supersedes the original mock's dark/light reversal and orange
  active state (PROMPT_LOG #109–#110). The shared `navigationDock` tokens own
  the white raised capsule, opaque warm-paper safe-area ground, 12px bottom
  spacing, layered shadow, cool tonal selection, and navy text/focus ring.
  Targets remain at least 56pt; selected state also uses filled icons and
  heavier text. Web exposes a single roving keyboard stop: arrows wrap,
  Home/End select the first/last tab, and Space/Enter activate. Native press,
  long-press and haptics retain their existing behavior; motion respects the
  system Reduce Motion setting.
- Buttons: primary CTA height **56–60px** (mock height varies 54–60; keep
  the app's existing `touchTarget.sticky` = 88 for the one true sticky
  bottom CTA per screen, but note the mock's in-flow buttons run smaller,
  54–58 — closer to `touchTarget.preferred` (64) than `sticky`; use judgement
  per screen, never below `touchTarget.standard` (56)). Radius 14–18.
- Shadows: keep the existing `shadows` rungs (card/raised/hero) — the mock's
  card shadows are consistent with what's already there. The mesh-hero
  shadow should use `brand.royal` as the tint (already the pattern in
  `shadows.hero`).

---

## 5. Shared components to build once

- **`components/ui/MeshBackground.tsx`** — `variant: 'hero' | 'cool' |
  'night' | 'splash' | 'map'`, renders the angle/stop combination from §2 as
  a `LinearGradient` plus the grain overlay (§1) at the right opacity. Every
  screen with a coloured hero/header mounts this instead of a bespoke
  gradient.
- **`components/shell/BottomTabs.tsx`** — rebuild on the floating-pill spec
  above. Keep every existing prop/behaviour (haptics, `tabPress` contract,
  active-icon swap, accessibility) — this is a visual change only.
- **`theme/tokens.ts`** — `fontFamily` export (Archivo weights + mono
  stack), a `dataLabel` text-style helper, `gradients.mesh` presets, updated
  `brand`/`colors`/`radii` per §1/§4. `useFonts` gate added in
  `app/_layout.tsx` (Archivo behind the splash screen).
- A **`DataLabel`** text component (or a documented style, `styles.dataLabel`
  pattern) so every screen renders the monospace-eyebrow convention
  identically instead of each screen hand-rolling `fontFamily/letterSpacing`.

---

## 6. Per-screen mapping (mock screen → RoofWise route)

| Mock screen | Route(s) | Notes |
|---|---|---|
| Onboarding 1–6 + splash (08) | `app/onboarding.tsx`, `app/welcome.tsx` | 6-step flow: Welcome → Scan+score → AI score → Storm intel → Permissions+crew → Sign in. Screen 08 is an alternate single-frame splash ("Point. Shoot. File the claim.") — fold as the `app/welcome.tsx` hero if that route is separate from the step flow, else treat as an unused alternate. |
| 02 · Home | `app/(tabs)/index.tsx` | Curved-bottom mesh hero (30px bottom radius) with 3-stat row (Revenue YTD / Leads / Pipeline — **new**, not in the app today; use real store data: `reports.ts`'s revenue calc, `leadStore` count, pipeline weighted value from `pipeline.ts`), Storm Alert card (already exists as `WeatherHero`'s alert path — reskin, don't rebuild), Quick Inspection + New Job 2-up, 3-up tool row (mock shows 3: Hail Tracer/Estimator/Mileage — the app has a 2×2 of 4: Storm Tracer/Knock Planner/Estimator/Mileage; **keep all 4**, the mock simply didn't draw Knock Planner — owner's "not all features included" note applies exactly here), Recent jobs horizontal scroll, Pipeline stage-count strip (5 segments — map onto the app's real `LEAD_STAGE_ORDER` groups from `pipeline.ts`, not the mock's literal 5 labels). |
| 03 · Capture + AI scan | `app/quick-inspection.tsx` + `components/capture/hud/*` | Dark shingle-texture ground + grain, dashed test-square overlay with a live finding tag, slope-selector pill row, frosted on-device-prepass progress card, bottom dock (thumbnails + Analyze pill + shutter). This is the camera HUD system (already exists, `#96`) — reskin its glass/colours onto 1a's palette; the *structure* (tuck-away rail, mode strip, shutter, review drawer) stays, since it's more capable than the mock's flat mock-up. |
| 04 · Damage report | `app/job/[id].tsx` (Overview/Photos tabs), `app/photo-report.tsx`, `lib/services/haagPdf.ts` | Mesh header, big damage-score number + bar, "cited storm event" card, heatmap photo card, findings list with severity-coloured accent bars, scope-estimate card, sticky PDF/Send-to-carrier dual buttons. Map "Findings" rows onto real `DamageMarker`/finding data; "Send to carrier" ≈ the existing packet-share action. |
| 05 · Lead detail | `app/lead/[id].tsx` | Mesh header with avatar+name+source, Call/Text/Nav 3-up, stage progress bar (map onto real `LeadStage`), info card (carrier/claim/deductible/adjuster), **"Copilot says" AI-suggestion card — new capability, not in the app today**; flag as a BACKLOG item rather than fabricating one (no I/O to back it yet), timeline (map onto real `activityStore` events for that lead). |
| 06 · Storm map | `app/(tabs)/map.tsx` | Dark desaturated mesh, terrain SVG strokes (decorative — optional), swath glow circles (already exist as `StormOverlay` swaths — recolour), pin dots, top filter chips (already exist via the `LayersSheet`/`SummaryChip` system from Wave I — reskin colours only, keep the control-rail/drawer structure, it's more capable than the mock's flat filter row), bottom floating event card with "Build knock route" (≈ existing "Start route" flow) + legend. Floating tab bar stays light/paper, consistent with all other screens under the later owner override in §4. |
| 07 · Pipeline board | `app/(tabs)/leads.tsx` (Pipeline, `#103`) | Mesh header ("CRM · PIPELINE" eyebrow + open count + weighted value + Sort + filter pills), Kanban columns with coloured dot+label+count headers, cards with severity/status badge chips, amount, timing note; Signed column's cards go solid `royalInk` fill. Reskin the existing Pipeline board (already has real automation/stage logic from Wave L) onto these colours/type — do not rebuild its logic. |

**Screens the mock doesn't show at all** — reskin using the same tokens/
components, inferring the right pattern from the closest mapped screen:
Knock Planner (`app/knock-finder.tsx`, `components/knock/{BasePicker,
RadiusDial,RunProgress}.tsx` — closest analogue is the Storm Map's dark mesh
+ floating card pattern), Door Knocking (`app/door-knocking.tsx` — same map
family as Storm Map, cool variant), Job page's other tabs (Measure/Proposal/
Tasks — `components/job/*`, use the Damage Report's card language), Estimator,
Mileage, Settings, Train, Reports, every sheet (`components/sheets/*`,
`components/ui/BottomSheet.tsx` — paper ground, white cards, `paperBorder`),
photo annotations toolbar, notifications (`app/notifications.tsx`).

---

## 7. What NOT to change

- Drift Warnings #1–#13 (CLAUDE.md) still apply in full — ≥56pt targets, 5
  tabs, no mocks/seeded data, HAAG thresholds, Gemini model policy, etc. This
  redesign is skin + a few new layout components, never a product-logic
  change.
- Every store, service, and piece of business logic built this session
  (Pipeline/automations, Knock Planner calibration, Storm Tracer select/save/
  route, photo annotations, budgets, the knocking-data Supabase backend) is
  untouched. This doc governs `theme/tokens.ts`, shared UI components, and
  screen-level `StyleSheet`s only.
- Do not invent the "Copilot says" AI-suggestion feature's backend (§6, Lead
  detail) — that's real new scope (an LLM call + a place to store/dismiss
  suggestions) outside a visual redesign. Log it to BACKLOG instead.
