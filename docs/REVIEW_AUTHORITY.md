# Authoritative swipe rejection

Reject validates the pending card against its original inspection, slope,
photo URI, attachment identity, analysis generation and applied findings/markers.
The raw model output remains the training example; a separate queue snapshot
records the confidence-gated evidence that actually reached the inspection.
An inspector edit, new analysis, missing/replaced attachment, finalized report
or ambiguous legacy provenance blocks the rejection with an actionable message.
Earlier-photo deletion may renumber the photo without changing its identity.

One inspection mutation removes the validated photo's markers and scoped
findings, recounts all marker categories and capture-mode hit totals, derives
functional damage again, updates the photo's finding count and invalidates the
stored report engine snapshot. The photo file and its analyzed status remain.
Other photos and their annotations/evidence remain intact. HAAG reports read
the reconciled state; already-exported documents are historical artifacts and
are not rewritten. Finalized inspections must be reopened before rejection.

The same inspection write stores the full correction audit under the queue
item ID. The service awaits inspection persistence, then idempotently projects
that audit into corrections, awaits it, marks the queue reviewed, and awaits
that final write before reporting success. Storage errors leave a retryable
card. If the app terminates between these writes, retrying Reject finishes the
projections from the committed audit without deleting new evidence or teaching
the same rejection twice. A partially saved rejection cannot be changed to
Accept/Skip/Correct from the stale card. New fields are optional; existing
storage keys and versions remain compatible, and inspection cloud sync already
carries the complete inspection payload. No photo files are deleted.

Legacy queue cards without an applied snapshot are accepted only when a
single-photo slope and exact matching original evidence prove ownership.
For records predating attachment IDs, the atomic rejection assigns identity
before migrating analysis metadata, preserving subject, shingle counts and
test-square coverage while clearing only the rejected damage count.
Ambiguous legacy findings are never guessed onto a photo. Such cards need a
review of current evidence in the photo editor.

Up-swipe correction and the general photo editor pin the attachment, current
markers, scoped findings and analysis generation before editing. Queue
corrections validate the original card again at save. Current-photo edits can
review newer evidence directly; ambiguous legacy ownership fails with a
request to analyze the current photos first. Edited categories replace stale
model findings with marker-derived counts and severity; other categories and
photos retain their evidence. Raw model output and applied before/after
evidence remain in the correction audit.

Corrections commit markers, findings, photo finding count, HAAG recount and
report-snapshot invalidation together with their audit in `photoCorrections`.
Inspection, correction and queue checkpoints must finish before the editor
returns success. Failed writes keep Save/Correct retryable. Hydration and
foreground recovery project committed audits without reapplying edits. The
queue return matches the exact correction and queue item, not the inspection
alone. Confidence stars also await their persistence checkpoint.

Both photo-log and slope-thumbnail report links carry attachment identity and
the original URI. Photo Report resolves that attachment on every render and
passes it through to the editor; a deleted attachment or an old index-only link
shows unavailable rather than choosing a neighbor, including duplicate URIs.

Every manual save writes explicit completed inspector-review metadata, including
the current marker count, even when AI has never analyzed the photo. Adding roof
markers transitions a conflicting non-roof/unidentifiable model subject to a
reviewed roof field. The original analysis metadata stays in the correction
audit; the report labels inspector review and treats any prior AI analysis as
historical. Starting another AI analysis clears the manual-review label.

Foreground correction recovery checks storage acknowledgement as well as
in-memory presence. A failed general-edit projection retries in the same process
and remains idempotent without requiring a pending queue card or a restart.

Run `node tests/review-authority.cjs` for production-source UI, store, report
HTML, learning, persistence-failure and process-restart coverage. With
`--baseline`, the old UI handler fails the authoritative hail-count assertion.
Physical-device gesture/force-quit behavior and cross-device cloud concurrency
still need integration verification; the existing cloud last-editor-wins
policy is unchanged.

Run `node tests/correction-provenance.cjs` for editor handler, exact-attachment,
HAAG/PDF, current-photo and queue corrections, stale/finalized-state, duplicate
URI, shifted-index, persistence-failure and restart cases. `--baseline` executes
the old editor's actual Save handler and fails because its deleted hail finding
survives in authoritative findings/report state.
