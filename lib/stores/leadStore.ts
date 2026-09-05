import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSyncPersistence } from '../services/syncPersistence';
import type {
  Lead,
  LeadStage,
  PropertyRecord,
} from '../models/types';
import { LEAD_STAGE_ORDER } from '../models/types';

let counter = 0;

function newId(): string {
  return `lead_${Date.now()}_${counter++}`;
}

/**
 * Fire a pipeline event without a hard top-level import — `automations.ts`
 * imports this store, so a static import back would be circular. Lazy
 * `require` resolves after both modules have finished loading and is a
 * silent no-op if the automation module is absent (a bare-store Node test).
 */
function emitPipeline(e: import('../services/automations').PipelineEvent): void {
  try {
    (require('../services/automations') as typeof import('../services/automations')).emitPipelineEvent(e);
  } catch {
    // best effort — a store write must never fail because of it
  }
}

/**
 * Contact fields editable from the lead screen — what a door-knock lead
 * ("Walk-in lead" at a bare GPS pair) needs before it is a real customer.
 */
export type LeadDetailsPatch = Partial<
  Pick<Lead, 'customerName' | 'customerPhone' | 'customerEmail' | 'address' | 'lat' | 'lng'>
>;

type LeadStoreState = {
  leads: Lead[];
  revisions: Record<string, number>;
  /** Device-local deletion intent; cloud tombstone propagation is separate. */
  deleted: Record<string, number>;

  create: (input: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => Lead;
  upsert: (lead: Lead) => Lead;
  /** Backup restore is a local replacement, including removals. */
  replaceAll: (leads: Lead[]) => void;
  /**
   * Move the stage. `by` says who moved it (default `'roofer'` — every
   * existing call site is a hand move); the automation engine passes
   * `'automation'`. A no-op (same stage) writes nothing and emits nothing —
   * the loop guard docs/PIPELINE.md relies on: a rule's own stage change can
   * never re-trigger itself through an emitted no-op.
   */
  setStage: (id: string, stage: LeadStage, by?: import('../services/automations').StageChangedBy) => void;
  /**
   * Correct name / phone / email / address on an existing lead. Keys present
   * in `patch` are written as given (`undefined` clears an optional field);
   * absent keys are untouched. Stamps `updatedAt` + `syncStatus: 'pending'`
   * like every other mutator so the next push carries it.
   */
  updateDetails: (id: string, patch: LeadDetailsPatch) => void;
  /** Attach the Zillow record (does not touch updatedAt — it is not the roofer's edit). */
  setPropertyRecord: (id: string, record: PropertyRecord) => void;
  setFollowUp: (id: string, followUpAt: string | undefined) => void;
  setStormMatch: (id: string, match: Lead['lastStormMatch']) => void;
  /**
   * Point the lead at the inspection it became (the New Job wizard calls
   * this right after `inspectionStore.create`, which stamps the reverse
   * `Inspection.leadId`). `undefined` unlinks — e.g. the job was deleted.
   */
  linkInspection: (id: string, inspectionId: string | undefined) => void;
  markSynced: (revisions: Record<string, number>) => void;
  /** Apply a peek only at its captured revision, or a pull only to clean state. */
  applyRemote: (lead: Lead, expectedRevision?: number) => boolean;
  remove: (id: string) => void;
  countByStage: () => Record<LeadStage, number>;
  pending: () => Lead[];
};

/** Records and local mutation state; every action is rebuilt on load. */
type Persisted = { leads: Lead[]; revisions: Record<string, number>; deleted: Record<string, number> };

/**
 * Bump whenever the persisted shape changes, and teach `migrate` the new
 * field at the same time. zustand DROPS a stored blob whose version does not
 * match and no migrate function handles it — for this store that would be
 * the whole pipeline.
 */
const PERSIST_VERSION = 2;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Fill every field the current shape REQUIRES with its neutral default when
 * a stored record predates it. Nothing the roofer typed is rewritten and
 * nothing is invented: `new` is the one stage that claims nothing happened,
 * and a record with unknown sync state is treated as not yet in the cloud —
 * one extra upload beats assuming it is safe.
 */
function migrateLeads(persisted: unknown): Persisted {
  const raw = isRecord(persisted) ? persisted : {};
  const list = Array.isArray(raw.leads) ? raw.leads.filter(isRecord) : [];
  return {
    revisions: isRecord(raw.revisions) ? raw.revisions as Record<string, number> : {},
    deleted: isRecord(raw.deleted) ? raw.deleted as Record<string, number> : {},
    leads: list.map((l) => ({
      ...(l as unknown as Lead),
      customerName: typeof l.customerName === 'string' ? l.customerName : '',
      address: typeof l.address === 'string' ? l.address : '',
      stage: typeof l.stage === 'string' ? (l.stage as LeadStage) : 'new',
      syncStatus:
        l.syncStatus === 'synced' || l.syncStatus === 'failed' ? l.syncStatus : 'pending',
    })),
  };
}

function advanceRevision(s: LeadStoreState, id: string) {
  const { [id]: _restored, ...deleted } = s.deleted;
  return { revisions: { ...s.revisions, [id]: (s.revisions[id] ?? 0) + 1 }, deleted };
}

const persistence = createSyncPersistence();
const persistedSlice = (s: LeadStoreState): Persisted => ({ leads: s.leads, revisions: s.revisions, deleted: s.deleted });

function mergeHydration(persisted: unknown, current: LeadStoreState): LeadStoreState {
  const loaded = migrateLeads(persisted);
  const byId = new Map(loaded.leads.map((lead) => [lead.id, lead]));
  const revisions = { ...Object.fromEntries(loaded.leads.map((lead) => [lead.id, 0])), ...loaded.revisions };
  const deleted = { ...loaded.deleted };
  for (const [id, revision] of Object.entries(current.revisions)) {
    revisions[id] = (revisions[id] ?? 0) > revision ? revisions[id] + 1 : revision;
    const live = current.leads.find((lead) => lead.id === id);
    if (live) byId.set(id, live); else byId.delete(id);
    if (current.deleted[id]) deleted[id] = revisions[id]; else delete deleted[id];
  }
  for (const id of Object.keys(deleted)) byId.delete(id);
  return { ...current, leads: [...byId.values()], revisions, deleted };
}

export const useLeadStore = create<LeadStoreState>()(
  persist(
    (set, get) => ({
      leads: [],
      revisions: {},
      deleted: {},

      create: (input) => {
        const now = new Date().toISOString();
        const lead: Lead = {
          ...input,
          id: newId(),
          createdAt: now,
          updatedAt: now,
          syncStatus: 'pending',
        };
        set((s) => ({ leads: [lead, ...s.leads], ...advanceRevision(s, lead.id) }));
        emitPipeline({ type: 'lead_created', leadId: lead.id });
        return lead;
      },

      upsert: (lead) => {
        lead = { ...lead, syncStatus: 'pending' };
        set((s) => ({
          ...advanceRevision(s, lead.id),
          leads: s.leads.some((l) => l.id === lead.id)
            ? s.leads.map((l) => (l.id === lead.id ? lead : l))
            : [lead, ...s.leads],
        }));
        return lead;
      },

      replaceAll: (leads) => set((s) => {
        const revisions = { ...s.revisions };
        const deleted = { ...s.deleted };
        const incomingIds = new Set(leads.map((lead) => lead.id));
        for (const id of new Set([...s.leads.map((lead) => lead.id), ...incomingIds])) {
          revisions[id] = (revisions[id] ?? 0) + 1;
          if (incomingIds.has(id)) delete deleted[id];
          else deleted[id] = revisions[id];
        }
        return { leads: leads.map((lead) => ({ ...lead, syncStatus: 'pending' as const })), revisions, deleted };
      }),

      setStage: (id, stage, by = 'roofer') => {
        const current = get().leads.find((l) => l.id === id);
        // No-op: neither writes nor emits. This is the loop guard's floor —
        // the automation engine's own forward-only check means a rule that
        // re-evaluates its own move always lands here.
        if (!current || current.stage === stage) return;
        const now = new Date().toISOString();
        set((s) => ({
          ...advanceRevision(s, id),
          leads: s.leads.map((l) =>
            l.id === id
              ? {
                  ...l,
                  stage,
                  // Stamped alongside updatedAt so the board can measure time
                  // in stage rather than time since any edit.
                  stageChangedAt: now,
                  updatedAt: now,
                  syncStatus: 'pending',
                }
              : l,
          ),
        }));
        emitPipeline({ type: 'stage_changed', leadId: id, from: current.stage, to: stage, by });
      },

      setPropertyRecord: (id, record) =>
        set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, propertyRecord: record } : l)) })),

      updateDetails: (id, patch) =>
        set((s) => ({
          ...(s.leads.some((l) => l.id === id) ? advanceRevision(s, id) : {}),
          leads: s.leads.map((l) =>
            l.id === id
              ? {
                  ...l,
                  ...patch,
                  updatedAt: new Date().toISOString(),
                  syncStatus: 'pending',
                }
              : l,
          ),
        })),

      setFollowUp: (id, followUpAt) =>
        set((s) => ({
          ...(s.leads.some((l) => l.id === id) ? advanceRevision(s, id) : {}),
          leads: s.leads.map((l) =>
            l.id === id
              ? {
                  ...l,
                  followUpAt,
                  updatedAt: new Date().toISOString(),
                  syncStatus: 'pending',
                }
              : l,
          ),
        })),

      setStormMatch: (id, match) => {
        set((s) => ({
          ...(s.leads.some((l) => l.id === id) ? advanceRevision(s, id) : {}),
          leads: s.leads.map((l) =>
            l.id === id
              ? {
                  ...l,
                  lastStormMatch: match,
                  updatedAt: new Date().toISOString(),
                  syncStatus: 'pending',
                }
              : l,
          ),
        }));
        // Only a real match (never a clear) triggers rule 7's "Call about
        // the storm" task.
        if (match) emitPipeline({ type: 'storm_matched_lead', leadId: id, match });
      },

      linkInspection: (id, inspectionId) =>
        set((s) => ({
          ...(s.leads.some((l) => l.id === id) ? advanceRevision(s, id) : {}),
          leads: s.leads.map((l) =>
            l.id === id
              ? {
                  ...l,
                  inspectionId,
                  updatedAt: new Date().toISOString(),
                  syncStatus: 'pending',
                }
              : l,
          ),
        })),

      markSynced: (revisions) =>
        set((s) => ({
          leads: s.leads.map((l) => (revisions[l.id] === (s.revisions[l.id] ?? 0) && !s.deleted[l.id]
            ? { ...l, syncStatus: 'synced' } : l)),
        })),

      applyRemote: (lead, expectedRevision) => {
        let applied = false;
        set((s) => {
          const local = s.leads.find((l) => l.id === lead.id);
          if (s.deleted[lead.id] || (expectedRevision === undefined
            ? local && local.syncStatus !== 'synced'
            : (s.revisions[lead.id] ?? 0) !== expectedRevision)) return s;
          applied = true;
          const merged = { ...lead, propertyRecord: local?.propertyRecord ?? lead.propertyRecord, syncStatus: 'synced' as const };
          return {
            leads: local ? s.leads.map((l) => l.id === lead.id ? merged : l) : [merged, ...s.leads],
            revisions: { ...s.revisions, [lead.id]: s.revisions[lead.id] ?? 0 },
          };
        });
        return applied;
      },

      remove: (id) =>
        set((s) => ({
          leads: s.leads.filter((l) => l.id !== id),
          revisions: { ...s.revisions, [id]: (s.revisions[id] ?? 0) + 1 },
          deleted: { ...s.deleted, [id]: (s.revisions[id] ?? 0) + 1 },
        })),

      countByStage: () => {
        // Seeded so every board column reads a number, not undefined. Counts
        // are by raw stage — fold the legacy `proposal_sent` at the read site
        // with `leadStageColumn()`.
        const out: Record<string, number> = {};
        for (const stage of LEAD_STAGE_ORDER) out[stage] = 0;
        for (const l of get().leads) out[l.stage] = (out[l.stage] ?? 0) + 1;
        return out as Record<LeadStage, number>;
      },

      pending: () => get().leads.filter((l) => l.syncStatus !== 'synced'),
    }),
    {
      name: 'roofwise.leads.v1',
      storage: createJSONStorage(() => persistence.storage),
      version: PERSIST_VERSION,
      skipHydration: true,
      merge: mergeHydration,
      migrate: (persisted) => migrateLeads(persisted),
      partialize: persistedSlice,
    },
  ),
);

const hydrate = useLeadStore.persist.rehydrate;
let hydrationTail: Promise<void> = Promise.resolve();
useLeadStore.persist.rehydrate = () => {
  const run = hydrationTail.catch(() => {}).then(async () => {
    persistence.beginHydration();
    try {
      await hydrate();
      if (!useLeadStore.persist.hasHydrated()) throw new Error('Local leads could not be loaded. Retry.');
      await persistence.finishHydration('roofwise.leads.v1', JSON.stringify({ state: persistedSlice(useLeadStore.getState()), version: PERSIST_VERSION }));
    } catch (error) { persistence.failHydration(error); throw error; }
  });
  hydrationTail = run;
  return run;
};

export async function waitForLeadHydration(): Promise<void> {
  while (true) {
    const observed = hydrationTail;
    try { await observed; }
    catch { await (observed === hydrationTail ? useLeadStore.persist.rehydrate() : hydrationTail); continue; }
    if (observed === hydrationTail && useLeadStore.persist.hasHydrated()) return;
  }
}
export async function flushLeadPersistence(): Promise<void> { await persistence.flush(); }
export function leadHydrationState() {
  return { promise: hydrationTail, hydrated: useLeadStore.persist.hasHydrated() };
}
void Promise.resolve(useLeadStore.persist.rehydrate()).catch(() => {});
