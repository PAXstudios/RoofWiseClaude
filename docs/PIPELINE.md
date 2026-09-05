# Pipeline — leads and jobs, one board

The Leads tab is now **Pipeline** (route stays `/leads`; Drift #2 keeps five
tabs). It folds every lead and every job into one list — a JobNimbus-style
board where a card is a customer's whole story, not two different objects
living on two different tabs.

> **"A lead becomes a job the moment the inspection starts."** — the owner,
> 2026-09-03. This document is the contract for what "the moment" means and
> what happens automatically versus what the roofer still decides.

---

## 1. The pipeline model

### 1.1 One item, not two

`lib/services/pipeline.ts` exports `buildPipeline({ leads, inspections,
proposals, estimates, tasks })` → `PipelineItem[]`. The rule that makes the
board honest:

> A lead with `Lead.inspectionId` set, and the inspection it points at
> (`Inspection.leadId` points back), are the **same** `PipelineItem`. Never
> two cards.

- A lead is matched to its job by the explicit link, either direction
  (`lead.inspectionId === ins.id` or `ins.leadId === lead.id`) — never by
  name or address guessing (Drift #5: nothing inferred is presented as
  fact).
- A lead with no job is an item on its own (id = the lead id).
- A job with no lead (started standalone, e.g. New Job without a lead
  behind it) is an item on its own (id = the inspection id).
- If a lead somehow owns more than one inspection (a second "Start another
  inspection"), the linked one wins as the item's job; the rest still count
  toward `inspectionsForLead()` for stage-signal purposes.

### 1.2 Stage — the 13 values

`LeadStage` gained one member: **`inspecting`**, between
`inspection_scheduled` and `inspected` — the column that exists because "a
lead becomes a job the moment the inspection starts" needs a place to say
so.

```
new → contacted → inspection_scheduled → inspecting → inspected
  → estimate_sent → signed → install_scheduled → in_progress
  → completed → invoiced → paid
                                                            lost (terminal, off to the side)
```

`proposal_sent` is the legacy spelling of `estimate_sent` and is folded at
every read site by `leadStageColumn()` — never compared with raw equality.

### 1.3 Stage groups (the board's tabs / the list's filter chips)

| Group | Stages |
|---|---|
| **Leads** | new, contacted, inspection_scheduled |
| **Inspecting** | inspecting, inspected |
| **Estimating** | estimate_sent |
| **Sold** | signed |
| **Production** | install_scheduled, in_progress |
| **Done** | completed, invoiced, paid |
| **Lost** | lost |

`groupOf(stage)` and `PIPELINE_GROUP_STAGES` are the single source; the
board's column headers, the list's chips, and Reports' funnel all read the
same table.

### 1.4 Stage derivation — `stageOf(lead?, inspection?, proposal?)`

The **lead's own `stage` field is the record of truth** — automations and
the roofer both write it directly (`leadStore.setStage`). `stageOf()` exists
because the job, the proposal and the install dates can each ARGUE for a
stage the lead hasn't caught up to yet (an older build with automations off,
a rule that hasn't run), and the board must still read right:

1. Compute every **signal** the inspection/proposal carry, each with a
   timestamp (`stageSignals()`):

   | Signal | Stage | From |
   |---|---|---|
   | `inspection.status === 'scheduled'` | `inspection_scheduled` | `statusChangedAt` |
   | `inspection.status === 'in_progress'` | `inspecting` | `statusChangedAt` |
   | `inspection.status === 'complete'` | `inspected` | `statusChangedAt` |
   | `inspection.reportFinalizedAt` set | `inspected` | `reportFinalizedAt` |
   | every photo on every slope analyzed | `inspected` | (undated — see below) |
   | `inspection.installStartAt` set | `install_scheduled` | `installScheduledAt` |
   | `proposal.status` sent/viewed | `estimate_sent` | `sentAt` |
   | `proposal.status` signed | `signed` | `signedAt` ?? `sentAt` |

2. Without a lead, the **furthest** signal wins (or `new` with nothing at
   all).
3. With a lead: if the lead is `lost`, stage is `lost` — full stop, nothing
   overrides a lost lead but a deliberate move. Otherwise, a signal only
   moves the answer **forward** of the lead's current stage, and only when
   the signal is at least as new as the lead's own `stageChangedAt` (an
   undated signal — "every photo analyzed" — counts only when the lead's own
   date is *also* unknown). This means:
   - A hand move backward on the board **sticks** — an older forward signal
     never drags it back.
   - A stage the automation engine missed (turned off, an older app build)
     still reads correctly from the job's own data.

`daysInStage` measures from `stageSince()`: the lead's `stageChangedAt` when
the lead is currently AT that stage, else the signal's own date, else
creation.

### 1.5 Amount — `amountOf(lead, inspection, proposal, estimates)`

Precedence, first match wins:

1. A **signed, sent, or viewed** proposal's `total` (a draft proposal has no
   price yet — it doesn't count).
2. A **saved estimate**'s `totalMid` — the job's own `originEstimateId` when
   set, else the newest saved estimate at the same normalized address
   (`estimateFor()`).
3. `lead.value` (typed in by hand, e.g. at New Lead).
4. Nothing — `amount` is `undefined`, never a fabricated `$0` (Drift #5).

### 1.6 Next action — `nextActionFor()`

One line per card, driven by the item's stage plus its live state (an
overdue task always wins; then a due follow-up; then the stage's own
default — "Take photos", "Analyze 3 photos", "Follow up — they opened it",
etc.). Pure, so the board, the list, and Home's Today module never disagree.

### 1.7 Tasks, photos, storm — read straight off the linked records

- `tasks: {done, total}` — every `Task` whose `itemId` is the lead id, the
  inspection id, **or** the linked pair's other id (`taskItemIds()`), so a
  task added on the lead page shows on the job card and vice versa.
- `photoCount` / `analyzed: {done, total}` — every slope's `photoPaths`
  length / `analyzedPhotoIndices` (`photoProgress()`).
- `storm` — the lead's `lastStormMatch`, when present.
- `coverUri` — `coverPhotoUri(inspection)` when there's a job, else the
  lead's own Zillow record photo.

---

## 2. Board and List

### 2.1 Board

One column per stage (`BOARD_COLUMNS` = the 12 live stages + `lost`
trailing, muted). Each column header shows **count + total $** for that
stage (`columnSummary()`). A card shows: cover thumbnail, customer +
address, amount, a days-in-stage chip (amber past 7 days / red past 21 —
**only** in the Leads and Estimating groups, where silence loses the deal;
`stageAgeTone()`), tasks `x/y`, photo count, the next-action line, and a
storm / Zillow badge when the item carries one.

**Moving a card** — two ways, because gloves make drag optional:
- **Long-press drag** between columns (Reanimated + `react-native-gesture-
  handler`), with a static tap-only fallback when Reduce Motion is on.
- A 56pt **"Move →"** button on every card, opening the same stage-picker
  sheet the old Leads board used (grabber, ink title, 56pt rows, Cancel) —
  guaranteed to work with one thumb regardless of gesture support.

Moving a card to **Lost** asks first (`ConfirmSheet`) — the one destructive
move on the board (Drift #1).

### 2.2 List

Group filter chips (the seven groups above, `PIPELINE_GROUPS`), a search box
(name/address), and a sort cycle — **updated / days in stage / amount**
(`sortItems()`). Cards are the same full-width design as the board's, just
stacked.

### 2.3 What moved where from the old two-tab screen

| Old control | Now |
|---|---|
| Leads \| Jobs segment | Gone — one board. `?segment=jobs` still works as a filter preset (`jobs` = Inspecting-and-beyond); `?segment=leads` maps to the Leads group. |
| List \| Board segment | Kept, same control. |
| Stage filter chips (List) | Kept, now the seven **groups**, not all 13 raw stages (still reachable — Board shows every stage as its own column). |
| Call / Text / Email / Directions / Book | Kept verbatim, `components/pipeline/contact.ts` + `QuickActions`, unchanged. |
| Follow-up sheet | Kept, `FollowUpSheet` + `FOLLOW_UP_OPTIONS`, unchanged. |
| "Move to…" sheet | Kept, now driven by `BOARD_COLUMNS` from `pipeline.ts` (12 stages, not 11) and reachable by drag too. |
| Jobs' carrier / sort / follow-up chips | Folded into the List view's filters. |
| The `at` nonce, `?segment=` deep link | Kept. Added: `?filter=<group|storm|jobs>` and `?focus=<itemId>` (scrolls to and briefly highlights one card — for a future storm-cluster or notification deep link into a specific item). |
| `PipelineSummary` hero | Kept, now pipeline value + counts per group + "signed this month" (`summarizePipeline()`), covering leads AND jobs. |
| "+" FAB | Kept, now opens a small "New lead / New job" choice instead of jumping straight to one wizard. |

---

## 3. Leads become jobs, automatically

`inspectionStore.create(draft)`, whenever `draft.leadId` is set:

1. Links both records — `leadStore.linkInspection(leadId, inspectionId)` —
   **idempotently**, regardless of which caller created the job (the New Job
   wizard's own convert code still links on its own too; calling it twice is
   harmless).
2. Logs a `lead_converted` activity event.
3. Emits `inspection_created`, which automation **rule 1** turns into the
   stage move: `in_progress` (the default) → **Inspecting**; `scheduled` →
   **Inspection scheduled**.

Three paths write a job with `leadId` set, and all three get this for free:

- **`startInspectionFromLead(leadId, opts?)`** in `pipeline.ts` — the general
  helper. Idempotent: a lead that already has a job returns it unchanged
  unless `opts.fresh`. The lead page's "Start inspection" CTA should call
  this and push to `/quick-inspection?jobId=<id>`.
- **A standalone capture attached to a lead** — `AddPhotosToSheet` gained a
  fourth choice, **"Existing Lead"** (leads with no job yet), alongside New
  Customer / Existing Customer / Later. Picking a lead calls
  `startInspectionFromLead` and the camera attaches to the resulting job.
- **A knock outcome `appointment`** ("Booked") — `saveKnock.ts` emits
  `knock_outcome`; automation **rule 8** creates the job at `status:
  'scheduled'` with `scheduledAt` set to the appointment the roofer just
  picked, landing the lead in **Inspection scheduled** (not Inspecting —
  the inspection hasn't started yet, only been booked).

---

## 4. Automation engine

`lib/services/automations.ts` — an event bus, ten rules, and an engine that
applies whatever actions the enabled rules return. `lib/services/
automationHooks.ts` exports `useAutomationTicks()` (mount once in
`app/_layout.tsx`) — it installs the local-notification adapter and runs the
clock-driven checks (follow-ups due, idle 7 days) on boot, on every
foreground, and hourly.

### 4.1 Events

| Event | Emitted by |
|---|---|
| `lead_created` | `leadStore.create` |
| `stage_changed` | `leadStore.setStage` (any mover: roofer, automation, knock) |
| `inspection_created` | `inspectionStore.create` |
| `inspection_status` | `inspectionStore.setStatus` |
| `analysis_done` | `analysisQueue.ts`, after a queued slope analysis finishes |
| `report_finalized` | `inspectionStore.setReportFinalizedAt` |
| `estimate_saved` | `estimateStore.save` |
| `proposal_sent` / `proposal_signed` | `proposalStore.setStatus` |
| `install_scheduled` | `inspectionStore.setInstallDates` (new setter) |
| `knock_outcome` | `saveKnock.ts`, every save |
| `storm_matched_lead` | `leadStore.setStormMatch` |
| `follow_up_due` / `idle_7d` | `runAutomationTicks()` (the daily/hourly tick) |

### 4.2 The ten rules

Each rule: a plain-English title (shown verbatim in Settings), a toggle
(default **on**), and a last-run line.

| # | Rule id | When → what |
|---|---|---|
| 1 | `inspection_starts_job` | Inspection created/started → **Inspecting** (or **Inspection scheduled** for a booked one) |
| 2 | `report_done_inspected` | Report finalized, or every photo analyzed → **Inspected** + task "Build the estimate" |
| 3 | `estimate_sent_follow_up` | Estimate or proposal sent → **Estimate sent** + a 3-day follow-up + a local reminder |
| 4 | `signed_next_steps` | Proposal signed → **Signed** + tasks "Order materials" & "Schedule install" + a bell |
| 5 | `install_scheduled_reminder` | Install dates set → **Scheduled for install** + a reminder the day before |
| 6 | `idle_nudge` | 7 days with no activity (not lost/paid/completed) → a bell nudge |
| 7 | `storm_task` | A storm matches a lead's address → task "Call about the storm" (due tomorrow) |
| 8 | `knock_booked_job` | A knock outcome is Booked → job created at **Inspection scheduled** |
| 9 | `follow_up_bell` | A follow-up comes due → a bell entry |
| 10 | `stage_message` | Any stage change into one of four moments → **offers** a customer message |

### 4.3 Actions

`set_stage` (forward-only, no-op-safe), `add_task` (dedupes an open task
with the same title on the same item), `notify` (dedupes by `key` — a
second push with the same key replaces, never stacks), `schedule_reminder`
(the one action requiring the adapter `automationHooks.ts` installs — a
local push), `set_follow_up`, `log_activity`, `offer_message`, `create_job`.

### 4.4 What's automatic vs. what's offered

Every action above writes state or schedules a **local** reminder on the
roofer's own device — nothing here talks to a customer. Rule 10
(`stage_message`) is the one exception worth naming explicitly: it prepares
a text or email (SMS when the customer has a phone, else email) from an
editable template and leaves it as a `MessageSuggestion` for a screen to
show. **The engine never calls `Linking` itself.** A screen offering the
suggestion opens the OS Messages/Mail composer, pre-filled, for the roofer
to review and hit Send — or dismiss it entirely.

Templates (`Settings → Automations`): `on_the_way` (booked), `inspection_
done`, `estimate_sent`, `install_scheduled`. Placeholders: `{name}`
(first name), `{address}`, `{company}`, `{date}`, `{amount}`.

### 4.5 Loop guard

1. **Forward-only + no-op-silent.** `leadStore.setStage` writes and emits
   `stage_changed` only when the stage actually changes; the engine's own
   `set_stage` action additionally refuses to move a stage backward or
   sideways. A rule that re-evaluates its own consequence always lands on a
   no-op.
2. **Per-cascade dedupe.** One external `emitPipelineEvent` call, and every
   event it causes, is one *cascade*. Within a cascade, each rule runs at
   most once per `(item, event type)` — `runAutomations()`'s `cascadeSeen`
   set.
3. **Hard stop.** A cascade longer than `MAX_CASCADE` (24) events is cut and
   logged rather than looping forever.
4. **By construction**, no rule that *sets* a stage listens for
   `stage_changed` — only rule 10 does, and it only ever offers a message,
   never moves anything.

---

## 5. Tasks

`lib/stores/taskStore.ts` — `Task {id, itemId, title, dueAt?, done, doneAt?,
createdBy, order}`. `itemId` is the lead id when the pipeline item has a
lead, else the inspection id; `forItems([leadId, inspectionId])` reads a
linked pair's tasks together. `add()` is idempotent while an open task with
the same title exists on the item (a rule firing twice, or a double tap,
never stacks a duplicate).

`components/pipeline/TasksCard.tsx` — 56pt checkboxes, an add row, due-date
chips (amber overdue). Mounted by the job/lead detail pages (another wave).
Pipeline cards show the `x/y` count; Home's Today module gets a "Tasks due
today" row (`tasksDueBy()` from `taskStore.ts`, wrapped by
`components/home/todayAgenda.ts`).

---

## 6. Lead source

`LeadSource = 'knock' | 'storm' | 'referral' | 'web' | 'sign' | 'other'`
(`lib/models/types.ts`) with `LEAD_SOURCE_LABELS` and
`normalizeLeadSource()` folding every legacy spelling (`door_knock`,
`zillow`, `storm_alert`, …) onto the six canonical values.
`Lead.source` itself stays a free string for sync/back-compat — normalize at
the read site, same convention as `leadStageColumn()`.

Reports' "source → signed rate" and Pipeline's badges both read through
`normalizeLeadSource()`.

### Door-to-lead identity

`saveKnock.ts` reuses the active knock's explicit `createdLeadId` first,
or the archived knock's link when choosing **Knock again**, then an exact
normalized street address. A proximity fallback (15 m) may
reuse only one eligible lead, and only when at least one address is still
unknown. Different known street numbers or units never match merely because
their pins are close. Multiple eligible GPS candidates create a separate
lead rather than changing an arbitrary customer's stage, contact or reminder.
Existing explicit links remain authoritative after customer corrections.
An archived revisit logs a new knock with the same customer link and prior
history, leaving the archived visit unchanged; even a no-answer revisit
retains a valid link without changing the customer's Pipeline stage. A
deleted/missing customer on either an active edit or archived revisit falls
back to the guarded address/GPS match for lead-producing outcomes. Other
outcomes clear the stale link; neither path resurrects the deleted customer
or persists a dangling link.
This safeguard does not rewrite historical knocks or leads.

Regression check: `node tests/knock-lead-identity.cjs` exercises the save,
session and lead stores, and the resulting Pipeline projection in isolated
memory; it never adds test records to the app.
