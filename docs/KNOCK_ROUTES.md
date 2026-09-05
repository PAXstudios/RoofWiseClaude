# Knock routes — adding areas and recovering location

`knockSessionStore.setRouteTarget` means **visit this area now**. It inserts
the chosen area at the current position in `routeStops`, updates
`currentStopIndex` and `routeTarget` together, and keeps the previous current
stop and remaining stops immediately afterward. **Next** continues that
remaining route. Choosing an area already present at the same coordinates
and radius moves that stop rather than adding a duplicate. Existing stop
metadata, session identity, doors, track, archive and mileage ownership stay
intact. A legacy single-target session is promoted to the same stop list.

Both the plan's individual-area action and the storm-alert action use this
store operation. Starting a whole planned day retains the existing explicit
replacement behavior through `setRouteStops`. Door Knocking recentres when
the current stop changes, including when an area was selected while its
screen was already mounted.

The plan and map may save a route when location access is denied. An active
session is therefore not evidence of working GPS. Door Knocking shows the
location recovery card for `denied`, `denied_forever` and `unavailable`,
whether or not a route exists:

- **Retry location** restarts the existing watcher without creating or
  replacing a session. Hard denial does not repeat an OS permission prompt.
- Native **Open Settings** opens device settings; returning users can retry.
  Web explains browser site permissions and retains Retry.
- With a real map extent and active route, **Continue with map taps** keeps
  manually chosen house coordinates available. Without an extent, the card
  offers **Choose an area on Map**. No location is invented.
- GPS **Pin here** needs granted permission and a fix at most 30 seconds old,
  checked again when pressed. Retained fixes remain unusable after permission
  recovers until they meet this freshness gate. Future, invalid and nonpositive
  timestamps (including device-clock anomalies) cannot create GPS pins. The
  tracker preserves absent, null or nonnumeric native timestamps as unknown;
  it never substitutes receipt time as the observation time. The
  footer says **Waiting for fresh GPS** while manual map taps remain available.
  Manual pins do not count as walked miles.

Once permission and the watcher recover, the first GPS fix starts a route
mileage trip or adopts a manually started trip. Recovery preserves every
stop and knock. Ending an adopted trip's route leaves that trip running.
Tracking remains foreground-only; these changes do not claim background GPS
or provide offline basemap tiles.

Verification: `node tests/knock-route-integrity.cjs` executes production
stores, tracker, PlanView handlers and the Door Knocking footer against
isolated storage and simulated OS location. It covers route insertion,
single-target promotion, repeated selection, saved denial, 18 recovery UI
states, manual-pin routing, restored/failed watchers, and owned/adopted
mileage. Native permission dialogs, map gestures and small-screen layout
remain an on-device verification gate.
