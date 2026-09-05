# Capture durability

New camera and library photos pass through the existing JPEG profile ladder,
then copy into `documentDirectory/photo-evidence/`. Quick Inspection requests
temporary normalization output and lets its staging transaction own that copy;
other normalization callers keep their durable-output default. A verified nonempty copy is
required before acceptance; a copy failure does not return the disposable URI
as a successful result. The source is never moved or deleted. SDK 57's installed
`expo-file-system/legacy` documents that document files persist until explicitly
deleted while cache files may be reclaimed by the OS.

Quick Inspection writes an awaited version-1 AsyncStorage reservation before
creating any durable photo file. It contains a uniquely owned final URI and
temporary URI, original source and exposure context, destination, import
provenance, and a reserved ID for a new standalone job.
Every asset from a standalone library batch shares that reservation. The journal
is serialized across route instances, never popped on read, and rejects unknown
or corrupt storage rather than overwriting it with an empty list.

Copying begins only after reservation persistence is confirmed. Bytes go to the
owned `.partial` path, are verified there, then move to the final path in the
same directory. SDK 57's installed legacy implementations use iOS FileManager
move and Android `renameTo` for these local paths. Final-path existence is thus
the completion marker; a ready journal commit follows the move. The input and
reused durable evidence are never cleanup targets. Observer failures cannot
turn a committed reservation into an apparent failure.

After termination before/during copying, the journal still owns both paths.
Recovery recopies unfinished temporary bytes from the original; it never accepts
them merely because they are nonempty. If the original is unavailable, the
capture remains explicitly unfiled and can be discarded. After termination
following the verified move but before the ready commit, recovery verifies and
reuses the same final URI, even if its source cache has disappeared. An initial
reservation-write failure creates no new file. Legacy retention errors and old
journal entries from earlier rounds remain supported rather than being reset.

The save order is reservation → copy/verify/move → ready journal →
create/reuse destination → attach/reuse URI →
collateral/review/analysis handoff → ordered inspection persistence checkpoint →
journal retirement. Storage failure leaves the retry record in place. A retry
uses the actual saved slope; it cannot silently move or duplicate evidence.
Cancel cannot discard an already-attached photo. Explicit cancellation of an
unattached photo persists discard intent, deletes only its owned temporary/final
files, then retires the journal. Restart can finish interrupted cleanup. A stale
filing write cannot clear a persisted discard request. Reused input files remain
owned by their original consumers and are never deleted by this transaction.

Recovery waits for inspection hydration before presenting the slope question.
An unreadable journal blocks new captures with a Retry alert. Camera re-entry
matches the destination or original standalone entry point; no hidden job is
created by route teardown. On process start, queued/analyzing photo intent from
hydrated inspections rejoins the existing analysis queue once. A recovered
photo already completed or owned by that queue does not start a second live pass.
Live camera analysis also holds shared URI ownership from enqueue through batch
completion. A filing retry cannot enqueue the same photo while it is waiting or
running, even across route remount. Teardown releases unstarted queued work;
active requests retain ownership until their completion/failure cleanup.

The existing inspection storage key, version, schema, photo URI keys, upload
map and sync payload stay compatible. No dependency or Expo configuration changed.
Existing cache-backed photos are preserved as-is: bulk relocation requires
migrating references in corrections, training, uploads, reports and queues and
is separate tracked work. Missing older originals cannot be reconstructed here.
Completed evidence is conservatively retained when records are deleted until
reference-aware cleanup exists; files are not deleted while another consumer
may still own them. A crash before reservation persistence creates no owned
durable file; temporary capture data before that boundary, OS app-data clearing
and uninstall are not recoverable by this local mechanism.

Run `node tests/capture-evidence.cjs` for fault-injected production-source tests.
Native verification still needs actual iOS/Android capture/import, OS cache
purge, force-quit at reservation/copy/verified-move boundaries, while confirming
a slope and while analysis is running, reopen,
and confirmation that each photo/job appears once and queued analysis resumes.
