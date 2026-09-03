// Ephemeral state used to prefill NewJobWizard from another flow
// (Lead conversion, Estimator → New Job, Pitch Gauge → wizard). The store
// clears itself after the wizard reads it, so it doesn't leak between
// sessions.

import { create } from 'zustand';
import type {
  InsuranceCarrier,
  RoofCondition,
  RoofGeometry,
  RoofMaterial,
} from '../models/types';

export type WizardPrefill = {
  source?: 'lead' | 'estimate' | 'other';
  sourceId?: string;

  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  address?: string;
  addressLat?: number;
  addressLng?: number;

  carrier?: InsuranceCarrier;
  policyNumber?: string;
  claimNumber?: string;
  adjusterName?: string;

  material?: RoofMaterial;
  ageYears?: number;
  geometry?: RoofGeometry;
  condition?: RoofCondition;

  /** Pitch Gauge reading taken from inside the wizard (degrees, 0–75). */
  pitchDegrees?: number;
};

type State = {
  prefill: WizardPrefill | null;
  set: (prefill: WizardPrefill) => void;
  /**
   * Merge a Pitch Gauge reading into whatever prefill is waiting, or start
   * one. Separate from `set` so the gauge can never wipe a lead's contact
   * details that are still queued for the wizard.
   */
  setPitch: (degrees: number) => void;
  consume: () => WizardPrefill | null;
};

export const useWizardPrefillStore = create<State>((set, get) => ({
  prefill: null,
  set: (prefill) => set({ prefill }),
  setPitch: (degrees) =>
    set((s) => ({
      prefill: { ...(s.prefill ?? { source: 'other' }), pitchDegrees: degrees },
    })),
  consume: () => {
    const v = get().prefill;
    set({ prefill: null });
    return v;
  },
}));
