# Courtside design on the existing RoofWise app

The owner clarified on November 3, 2026 that RoofWise is already built in Codex
and requested **design changes only**. The verified existing source is
`PAXstudios/RoofWiseClaude`, branch `codex/design-1a-completion`, commit
`8abaed78f94c7833d2045e7660846467333ebbf2`.

## Scope

Apply the selected [Courtside reference](references/RoofWise-Courtside.png) to
existing screens and components. All **49 existing route files** remain, with
**zero additional routes**. Stores, services, models, API contracts, package
manifests, EAS profiles and bundle identifiers match the existing Codex source.
The extra customer/resource/tools/export features from the earlier expanded
working branch have been removed from this change set.

## Appearance

- White page grounds, navy ink, orange primary actions and supporting blue.
- Bundled Barlow Condensed for display/headings; the existing Archivo body font.
- Angular blue/orange decorative roof cuts, light-gray cards, thin borders and
  restrained shadows.
- Existing real photographs, measurements, findings and counts remain data-driven.
- The existing five tabs, capture controls, job tabs, sheets, account flows,
  four-screen onboarding and workflow actions remain.
- Shared touch target sizes remain 56pt minimum and 88pt for sticky actions.
- Native splash/adaptive-icon grounds become white as part of the appearance.

## Existing screen coverage

| Existing area | Design application |
| --- | --- |
| Home | Courtside masthead, compact tool cards, paired orange/blue actions, real metrics |
| Pipeline / leads | White masthead, light columns/cards and condensed headings |
| Capture / review / annotations | Light control panels, navy labels, blue selections, orange shutter; original capture/review logic |
| Job Overview / Measure / Photos / Proposal / Tasks | Consistent typography, light surfaces and readable assessment labels |
| Maps / weather / canvassing / planning | Light controls and sheets with existing imagery and data |
| Estimates / reports / training / mileage | Condensed readouts, shared cards, existing actions and calculations |
| Settings / account / onboarding | Existing screens and handlers with the Courtside appearance |

No app was scaffolded or replaced. No build/deployment setup or backend changes
are included. Device-specific behavior has not been inferred from web previews.

## Review and validation

[Actual app preview](references/RoofWise-Courtside-App-Preview.png).
[Route/render checks](references/Courtside-Web-Checks.json).
The closing PROMPT_LOG #124 records current checks. Git publication is a separate
final action because AGENTS.md requires an explicit owner request before a push.

Continuation #125 preserves the condensed Home headline below 360pt and gives
each original onboarding page vertical scrolling when its art and copy exceed
the available height. Next, Skip and the account action remain outside that
scroll; all four pages and their existing handlers are retained. Radar lines
use the existing light-surface border token. TypeScript, lint, the original
12 regression suites, installed-SDK compatibility and a fresh web export pass.
The earlier screenshots/route report above predate #125; a new interactive
browser pass could not reach this session's local preview. Short-screen native
scrolling and gestures remain in the device checklist.

Font source: https://github.com/google/fonts/tree/main/ofl/barlowcondensed
The bundled OFL license is retained in `assets/fonts/OFL.txt`.
