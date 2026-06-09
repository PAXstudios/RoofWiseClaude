import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  BrittlenessTest,
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
  brittlenessTest?: BrittlenessTest;
};

export type PhotoCapture = {
  uri: string;
  slope: SlopeOrientation;
  findings: InspectionFinding[];
  markers: DamageMarker[];
};

export type RawCapture = {
  uri: string;
  slope: SlopeOrientation;
};

type InspectionStoreState = {
  inspections: Inspection[];
  nextOrdinal: number;

  create: (draft: CreateDraft) => Inspection;
  remove: (id: string) => void;
  setStatus: (id: string, status: InspectionStatus) => void;
  setEvent: (id: string, event: Inspection['event']) => void;
  setInspectorSignature: (id: string, svg: string) => void;
  setCollateralItem: (id: string, key: string, value: boolean) => void;
  addAudioNote: (id: string, note: { uri: string; durationSec: number; label?: string }) => void;
  removeAudioNote: (id: string, noteId: string) => void;
  removePhoto: (inspectionId: string, slopeId: string, photoIndex: number) => void;
  replacePhoto: (inspectionId: string, slopeId: string, photoIndex: number, uri: string) => void;
  getById: (id: string) => Inspection | undefined;
  attachPhotos: (inspectionId: string, captures: PhotoCapture[]) => void;
  attachRawPhotos: (inspectionId: string, captures: RawCapture[]) => void;
  setSlopeMarkers: (
    inspectionId: string,
    slopeId: string,
    markers: DamageMarker[],
  ) => void;
  replacePhotoMarkers: (
    inspectionId: string,
    slopeId: string,
    photoIndex: number,
    photoMarkers: DamageMarker[],
  ) => void;
};

function withRecount(slope: Slope): Slope {
  const m = slope.damage;
  return {
    ...slope,
    hailCount: m.filter((x) => x.category === 'hail_hits').length,
    bruisingCount: m.filter((x) => x.category === 'bruising').length,
    windLiftCount: m.filter((x) =>
      ['wind_creasing', 'lifted_shingles', 'wind_damage'].includes(x.category),
    ).length,
    missingCount: m.filter((x) => x.category === 'missing_shingles').length,
    wearCount: m.filter((x) =>
      ['granule_loss', 'cracking', 'splitting'].includes(x.category),
    ).length,
  };
}

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
          brittlenessTest: d.brittlenessTest ?? 'not_tested',
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

      setEvent: (id, event) =>
        set((s) => ({
          inspections: s.inspections.map((i) => (i.id === id ? { ...i, event } : i)),
        })),

      setInspectorSignature: (id, svg) =>
        set((s) => ({
          inspections: s.inspections.map((i) =>
            i.id === id
              ? { ...i, inspectorSignatureSvg: svg, signedAt: new Date().toISOString() }
              : i,
          ),
        })),

      setCollateralItem: (id, key, value) =>
        set((s) => ({
          inspections: s.inspections.map((i) =>
            i.id === id
              ? { ...i, collateralChecklist: { ...i.collateralChecklist, [key]: value } }
              : i,
          ),
        })),

      addAudioNote: (id, note) =>
        set((s) => ({
          inspections: s.inspections.map((i) => {
            if (i.id !== id) return i;
            const audioNotes = [
              ...(i.audioNotes ?? []),
              {
                id: `aud_${Date.now()}_${counter++}`,
                uri: note.uri,
                durationSec: note.durationSec,
                recordedAt: new Date().toISOString(),
                label: note.label,
              },
            ];
            return { ...i, audioNotes };
          }),
        })),

      removeAudioNote: (id, noteId) =>
        set((s) => ({
          inspections: s.inspections.map((i) =>
            i.id === id
              ? { ...i, audioNotes: (i.audioNotes ?? []).filter((n) => n.id !== noteId) }
              : i,
          ),
        })),

      removePhoto: (inspectionId, slopeId, photoIndex) =>
        set((s) => ({
          inspections: s.inspections.map((ins) => {
            if (ins.id !== inspectionId) return ins;
            return {
              ...ins,
              slopes: ins.slopes.map((sl) => {
                if (sl.id !== slopeId) return sl;
                // Drop the photo + its markers; renumber markers above it
                const photoPaths = sl.photoPaths.filter((_, i) => i !== photoIndex);
                const damage = sl.damage
                  .filter((m) => m.photoIndex !== photoIndex)
                  .map((m) => {
                    if (typeof m.photoIndex !== 'number') return m;
                    return m.photoIndex > photoIndex
                      ? { ...m, photoIndex: m.photoIndex - 1 }
                      : m;
                  });
                return withRecount({ ...sl, photoPaths, damage });
              }),
            };
          }),
        })),

      replacePhoto: (inspectionId, slopeId, photoIndex, uri) =>
        set((s) => ({
          inspections: s.inspections.map((ins) => {
            if (ins.id !== inspectionId) return ins;
            return {
              ...ins,
              slopes: ins.slopes.map((sl) => {
                if (sl.id !== slopeId) return sl;
                const photoPaths = sl.photoPaths.map((u, i) =>
                  i === photoIndex ? uri : u,
                );
                return { ...sl, photoPaths };
              }),
            };
          }),
        })),

      getById: (id) => get().inspections.find((i) => i.id === id),

      attachRawPhotos: (inspectionId, captures) => {
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
            }
            return { ...ins, slopes };
          }),
        }));
      },

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
              const photoIndex = slope.photoPaths.length;
              slope.photoPaths = [...slope.photoPaths, cap.uri];
              const tagged = cap.markers.map((m) => ({ ...m, photoIndex }));
              slope.damage = [...slope.damage, ...tagged];
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

      setSlopeMarkers: (inspectionId, slopeId, markers) =>
        set((s) => ({
          inspections: s.inspections.map((ins) => {
            if (ins.id !== inspectionId) return ins;
            return {
              ...ins,
              slopes: ins.slopes.map((sl) =>
                sl.id === slopeId
                  ? withRecount({ ...sl, damage: markers })
                  : sl,
              ),
            };
          }),
        })),

      replacePhotoMarkers: (inspectionId, slopeId, photoIndex, photoMarkers) =>
        set((s) => ({
          inspections: s.inspections.map((ins) => {
            if (ins.id !== inspectionId) return ins;
            return {
              ...ins,
              slopes: ins.slopes.map((sl) => {
                if (sl.id !== slopeId) return sl;
                const other = sl.damage.filter((m) => m.photoIndex !== photoIndex);
                const tagged = photoMarkers.map((m) => ({ ...m, photoIndex }));
                return withRecount({ ...sl, damage: [...other, ...tagged] });
              }),
            };
          }),
        })),
    }),
    {
      name: 'roofwise.inspections.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ inspections: s.inspections, nextOrdinal: s.nextOrdinal }),
    },
  ),
);
