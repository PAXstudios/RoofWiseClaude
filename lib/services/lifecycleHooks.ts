// App lifecycle hooks — wires Storm Watch polling, cloud syncs, and the
// analysis queue drain to AppState transitions. Imported once from the
// root layout.

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { checkStormWatch } from './stormWatch';
import { syncCorrections } from './correctionsSync';
import { syncLeads } from './leadSync';
import { syncInspections, startInspectionWatcher } from './inspectionSync';
import { syncInspectionPhotos } from './photoSync';
import { drainAnalysisQueue } from './analysisQueue';
import { useServiceAreaStore } from '../stores/serviceAreaStore';
import { useAuthStore } from '../auth/authStore';

const STORM_INTERVAL_MS = 30 * 60 * 1000;       // 30 minutes
const CORRECTIONS_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const LEADS_INTERVAL_MS = 5 * 60 * 1000;        // 5 minutes
const INSPECTIONS_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes

export function useBackgroundJobs() {
  const lastStormScan = useRef(0);
  const lastSync = useRef(0);
  const lastLeadsSync = useRef(0);
  const lastInspectionsSync = useRef(0);

  useEffect(() => {
    startInspectionWatcher();

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
          syncCorrections().catch(() => {});
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
          syncInspections()
            .then(() => syncInspectionPhotos())
            .catch(() => {});
        }
        // Resume any queued AI analysis the moment the app is usable again.
        drainAnalysisQueue().catch(() => {});
      }
    };

    // Fire once on mount
    handle('active');

    const sub = AppState.addEventListener('change', handle);
    return () => sub.remove();
  }, []);
}
