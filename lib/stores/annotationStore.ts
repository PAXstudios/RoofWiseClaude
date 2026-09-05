// Drawings belong to an attachment, never to a mutable array index or URI.
// Legacy URI records remain intact as audit data when ownership is uncertain.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isAnnotation, type Annotation, type PhotoAnnotations } from '../models/annotations';
import { annotationStorage, flushAnnotationPersistence } from '../services/annotationPersistence';
import { useInspectionStore } from './inspectionStore';

const EMPTY: readonly Annotation[] = Object.freeze([]);
type Persisted = {
  byUri: Record<string, PhotoAnnotations>;
  byAttachment: Record<string, PhotoAnnotations>;
  /** Frozen legacy ownership; null means quarantined, never eligible for reuse. */
  legacyOwners: Record<string, string | null>;
};
type AnnotationStoreState = Persisted & {
  attachmentRevision: number;
  get: (uri: string, attachmentId?: string) => readonly Annotation[];
  getRecord: (uri: string, attachmentId?: string) => PhotoAnnotations | undefined;
  set: (uri: string, items: readonly Annotation[], size?: { imageW: number; imageH: number }, attachmentId?: string) => Promise<boolean>;
  clear: (uri: string, attachmentId?: string) => Promise<boolean>;
  flush: () => Promise<void>;
  count: (uri: string, attachmentId?: string) => number;
};
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function normalizeRecords(raw: unknown): Record<string, PhotoAnnotations> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([key, record]) => {
    if (!isRecord(record)) return [];
    const items = Array.isArray(record.items) ? record.items.filter(isAnnotation) : [];
    if (!items.length) return [];
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    return [[key, { uri: typeof record.uri === 'string' ? record.uri : key, items,
      imageW: num(record.imageW), imageH: num(record.imageH),
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString() }]];
  }));
}
function normalize(raw: unknown): Persisted {
  const value = isRecord(raw) ? raw : {};
  return { byUri: normalizeRecords(value.byUri), byAttachment: normalizeRecords(value.byAttachment),
    legacyOwners: isRecord(value.legacyOwners) ? Object.fromEntries(Object.entries(value.legacyOwners).filter(([, owner]) => owner === null || typeof owner === 'string')) as Persisted['legacyOwners'] : {} };
}
function liveOwners(uri: string): string[] {
  return useInspectionStore.getState().inspections.flatMap((inspection) => inspection.slopes.flatMap((slope) =>
    slope.photoPaths.flatMap((path, index) => path === uri && slope.photoAttachmentIds?.[index] ? [slope.photoAttachmentIds[index]] : [])));
}
function targetId(uri: string, attachmentId?: string): string | undefined {
  const owners = liveOwners(uri);
  if (attachmentId) return owners.filter((id) => id === attachmentId).length === 1 ? attachmentId : undefined;
  return owners.length === 1 ? owners[0] : undefined;
}
let hydrationBaseline: Persisted = { byUri: {}, byAttachment: {}, legacyOwners: {} };
type DrawingMutation = { revision: number; pending: boolean; uri: string; items: Annotation[]; size?: { imageW: number; imageH: number }; updatedAt: string };
const mutations = { byUri: new Map<string, DrawingMutation>(), byAttachment: new Map<string, DrawingMutation>() };
let mutationRevision = 0;
let hydrationRevision = 0;
function applyMutation(records: Record<string, PhotoAnnotations>, key: string, mutation: DrawingMutation): void {
  if (!mutation.items.length) { delete records[key]; return; }
  records[key] = { uri: mutation.uri, items: mutation.items,
    imageW: mutation.size?.imageW ?? records[key]?.imageW ?? 0,
    imageH: mutation.size?.imageH ?? records[key]?.imageH ?? 0, updatedAt: mutation.updatedAt };
}
export const useAnnotationStore = create<AnnotationStoreState>()(persist((set, get) => ({
  byUri: {}, byAttachment: {}, legacyOwners: {}, attachmentRevision: 0,
  get: (uri, attachmentId) => get().getRecord(uri, attachmentId)?.items ?? EMPTY,
  getRecord: (uri, attachmentId) => {
    const id = targetId(uri, attachmentId);
    if (id) {
      const record = get().byAttachment[id];
      return record?.uri === uri ? record : undefined;
    }
    // Standalone photos retain the URI API. Never fall back for a removed
    // explicit target or an ambiguous live URI.
    return !attachmentId && liveOwners(uri).length === 0 ? get().byUri[uri] : undefined;
  },
  set: async (uri, items, size, attachmentId) => {
    const id = targetId(uri, attachmentId);
    if ((!id && attachmentId) || (!id && liveOwners(uri).length > 0)) return false;
    const field = id ? 'byAttachment' : 'byUri';
    const key = id ?? uri;
    const mutation = { revision: ++mutationRevision, pending: true, uri, items: items.filter(isAnnotation), size, updatedAt: new Date().toISOString() };
    mutations[field].set(key, mutation);
    // Do not write an incomplete initial snapshot over unread neighbor data.
    // The merge applies this revision, including an absent-record clear.
    if (!useAnnotationStore.persist.hasHydrated()) {
      await hydrationTail;
      if (!useAnnotationStore.persist.hasHydrated()) await useAnnotationStore.persist.rehydrate();
      if (!useAnnotationStore.persist.hasHydrated()) throw new Error('Existing drawings could not be loaded. Retry saving.');
    }
    if (mutations[field].get(key) !== mutation) { await flushAnnotationPersistence(); return false; }
    if (id && targetId(uri, id) !== id) return false;
    set((state) => {
      const records = { ...state[field] };
      applyMutation(records, key, mutation);
      return { [field]: records, legacyOwners: { ...state.legacyOwners, [uri]: null } };
    });
    await flushAnnotationPersistence();
    mutation.pending = false;
    // Storage may acknowledge after removal/replacement. Retain the persisted
    // orphan as audit, but never tell the editor it saved a live attachment.
    return mutations[field].get(key) === mutation && (!id || targetId(uri, id) === id);
  },
  clear: (uri, attachmentId) => get().set(uri, [], undefined, attachmentId),
  flush: flushAnnotationPersistence,
  count: (uri, attachmentId) => get().get(uri, attachmentId).length,
}), {
  name: 'roofwise.annotations.v1', version: 2, storage: createJSONStorage(() => annotationStorage),
  skipHydration: true, migrate: normalize,
  merge: (raw, current) => {
    const saved = normalize(raw);
    // A slow storage read cannot undo a drawing edit or clearing made while
    // it was in flight. In particular, absence after clear is a real edit.
    for (const field of ['byUri', 'byAttachment'] as const) {
      for (const key of new Set([...Object.keys(hydrationBaseline[field]), ...Object.keys(current[field])])) {
        if (JSON.stringify(current[field][key]) === JSON.stringify(hydrationBaseline[field][key])) continue;
        if (current[field][key]) saved[field][key] = current[field][key];
        else delete saved[field][key];
      }
    }
    const legacyOwners = { ...saved.legacyOwners };
    for (const [uri, owner] of Object.entries(current.legacyOwners)) {
      legacyOwners[uri] = uri in legacyOwners && legacyOwners[uri] !== owner ? null : owner;
    }
    for (const field of ['byUri', 'byAttachment'] as const) for (const [key, mutation] of mutations[field]) {
      if (!mutation.pending && mutation.revision <= hydrationRevision) continue;
      applyMutation(saved[field], key, mutation);
      legacyOwners[mutation.uri] = null;
    }
    return { ...current, byUri: saved.byUri, byAttachment: saved.byAttachment, legacyOwners };
  },
  onRehydrateStorage: (state) => { hydrationBaseline = normalize(state); hydrationRevision = mutationRevision; },
  partialize: ({ byUri, byAttachment, legacyOwners }): Persisted => ({ byUri, byAttachment, legacyOwners }),
}));

/** Observe from boot, before removal/replacement erases an owner. Orphan
 * drawings and ambiguous legacy records survive without becoming overlays.
 * Runs after either store hydrates, in either order. */
let observedOwners: Persisted['legacyOwners'] = {};
let lastLiveSignature = '';
function reconcileAnnotations(): void {
  const state = useAnnotationStore.getState();
  const live = new Map<string, string[]>();
  const historical = new Set<string>();
  for (const inspection of useInspectionStore.getState().inspections) for (const slope of inspection.slopes) {
    slope.photoPaths.forEach((uri, index) => {
      const id = slope.photoAttachmentIds?.[index];
      if (id) live.set(uri, [...(live.get(uri) ?? []), id]);
    });
    for (const evidence of slope.historicalPhotoEvidence ?? []) if (evidence.photoPath) historical.add(evidence.photoPath);
  }
  const ready = useInspectionStore.persist.hasHydrated() && useAnnotationStore.persist.hasHydrated();
  const legacyOwners = { ...state.legacyOwners };
  for (const [uri, owner] of Object.entries(observedOwners)) {
    legacyOwners[uri] = uri in legacyOwners && legacyOwners[uri] !== owner ? null : owner;
  }
  const byAttachment = { ...state.byAttachment };
  for (const uri of new Set([...live.keys(), ...Object.keys(state.byUri)])) {
    const owners = live.get(uri) ?? [];
    const owner = owners.length === 1 && !historical.has(uri) ? owners[0] : null;
    if (!(uri in legacyOwners)) {
      if (owners.length || ready) legacyOwners[uri] = owner;
    } else if (owners.length && legacyOwners[uri] !== owner) legacyOwners[uri] = null;
    const accepted = legacyOwners[uri];
    if (ready && accepted && owners.length === 1 && owners[0] === accepted && state.byUri[uri] && !byAttachment[accepted]) {
      byAttachment[accepted] = state.byUri[uri];
    }
  }
  observedOwners = legacyOwners;
  // Do not persist the empty initial store over a still-unread legacy record.
  if (!useAnnotationStore.persist.hasHydrated()) return;
  const liveSignature = JSON.stringify([...live]);
  if (liveSignature !== lastLiveSignature || JSON.stringify(legacyOwners) !== JSON.stringify(state.legacyOwners) || Object.keys(byAttachment).length !== Object.keys(state.byAttachment).length) {
    lastLiveSignature = liveSignature;
    useAnnotationStore.setState({ legacyOwners, byAttachment, attachmentRevision: state.attachmentRevision + 1 });
  }
}
useInspectionStore.subscribe(reconcileAnnotations);
useInspectionStore.persist.onFinishHydration(reconcileAnnotations);
useAnnotationStore.persist.onFinishHydration(() => {
  reconcileAnnotations();
  const { byUri, byAttachment, legacyOwners } = useAnnotationStore.getState();
  void annotationStorage.setItem('roofwise.annotations.v1', JSON.stringify({ version: 2, state: { byUri, byAttachment, legacyOwners } }));
});
reconcileAnnotations();
const hydrateAnnotations = useAnnotationStore.persist.rehydrate;
let hydrationTail: Promise<void> = Promise.resolve();
useAnnotationStore.persist.rehydrate = () => {
  const run = hydrationTail.then(async () => { await hydrateAnnotations(); await flushAnnotationPersistence(); });
  hydrationTail = run.catch(() => {});
  return run;
};
void Promise.resolve(useAnnotationStore.persist.rehydrate()).catch(() => {});

export function useAnnotationsFor(uri: string | undefined, attachmentId?: string): readonly Annotation[] {
  return useAnnotationStore((state) => uri ? state.get(uri, attachmentId) : EMPTY);
}
