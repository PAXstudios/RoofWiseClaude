import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Lead, LeadStage } from '../models/types';
import { LEAD_STAGE_ORDER } from '../models/types';

let counter = 0;

function newId(): string {
  return `lead_${Date.now()}_${counter++}`;
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
  setStage: (id: string, stage: LeadStage) => void;
  /**
   * Correct name / phone / email / address on an existing lead. Keys present
   * in `patch` are written as given (`undefined` clears an optional field);
   * absent keys are untouched. Stamps `updatedAt` + `syncStatus: 'pending'`
   * like every other mutator so the next push carries it.
   */
  updateDetails: (id: string, patch: LeadDetailsPatch) => void;
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

      setStage: (id, stage) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === id
              ? {
                  ...l,
                  stage,
                  // Stamped alongside updatedAt so the board can measure time
                  // in stage rather than time since any edit.
                  stageChangedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  syncStatus: 'pending',
                }
              : l,
          ),
        })),

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

      setStormMatch: (id, match) =>
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
        })),

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
