import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Inspection,
  InspectionStatus,
  RoofMaterial,
  RoofGeometry,
  RoofCondition,
  InsuranceCarrier,
} from '../models/types';

let counter = 0;

function newId(): string {
  return `ins_${Date.now()}_${counter++}`;
}

function mintReportId(year: number, ordinal: number): string {
  return `RW-${year}-${String(ordinal).padStart(4, '0')}`;
}

type CreateDraft = {
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  address: string;
  lat?: number;
  lng?: number;
  carrier?: InsuranceCarrier;
  policyNumber?: string;
  claimNumber?: string;
  adjusterName?: string;
  material: RoofMaterial;
  ageYears: number;
  geometry: RoofGeometry;
  condition: RoofCondition;
};

type InspectionStoreState = {
  inspections: Inspection[];
  nextOrdinal: number;

  create: (draft: CreateDraft) => Inspection;
  remove: (id: string) => void;
  setStatus: (id: string, status: InspectionStatus) => void;
  getById: (id: string) => Inspection | undefined;
};

export const useInspectionStore = create<InspectionStoreState>()(
  persist(
    (set, get) => ({
      inspections: [],
      nextOrdinal: 1,

      create: (d) => {
        const year = new Date().getFullYear();
        const ord = get().nextOrdinal;
        const inspection: Inspection = {
          id: newId(),
          reportId: mintReportId(year, ord),
          createdAt: new Date().toISOString(),
          status: 'in_progress',
          customerName: d.customerName,
          customerPhone: d.customerPhone,
          customerEmail: d.customerEmail,
          address: d.address,
          lat: d.lat,
          lng: d.lng,
          carrier: d.carrier,
          policyNumber: d.policyNumber,
          claimNumber: d.claimNumber,
          adjusterName: d.adjusterName,
          material: d.material,
          ageYears: d.ageYears,
          geometry: d.geometry,
          condition: d.condition,
          brittlenessTest: 'not_tested',
          collateralChecklist: {},
          slopes: [],
          verifyWithInspector: false,
        };
        set((s) => ({
          inspections: [inspection, ...s.inspections],
          nextOrdinal: s.nextOrdinal + 1,
        }));
        return inspection;
      },

      remove: (id) =>
        set((s) => ({ inspections: s.inspections.filter((i) => i.id !== id) })),

      setStatus: (id, status) =>
        set((s) => ({
          inspections: s.inspections.map((i) => (i.id === id ? { ...i, status } : i)),
        })),

      getById: (id) => get().inspections.find((i) => i.id === id),
    }),
    {
      name: 'roofwise.inspections.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ inspections: s.inspections, nextOrdinal: s.nextOrdinal }),
    },
  ),
);
