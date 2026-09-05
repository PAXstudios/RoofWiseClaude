# Booked door appointments

The pin sheet requires a valid calendar date and local clock time for Booked.
Date presets and large hour buttons are available; YYYY-MM-DD and HH:MM
fields allow other dates and minute precision. Existing Booked visits retain
their exact timestamp, including seconds and the original offset in a repeated
daylight-saving hour, until the date or time field actually changes. Impossible calendar dates, invalid clocks, and local
times skipped by daylight saving changes cannot save. The write path also
rejects missing, date-only and invalid timestamps before changing any store.

With `knock_booked_job` enabled, a booking creates one linked scheduled
inspection or updates the linked inspection's `scheduledAt` while it is still
scheduled. Explicit lead links win over other inspections for the lead.
The store rechecks status at mutation time. In-progress, complete and
report-finalized inspections retain their schedule and status; a Booked revisit
also preserves their lead stage and follow-up and visibly reports that the
appointment was not changed. The visit remains recorded.

Automation toggles retain their existing meaning: disabling this rule disables
automatic inspection creation/rebooking. A lead follow-up is still recorded
by the knock save. No external messages or calendar invitations are sent.

Home and Plan place scheduled inspections on their actual appointment date
and time, not their creation date. Day and week windows end at the next local
calendar boundary so 23- and 25-hour daylight-saving days remain complete.
A lead reminder at that same time and
explicitly linked to that inspection is represented once by the inspection.
A differently dated reminder remains separate. Pipeline's next action and
Plan's week rows include the clock time. Historical records are not rewritten.

`node tests/knock-booking.cjs` runs the real save path, automation engine,
inspection/lead stores, Pipeline projection, agenda functions and pin-sheet
button/input handlers in isolated memory. No fixtures enter user storage.
Physical-device keyboard/layout and native persistence/sync remain device checks.
