// Ephemeral state used to prefill NewJobWizard from another flow
// (Lead conversion, Estimator → New Job). The store clears itself after
// the wizard reads it, so it doesn't leak between sessions.

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
};

type State = {
  prefill: WizardPrefill | null;
  set: (prefill: WizardPrefill) => void;
  consume: () => WizardPrefill | null;
};

export const useWizardPrefillStore = create<State>((set, get) => ({
  prefill: null,
  set: (prefill) => set({ prefill }),
  consume: () => {
    const v = get().prefill;
    set({ prefill: null });
    return v;
  },
}));
