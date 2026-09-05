# Local sync mutation revisions

Inspection and lead sync retain the existing client-time, last-editor-wins
cloud policy. A local monotonic revision now identifies each record mutation
independently of the record ID and edit timestamp. Revision maps are persisted
additively under the existing storage keys and retained after acknowledgement
and deletion; older stored records start at revision zero. No SQL schema,
payload column, timestamp format or dependency changed.

Each push captures the payload, edit timestamp and local revision together
before the remote peek. Peek conflict resolution is valid only while that
revision remains current. Upsert success acknowledges only its exact captured
revision. An edit during peek, upsert, schema-compatibility retry or pull stays
pending and protects its payload from that run's remote responses. A subsequent
run reconciles/uploads it using the existing cloud policy. Concurrent callers
continue to share one in-flight run.

Inspection deletions keep their existing remote DELETE queue; acknowledgements
also compare revisions, including delete/recreate/delete of the same ID.
Persisted local deletion suppression prevents stale pulls from resurrecting a
record after its remote DELETE was acknowledged. Explicit local recreation
clears that suppression and advances the revision.

Lead deletion suppression is device-local and persists across runs/restarts.
Lead DELETE propagation and server tombstones were not added. A deleted lead
may still exist in the cloud or on another device; defining those semantics is
separate work. Lead backup restore now advances revisions for imported records
and records removals, so a held sync cannot undo the restored collection.
Device-only property enrichment is preserved when a remote lead is accepted.

Both sync entrypoints wait for the required business and sync-metadata stores
to hydrate and recheck their promise identities together immediately before
cloud work. A hydration queued in either store during the other store's read
extends the barrier. The inspection watcher subscribes before hydration microtasks,
tracks real startup edits/removals, and ignores the notification that applies
restored data. Business inspection hydration preserves records created before
its first read starts, as well as removals of IDs in a delayed saved snapshot.

Business inspection, lead and inspection-metadata hydration is serialized. Live per-record revision
authority wins over delayed snapshots, including acknowledgement and deletion
state. Loading a larger saved revision advances a concurrent local revision
past it. Startup writes stay in memory until the full stored collection is
merged; incomplete live collections never replace unread saved records. The
accepted merged snapshot is written in order before sync proceeds. Read/write
failure blocks cloud work and remains retryable.

The business inspection baseline advances only after its merged snapshot is
durable. Failed-checkpoint retries retain the original baseline and startup
mutations. After a complete durable first load, explicit rereads still allow
live edits to use their existing storage checkpoints. Removing an unread
inspection ID writes deletion intent directly to metadata; startup business
hydration consults that persisted intent before accepting saved records.

Backup replacement waits for all three hydration states to be simultaneously
stable. Completion awaits business inspection and lead writes plus an explicit
inspection-metadata checkpoint. Metadata failure reports an error; retry writes
the retained deletion intent even when the local collection is already empty.

`node tests/sync-mutation-races.cjs` executes production stores and sync modules
with held network boundaries and isolated persisted storage. It covers both
entities at peek/upsert/pull, same-millisecond edits, deletion/recreation,
concurrent callers, network failure/retry, missing-column compatibility retry,
clean uploads, legitimate remote conflicts, backup replacement and restart.
True asynchronous persistence tests additionally hold initial and overlapping
hydration reads, inject startup read/write failures, mutate before the first
read, retain saved neighbors and deletion suppression, and verify that hydration
does not cause a persistence loop or upload clean restored records as new edits.
`--baseline` executes HEAD's original sync/business-persistence files for the
original network-race matrix and demonstrates the prior lost-edit,
false-acknowledgement and resurrection failures. The added hydration probes run
against current production modules with true asynchronous storage boundaries.

This is local concurrency protection, not a cross-device compare-and-swap
protocol. Device clock skew and another device writing between peek and upsert
remain limitations of the existing cloud policy. The persisted restart tests
exercise accepted storage snapshots and injected storage failures; actual
iOS/Android force-quit behavior and live Supabase concurrency still require
integration proof.
