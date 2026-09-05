// App lifecycle hooks — wires Storm Watch polling, cloud syncs, and the
// analysis queue drain to AppState transitions. Imported once from the
// root layout.

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { checkStormWatch } from './stormWatch';
import { syncCorrections } from './correctionsSync';
import { recoverPhotoCorrections, startPhotoCorrectionRecovery } from './savePhotoCorrection';
import { syncLeads } from './leadSync';
import { syncInspections, startInspectionWatcher } from './inspectionSync';
import { syncKnocks, startKnockSyncWatcher } from './knockSync';
import { runPhotoSync } from './photoSync';
import { drainAnalysisQueue } from './analysisQueue';
import { useServiceAreaStore } from '../stores/serviceAreaStore';
import { useAuthStore } from '../auth/authStore';

const STORM_INTERVAL_MS = 30 * 60 * 1000;       // 30 minutes
const CORRECTIONS_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const LEADS_INTERVAL_MS = 5 * 60 * 1000;        // 5 minutes
const INSPECTIONS_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const KNOCKS_INTERVAL_MS = 5 * 60 * 1000;       // 5 minutes — sessions, doors, plans, do-not-knock
const PHOTOS_INTERVAL_MS = 2 * 60 * 1000;       // 2 minutes — uploads drain on their own clock

export function useBackgroundJobs() {
  const lastStormScan = useRef(0);
  const lastSync = useRef(0);
  const lastLeadsSync = useRef(0);
  const lastInspectionsSync = useRef(0);
  const lastKnocksSync = useRef(0);
  const lastPhotosSync = useRef(0);

  useEffect(() => {
    const stopCorrectionRecovery = startPhotoCorrectionRecovery();
    // The watcher observes real startup edits but ignores hydration applies;
    // inspection/lead sync entrypoints await their local hydration barriers.
    startInspectionWatcher();
    // Watches the knock-session, planner and do-not-knock stores: a route
    // end, a logged door or a plan change schedules a sync (20 s debounce),
    // and a plan or entry removed here is remembered as a soft-delete.
    startKnockSyncWatcher();

    const handle = (next: AppStateStatus) => {
      if (next === 'active') {
        const now = Date.now();
        if (
          useServiceAreaStore.getState().areas.length > 0 &&
          now - lastStormScan.current > STORM_INTERVAL_MS
        ) {
          lastStormScan.current = now;
          checkStormWatch().catch(() => {});
        }
        if (now - lastSync.current > CORRECTIONS_INTERVAL_MS) {
          lastSync.current = now;
          recoverPhotoCorrections().then(() => syncCorrections()).catch(() => {});
        }
        if (
          useAuthStore.getState().session &&
          now - lastLeadsSync.current > LEADS_INTERVAL_MS
        ) {
          lastLeadsSync.current = now;
          syncLeads().catch(() => {});
        }
        if (
          useAuthStore.getState().session &&
          now - lastInspectionsSync.current > INSPECTIONS_INTERVAL_MS
        ) {
          lastInspectionsSync.current = now;
          syncInspections().catch(() => {});
        }
        // Knocking data: unchanged rows are hash-skipped, so the cadence is
        // cheap; the run is a no-op without a session.
        if (
          useAuthStore.getState().session &&
          now - lastKnocksSync.current > KNOCKS_INTERVAL_MS
        ) {
          lastKnocksSync.current = now;
          syncKnocks({ reason: 'foreground' }).catch(() => {});
        }
        // Photo uploads used to run only on the tail of an inspection sync,
        // so a 40-photo job trickled up 8 per app-open. They drain on their
        // own clock now — `runPhotoSync` is a no-op with nothing pending —
        // and push the inspection payload themselves once URLs exist.
        if (
          useAuthStore.getState().session &&
          now - lastPhotosSync.current > PHOTOS_INTERVAL_MS
        ) {
          lastPhotosSync.current = now;
          runPhotoSync().catch(() => {});
        }
        // Resume any queued AI analysis the moment the app is usable again.
        drainAnalysisQueue().catch(() => {});
      }
    };

    // Fire once on mount
    handle('active');

    const sub = AppState.addEventListener('change', handle);
    return () => { sub.remove(); stopCorrectionRecovery(); };
  }, []);
}
