# BACKLOG — the "don't lose it" ledger

Every deferred decision, parked follow-up, and "later" from PROMPT_LOG lives here
in one place. **Any agent starting work in this repo reads this file after
PROMPT_LOG's Context Summary** (CLAUDE.md enforces this). When you complete an
item, move it to Done with the entry number that closed it. When you defer new
work, add it here in the same commit — a follow-up note buried in a PROMPT_LOG
entry does not count as tracked.

> Format: `- [ ] Item — source #entry · why it matters`

---

## Now (committed next steps, in order)

- [ ] Extend motion layer to Settings tab + Job/Lead detail screens — #34 · last un-animated surfaces; mechanical with `components/motion/`
- [ ] HAAG claim packet PDF polish (`lib/services/haagPdf.ts`) — user priority list 2026-07-22 · the money artifact; layout, annotated photos, threshold citations, signatures
- [ ] Verify rectangle overlays + withheld-detections toast on a real device with a real analysis — #39 · built and typechecked, but not yet seen with live Gemini output

## Next

- [ ] Welcome screen pre-checks `isSupabaseConfigured` and shows a banner before first submit — #35
- [ ] Settings screen "backend: not configured / connected" indicator — #35 · faster field debugging
- [ ] Device pass on motion layer: confirm 60fps dashboard stagger with long lists; profile `AnimatedCounter` setState cost — #34
- [ ] Capture web-preview launch recipe as a project skill via `/run-skill-generator` — #38 · so future sessions don't rediscover the expo-web + Playwright dance
- [ ] Refresh the stale Feature Backlog table in PROMPT_LOG (rows don't reflect built features like proposals/PDFs/door-knocking) — noticed #38

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

## Done (most recent first)

- [x] Rectangle damage overlays from bbox data — closed by #39 (was #32 follow-up)
- [x] "AI withheld detections" inspector toast — closed by #39 (was #31 follow-up)
- [x] Honor `REQUIRE_AUTH` at auth gates (Drift #12 bug) — closed by #38
- [x] Web preview support (expo web + Playwright headless drive) — closed by #38
- [x] Supabase dead-project fallback removed, friendly not-configured gate — closed by #35 (was #24 gotcha)
- [x] App-wide motion layer (5 tabs, BottomTabs, DamageScoreBar, WeatherTile skeleton) — closed by #34
