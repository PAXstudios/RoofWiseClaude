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
  Slope,
  SlopeOrientation,
  DamageMarker,
  InspectionFinding,
} from '../models/types';

let counter = 0;

function newId(): string {
  return `ins_${Date.now()}_${counter++}`;
}

function newSlopeId(): string {
  return `slp_${Date.now()}_${counter++}`;
}

function makeSlope(orientation: SlopeOrientation): Slope {
  return {
    id: newSlopeId(),
    orientation,
    areaSquares: 0,
    damage: [],
    hailCount: 0,
    windLiftCount: 0,
    wearCount: 0,
    missingCount: 0,
    bruisingCount: 0,
    functional: false,
    verifyWithInspector: false,
    aiFindings: [],
    photoPaths: [],
  };
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

export type PhotoCapture = {
  uri: string;
  slope: SlopeOrientation;
  findings: InspectionFinding[];
  markers: DamageMarker[];
};

type InspectionStoreState = {
  inspections: Inspection[];
  nextOrdinal: number;

  create: (draft: CreateDraft) => Inspection;
  remove: (id: string) => void;
  setStatus: (id: string, status: InspectionStatus) => void;
  getById: (id: string) => Inspection | undefined;
  attachPhotos: (inspectionId: string, captures: PhotoCapture[]) => void;
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

      attachPhotos: (inspectionId, captures) => {
        if (captures.length === 0) return;
        set((s) => ({
          inspections: s.inspections.map((ins) => {
            if (ins.id !== inspectionId) return ins;
            const slopes = [...ins.slopes];
            for (const cap of captures) {
              let slope = slopes.find((sl) => sl.orientation === cap.slope);
              if (!slope) {
                slope = makeSlope(cap.slope);
                slopes.push(slope);
              }
              slope.photoPaths = [...slope.photoPaths, cap.uri];
              slope.damage = [...slope.damage, ...cap.markers];
              slope.aiFindings = [...(slope.aiFindings ?? []), ...cap.findings];
              for (const f of cap.findings) {
                if (!f.detected) continue;
                switch (f.label) {
                  case 'hail_hits': slope.hailCount += f.count; break;
                  case 'bruising': slope.bruisingCount += f.count; break;
                  case 'wind_creasing':
                  case 'lifted_shingles':
                  case 'wind_damage': slope.windLiftCount += f.count; break;
                  case 'missing_shingles': slope.missingCount += f.count; break;
                  case 'granule_loss':
                  case 'cracking':
                  case 'splitting': slope.wearCount += f.count; break;
                }
              }
            }
            return { ...ins, slopes };
          }),
        }));
      },
    }),
    {
      name: 'roofwise.inspections.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ inspections: s.inspections, nextOrdinal: s.nextOrdinal }),
    },
  ),
);
