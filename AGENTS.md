# RoofWise agent contract

RoofWise is an existing Expo SDK 57 application. Continue the current app in
place: do not scaffold a replacement, rewrite navigation, remove features, or
substitute mock data for working stores and services.

Before changing code, read `CLAUDE.md`, the Context Summary in
`PROMPT_LOG.md`, `BACKLOG.md`, and any task-specific document under `docs/`.
For visual work, `docs/DESIGN_1A.md` and the owner's Design 1A HTML are the
authority. Extend that system to screens the mock does not show while keeping
their existing behavior and data flow intact.

- Reuse `theme/tokens.ts` and shared UI components; do not add screen-local
  colors, font scales, or competing design systems.
- Preserve the five-tab information architecture and all existing routes.
- Keep touch targets, honest empty/error states, and the no-seeded-data rule.
- Do not change business logic, API contracts, dependencies, Expo config, or
  bundle identifiers unless the task requires it; document and verify any such
  change.
- Install Expo native packages with `npx expo install`, never plain npm.
- Run typecheck, lint, Expo dependency checks, web export, and relevant smoke
  tests before handoff. Native behavior still requires an on-device pass.
- Never commit credentials. Client configuration belongs in `.env.local` or
  EAS environment variables; service-role credentials are server-only.

Git policy: branch from `claude/wonderful-franklin-HuSTl`. Do not push, merge,
or open a pull request unless the owner explicitly requests it.
