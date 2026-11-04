# SDK 58 compatibility update

The owner's November 3, 2026 screenshot shows Expo Go for **SDK 58.0.0**
rejecting RoofWise's **SDK 57** update. This update upgrades the existing app
one SDK version and keeps the Courtside appearance and all 49 route files.

## Runtime and packages

- Expo 58, React Native 0.88, React 19.3, Router 58.
- Expo-managed native dependencies align through `expo install --fix`.
- Reanimated 4.7 and Worklets 0.13 match the SDK's expected versions.
- React Native's Strict TypeScript API stays enabled; scroll/view refs use
  instance types, and keyboard handlers accept DOM and native-event payloads.
- Native build minimum iOS version is 16.4. Bundle IDs, EAS project, environment,
  runtime SDK-version policy and preview channel remain the existing ones.

The first online Expo dependency lookup timed out. SDK compatibility alignment
used the installed Expo 58 package's dependency map; final online Expo Doctor
passes 20/20 and `npm ls --all` reports no dependency problems. Stale SDK 57
optional navigation peers and lockfiles were preserved outside the repository
while resolving the new dependency graph. No peer checks were suppressed.

## Navigation compatibility

SDK 58's custom tab bar receives `emitter` and `navigateToTab(route.key)`;
the phone dock and desktop sidebar use those callbacks. Tab re-selection,
prevented tab presses, route parameters, keyboard navigation, reduced motion
and long presses retain their existing behavior.

Settings stays declared without `href: null`: SDK 58 treats that option as a
hidden route and redirects it to Home. The existing custom bars already choose
only the five navItems, so Settings stays reachable without adding a sixth tab.

SDK 58 removes `beforeRemove`. The annotation editor now uses
`usePreventRemove`, its `repeat` continuation and `disablePrevention` callback.
Keep drawing retains the draft; Discard resumes the blocked action, including
ConfirmSheet's close-before-confirm delay. Successful saves can leave without
opening a second discard prompt. Capture's existing removal protection remains.

## Validation and scope

TypeScript, lint and SDK compatibility checks pass. The original regression
suites remain, and targeted tests cover the SDK 58 tab contract and annotation
removal protection. Native bundle exports and configuration presence checks
are required before publication. API values are never printed or committed.

The upgrade changes no inspection thresholds, damage taxonomy, services,
database contracts, stores, customer data, theme or assets. Physical-phone
camera/sensors, gestures, sharing and live services still require device testing.

References:

- https://expo.dev/changelog/sdk-58
- https://expo.dev/blog/how-to-upgrade-to-sdk-58
- https://docs.expo.dev/router/migrate/sdk-57-to-58/

## Published SDK 58 preview

[Open the SDK 58 Courtside preview](https://expo.dev/accounts/roofwise/projects/roofwise/updates/85c5d06c-452c-4652-a407-3323916d1e2e).
The existing `preview` channel/environment now has update group
`85c5d06c-452c-4652-a407-3323916d1e2e`, runtime `exposdk:58.0.0`, from source
commit `bae0d6b171f86715ea07fd465a1ab8119fbd00b6`.
Fresh iOS/Android/web exports and configured-value checks pass. Use this new
update link with the owner's SDK 58 Expo Go; the earlier SDK 57 link is unchanged.
