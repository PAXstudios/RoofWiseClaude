// Backup / Restore — serialize every Zustand store to one JSON blob and
// share it via the system share sheet. Restore reads a blob and rehydrates
// each store.

// SDK 54: the string-based API (readAsStringAsync/writeAsStringAsync/
// documentDirectory) lives under `/legacy`; the default export is the new
// File/Directory API. Migrating to it is backlogged.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { inspectionHydrationState, normalizeInspection, useInspectionStore, waitForInspectionHydration } from '../stores/inspectionStore';
import { flushLeadPersistence, leadHydrationState, useLeadStore, waitForLeadHydration } from '../stores/leadStore';
import { flushInspectionSyncPersistence, inspectionSyncHydrationState, waitForInspectionSyncHydration } from '../stores/inspectionSyncStore';
import { flushInspectionPersistence } from './inspectionPersistence';
import { useProposalStore } from '../stores/proposalStore';
import { useProposalLinkStore } from '../stores/proposalLinkStore';
import { useEstimateStore } from '../stores/estimateStore';
import { useServiceAreaStore } from '../stores/serviceAreaStore';
import { useStormAlertStore } from '../stores/stormAlertStore';
import { useKnockSessionStore } from '../stores/knockSessionStore';
import { useMileageStore } from '../stores/mileageStore';
import { useActivityStore } from '../stores/activityStore';
import { useCorrectionsStore } from '../stores/correctionsStore';
import { useTrainingQueueStore } from '../stores/trainingQueueStore';
import { useInspectorProfileStore } from '../stores/inspectorProfileStore';

export const BACKUP_VERSION = 1;

type Backup = {
  version: number;
  exportedAt: string;
  inspections: ReturnType<typeof useInspectionStore.getState>['inspections'];
  nextOrdinal: number;
  leads: ReturnType<typeof useLeadStore.getState>['leads'];
  proposals: ReturnType<typeof useProposalStore.getState>['proposals'];
  proposalLinks: ReturnType<typeof useProposalLinkStore.getState>['links'];
  estimates: ReturnType<typeof useEstimateStore.getState>['estimates'];
  serviceAreas: ReturnType<typeof useServiceAreaStore.getState>['areas'];
  stormAlerts: ReturnType<typeof useStormAlertStore.getState>['alerts'];
  knockArchive: ReturnType<typeof useKnockSessionStore.getState>['archive'];
  knockActive: ReturnType<typeof useKnockSessionStore.getState>['activeSession'];
  mileage: ReturnType<typeof useMileageStore.getState>['trips'];
  activity: ReturnType<typeof useActivityStore.getState>['events'];
  corrections: ReturnType<typeof useCorrectionsStore.getState>['corrections'];
  training: ReturnType<typeof useTrainingQueueStore.getState>['items'];
  inspectorProfile: ReturnType<typeof useInspectorProfileStore.getState>['profile'];
};

export function snapshot(): Backup {
  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    inspections: useInspectionStore.getState().inspections,
    nextOrdinal: useInspectionStore.getState().nextOrdinal,
    leads: useLeadStore.getState().leads,
    proposals: useProposalStore.getState().proposals,
    proposalLinks: useProposalLinkStore.getState().links,
    estimates: useEstimateStore.getState().estimates,
    serviceAreas: useServiceAreaStore.getState().areas,
    stormAlerts: useStormAlertStore.getState().alerts,
    knockArchive: useKnockSessionStore.getState().archive,
    knockActive: useKnockSessionStore.getState().activeSession,
    mileage: useMileageStore.getState().trips,
    activity: useActivityStore.getState().events,
    corrections: useCorrectionsStore.getState().corrections,
    training: useTrainingQueueStore.getState().items,
    inspectorProfile: useInspectorProfileStore.getState().profile,
  };
}

export async function exportBackup(): Promise<{ uri: string }> {
  const blob = snapshot();
  const json = JSON.stringify(blob, null, 2);
  const filename = `roofwise-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const uri = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/json',
      dialogTitle: 'RoofWise backup',
      UTI: 'public.json',
    });
  }
  return { uri };
}

export type RestoreSummary = {
  version: number;
  inspections: number;
  leads: number;
  proposals: number;
  estimates: number;
  corrections: number;
};

export async function restoreFromUri(uri: string): Promise<RestoreSummary> {
  const text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
  const blob = JSON.parse(text) as Backup;
  if (!blob || typeof blob.version !== 'number') {
    throw new Error('Not a valid RoofWise backup file');
  }
  if (blob.version > BACKUP_VERSION) {
    throw new Error(`Backup is from a newer app version (v${blob.version}). Update RoofWise first.`);
  }

  while (true) {
    const before = [inspectionHydrationState(), inspectionSyncHydrationState(), leadHydrationState()];
    await Promise.all([waitForInspectionHydration(), waitForInspectionSyncHydration(), waitForLeadHydration()]);
    const after = [inspectionHydrationState(), inspectionSyncHydrationState(), leadHydrationState()];
    if (after.every((state, index) => state.hydrated && state.promise === before[index].promise)) break;
  }

  useInspectionStore.setState((s) => ({
    inspections: blob.inspections?.map((ins) => normalizeInspection(ins as unknown as Record<string, unknown>)) ?? s.inspections,
    nextOrdinal: blob.nextOrdinal ?? s.nextOrdinal,
  }));
  useLeadStore.getState().replaceAll(blob.leads ?? []);
  useProposalStore.setState({ proposals: blob.proposals ?? [] });
  useProposalLinkStore.setState({ links: blob.proposalLinks ?? [] });
  useEstimateStore.setState({ estimates: blob.estimates ?? [] });
  useServiceAreaStore.setState({ areas: blob.serviceAreas ?? [] });
  useStormAlertStore.setState({ alerts: blob.stormAlerts ?? [] });
  useKnockSessionStore.setState({
    archive: blob.knockArchive ?? [],
    activeSession: blob.knockActive ?? null,
  });
  useMileageStore.setState((s) => ({ trips: blob.mileage ?? s.trips }));
  useActivityStore.setState({ events: blob.activity ?? [] });
  useCorrectionsStore.setState({ corrections: blob.corrections ?? [] });
  useTrainingQueueStore.setState({ items: blob.training ?? [] });
  if (blob.inspectorProfile) {
    useInspectorProfileStore.setState({ profile: blob.inspectorProfile });
  }

  await Promise.all([flushInspectionPersistence(), flushLeadPersistence(), flushInspectionSyncPersistence()]);

  return {
    version: blob.version,
    inspections: blob.inspections?.length ?? 0,
    leads: blob.leads?.length ?? 0,
    proposals: blob.proposals?.length ?? 0,
    estimates: blob.estimates?.length ?? 0,
    corrections: blob.corrections?.length ?? 0,
  };
}
