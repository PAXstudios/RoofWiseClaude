import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

  create: (input: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => Lead;
  upsert: (lead: Lead) => Lead;
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
  markSynced: (ids: string[]) => void;
  remove: (id: string) => void;
  countByStage: () => Record<LeadStage, number>;
  pending: () => Lead[];
};

/** The persisted slice — the records only; every action is rebuilt on load. */
type Persisted = { leads: Lead[] };

/**
 * Bump whenever the persisted shape changes, and teach `migrate` the new
 * field at the same time. zustand DROPS a stored blob whose version does not
 * match and no migrate function handles it — for this store that would be
 * the whole pipeline.
 */
const PERSIST_VERSION = 1;

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

export const useLeadStore = create<LeadStoreState>()(
  persist(
    (set, get) => ({
      leads: [],

      create: (input) => {
        const now = new Date().toISOString();
        const lead: Lead = {
          ...input,
          id: newId(),
          createdAt: now,
          updatedAt: now,
          syncStatus: 'pending',
        };
        set((s) => ({ leads: [lead, ...s.leads] }));
        emitPipeline({ type: 'lead_created', leadId: lead.id });
        return lead;
      },

      upsert: (lead) => {
        set((s) => ({
          leads: s.leads.some((l) => l.id === lead.id)
            ? s.leads.map((l) => (l.id === lead.id ? lead : l))
            : [lead, ...s.leads],
        }));
        return lead;
      },

      setStage: (id, stage, by = 'roofer') => {
        const current = get().leads.find((l) => l.id === id);
        // No-op: neither writes nor emits. This is the loop guard's floor —
        // the automation engine's own forward-only check means a rule that
        // re-evaluates its own move always lands here.
        if (!current || current.stage === stage) return;
        const now = new Date().toISOString();
        set((s) => ({
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

      markSynced: (ids) =>
        set((s) => ({
          leads: s.leads.map((l) => (ids.includes(l.id) ? { ...l, syncStatus: 'synced' } : l)),
        })),

      remove: (id) =>
        set((s) => ({ leads: s.leads.filter((l) => l.id !== id) })),

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
      storage: createJSONStorage(() => AsyncStorage),
      version: PERSIST_VERSION,
      migrate: (persisted) => migrateLeads(persisted),
      partialize: (s): Persisted => ({ leads: s.leads }),
    },
  ),
);
