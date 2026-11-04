# Courtside design on the existing RoofWise app

The owner clarified on November 3, 2026 that RoofWise is already built in Codex
and requested **design changes only**. The verified existing source is
`PAXstudios/RoofWiseClaude`, branch `codex/design-1a-completion`, commit
`8abaed78f94c7833d2045e7660846467333ebbf2`.

## Current phone design

The November 4 update uses the owner's Hotels references for rounded corners,
compact type, pill-shaped actions and a photo-led job profile. Home moves
from the two inspection/job actions through Weather, Tools & services, Area
activity, Recent jobs, Saved estimates, Pipeline, Today, Tasks and Recent
activity. A pinned menu opens the main destinations, account choices and tour.
The startup draws a roofline, then first-time users can take the four-scene
roofing tour, skip to account options, or enter as a guest. The walkthrough
respects Reduce Motion. See `docs/DESIGN_1A.md` for the current visual guide.

The sections below record earlier deliveries.

## Scope

Apply the selected [Courtside reference](references/RoofWise-Courtside.png) to
existing screens and components. All **49 existing route files** remain, with
**zero additional routes**. Stores, services, models, API contracts, package
manifests, EAS profiles and bundle identifiers match the existing Codex source.
The extra customer/resource/tools/export features from the earlier expanded
working branch have been removed from this change set.

## Appearance

- Navy dashboard masthead and navigation, blue-tinted headers, white cards on
  a cool blue-gray canvas, and burnt-orange priority actions/selected mobile tab.
- Distinct blue, orange, navy and neutral tool tiles with stacked readable labels.
- Bundled Barlow Condensed headings and upright readouts; Archivo body, section
  titles, controls and metadata with reduced tracking.
- “Your workday” replaces the Home slogan and decorative roof cuts; desktop
  navigation uses the existing official logo. Flat surfaces and consistent
  rounded rectangles replace decorative treatments in these areas.
- Existing real photographs, measurements, findings and counts remain data-driven.
- The existing five tabs, capture controls, job tabs, sheets, account flows,
  four-screen onboarding and workflow actions remain.
- Shared touch target sizes remain 56pt minimum and 88pt for sticky actions.
- Native splash/adaptive-icon grounds become white as part of the appearance.

## Existing screen coverage

| Existing area | Design application |
| --- | --- |
| Home | Navy masthead, distinct brand-color tools, paired orange/blue actions, real metrics |
| Pipeline / leads | Blue-tinted masthead/column headers, blue active filters, white content cards |
| Capture / review / annotations | Light control panels, navy labels, blue selections, orange shutter; original capture/review logic |
| Job Overview / Measure / Photos / Proposal / Tasks | Blue selected tabs, grouped canvas, tinted module headers and readable assessment labels |
| Maps / weather / canvassing / planning | Light controls and sheets with existing imagery and data |
| Estimates / reports / training / mileage | Condensed readouts, shared cards, existing actions and calculations |
| Settings / account / onboarding | Existing screens and handlers with the Courtside appearance |

No app was scaffolded or replaced. No build/deployment setup or backend changes
are included. Device-specific behavior has not been inferred from web previews.

## Review and validation

[Actual app preview](references/RoofWise-Courtside-App-Preview.png).
[Route/render checks](references/Courtside-Web-Checks.json).
The owner authorized publication in #126–#127 and again in the continuation
request. The Courtside baseline is on `codex/design-1a-completion` at
`12966b434ed09838876c1b5693353e3bcd96bbf2`; this is the existing app's source
branch, separate from an installed Expo/native build.

Continuation #125 preserves the condensed Home headline below 360pt and gives
each original onboarding page vertical scrolling when its art and copy exceed
the available height. Next, Skip and the account action remain outside that
scroll; all four pages and their existing handlers are retained. Radar lines
use the existing light-surface border token. TypeScript, lint, the original
12 regression suites, installed-SDK compatibility and a fresh web export pass.
The earlier screenshots/route report above predate #125; a new interactive
browser pass could not reach this session's local preview. Short-screen native
scrolling and gestures remain in the device checklist.

Continuation #128 finishes two visual details: the Home roof cuts fit the
headline's actual height, and report statistic cards use readable sentence-case
Archivo labels with compact padding. Font advance checks fit all three labels
on a 320pt phone at default text size. TypeScript, lint, all 12 original
regression suites, installed-SDK compatibility and a fresh web export pass.
Online Expo Doctor passes 20/21 checks and flags SDK 57 patch-version updates;
dependencies remain unchanged for this design task. The cloud browser cannot
reach the local preview, so the linked screenshots remain the earlier #124
render rather than a new visual verification of #128.

Font source: https://github.com/google/fonts/tree/main/ofl/barlowcondensed
The bundled OFL license is retained in `assets/fonts/OFL.txt`.

## Live Expo preview — November 3, 2026

The owner completed Expo authentication and explicitly authorized publishing
the existing client configuration. Courtside is published from application
commit `4454a9a9d0868a052f8d2db05e53eec213e063c3` to the existing
`@roofwise/roofwise` project's `preview` channel/branch and `preview` environment.
Runtime: `exposdk:57.0.0`.

[Open the Courtside preview](https://expo.dev/accounts/roofwise/projects/roofwise/updates/eec6ec75-40eb-41d2-a3a6-f730c7c55fa2),
then select Preview to open it in Expo Go with the same Expo account.
Update group: `eec6ec75-40eb-41d2-a3a6-f730c7c55fa2`.

Fresh iOS/Android bundles include all nine configured preview client values;
verification withheld their values. This publication makes the existing app
available for physical-device review; it does not replace those device checks
or constitute an App Store/TestFlight release.

## SDK 58 compatibility follow-up

The owner's phone now reports Expo Go SDK 58.0.0. The SDK 57 update linked above
cannot run in that client. The existing app is upgraded to SDK 58 with its
Courtside design and all 49 original routes preserved. See
[SDK 58 upgrade details](SDK58_UPGRADE.md) and PROMPT_LOG #130 for compatibility
changes and validation. The replacement preview is now published with runtime
`exposdk:58.0.0`, from app source `bae0d6b171f86715ea07fd465a1ab8119fbd00b6`:
[Open the SDK 58 preview](https://expo.dev/accounts/roofwise/projects/roofwise/updates/85c5d06c-452c-4652-a407-3323916d1e2e).
Use this link with the owner's current Expo Go. Native/web exports, 14 suites,
TypeScript, lint and Expo Doctor 20/20 pass; the physical-phone pass remains.

## Brand color refinement — November 4, 2026

The owner requested more color and clearer separation between app sections.
The shared tokens, headers, cards, metrics, capture panels and navigation carry
this refinement across the existing app. Home, Pipeline, Plan, Train, Settings,
new-job chrome and job tabs receive focused presentation updates. Existing
handlers, routes, stores, status meanings and SDK 58 distribution settings remain.
Earlier screenshots in this document describe the prior white-ground version;
they are not a visual verification of the November 4 refinement.

TypeScript, zero-warning lint, all 14 regression suites, expanded light/dark
contrast checks, installed-SDK compatibility and Expo Doctor 20/20 pass. A
cache-cleared iOS/Android/web export succeeds without loading EAS values or
dotenv, generating 55 static web routes including aliases. This is compile
verification, not a configured replacement preview. Automatic approval review
blocked the configured export despite the recorded earlier approval; the SDK 58
preview linked above still shows the previous design. Publication requires a
fresh explicit confirmation for the existing client configuration in downloadable
bundles. No fresh browser/native visual pass is claimed.


## Published brand-color preview — November 4, 2026

The owner explicitly approved publishing the existing client API keys and
Supabase public configuration in downloadable bundles to the existing RoofWise
Expo preview. This resolves the #132 configured-export gate. A fresh configured
iOS/Android/web export passes; all nine existing client values are present in
both native bundles, with values withheld from logs and git.

[Open the brand-color preview](https://expo.dev/accounts/roofwise/projects/roofwise/updates/e1b081e7-0434-45c1-8b16-a0394f5ef9c8).
Published application source: `e35b3cdd9462c7eabdff72c653d5d3090fac85e7`.
Existing project/channel/environment: `@roofwise/roofwise`, `preview`, `preview`.
Runtime: `exposdk:58.0.0`. Both iOS and Android are published. This is the
successor to the earlier white-ground SDK 58 preview above.

The generated six-screen board shown in chat is an illustrative design preview,
not screenshots of the running app. Native layout, camera/sensors, gestures,
sharing and live-service checks remain in BACKLOG.
