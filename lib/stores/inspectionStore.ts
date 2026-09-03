import { create } from 'zustand';
import { roofAgePrefill } from '../services/propertyRecord';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  BrittlenessProtocol,
  BrittlenessTest,
  CaptureMode,
  CauseOfLoss,
  CollateralChecklistItem,
  CollateralEvidence,
  CollateralZone,
  CoverPhoto,
  DamageMarker,
  Inspection,
  InspectionFinding,
  InspectionKind,
  InspectionStatus,
  InsuranceCarrier,
  PhotoMeta,
  PhotoSyncState,
  PolicyType,
  PropertyIntel,
  PropertyRecord,
  RoofAgeSource,
  RoofCondition,
  RoofGeometry,
  RoofMaterial,
  Slope,
  SlopeOrientation,
} from '../models/types';
import { squaresFacing } from '../services/propertyIntel';
import { bucketHitCountsByMode } from '../services/captureSession';
import { deriveFunctional } from '../services/functionalDamage';
import {
  brittlenessResultToLegacy,
  emptyCollateralEvidence,
} from '../models/types';

let counter = 0;

function newId(): string {
  return `ins_${Date.now()}_${counter++}`;
}

function newSlopeId(): string {
  return `slp_${Date.now()}_${counter++}`;
}

/**
 * @param intel  the job's aerial measurement, when it has one — a slope
 *   created later (the inspector walks a new elevation) still gets its
 *   measured area, so area does not depend on capture order.
 * @param pitch  the job's whole-roof Pitch Gauge reading, when one was taken
 *   before this slope existed — same reasoning: the reading should not
 *   depend on which slope happened to be shot first.
 */
function makeSlope(
  orientation: SlopeOrientation,
  intel?: PropertyIntel,
  pitch?: number,
): Slope {
  const detected = squaresFacing(intel, orientation);
  return {
    id: newSlopeId(),
    orientation,
    ...(pitch != null ? { pitchDegrees: pitch } : {}),
    areaSquares: 0,
    detectedAreaSquares: detected,
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
    analyzedPhotoIndices: [],
  };
}

function mintReportId(year: number, ordinal: number): string {
  return `RW-${year}-${String(ordinal).padStart(4, '0')}`;
}

/** Inverse of `mintReportId` — 0 for anything that is not an RW id. */
function ordinalOf(reportId: unknown): number {
  const m = typeof reportId === 'string' ? reportId.match(/-(\d{4})$/) : null;
  return m ? parseInt(m[1], 10) : 0;
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
  /** Where the age came from; absent = inspector-entered. */
  ageSource?: RoofAgeSource;
  geometry: RoofGeometry;
  condition: RoofCondition;
  brittlenessTest?: BrittlenessTest;

  // Insurance Claim mode (all optional — default is a general inspection).
  kind?: InspectionKind;
  causeOfLoss?: CauseOfLoss;
  policyType?: PolicyType;
  deductible?: number;
  homeValue?: number;
  priorClaimsWithin3Years?: boolean;
  dateOfLoss?: string;
  collateralEvidence?: CollateralEvidence;
  brittlenessProtocol?: BrittlenessProtocol;
  codeComplianceNotes?: string;

  /** The lead this job was converted from — the wizard links both ends. */
  leadId?: string;
  /** Whole-roof Pitch Gauge reading taken in the wizard (degrees). */
  pitchDegrees?: number;
};

/** Claim detail fields editable after creation (job detail / edit flows). */
type ClaimDetailsPatch = Partial<
  Pick<
    Inspection,
    | 'causeOfLoss'
    | 'policyType'
    | 'deductible'
    | 'homeValue'
    | 'priorClaimsWithin3Years'
    | 'dateOfLoss'
    | 'codeComplianceNotes'
  >
>;

/**
 * Customer / property / roof-system fields editable after creation — the
 * job screen's Property card and the "name this job" sheet a standalone
 * Quick Inspection opens on Done. Everything a placeholder job ("Quick
 * inspection" at "Address pending", architectural asphalt, good) needs
 * corrected before its packet can go to a carrier.
 */
export type InspectionDetailsPatch = Partial<
  Pick<
    Inspection,
    | 'ageSource'
    | 'customerName'
    | 'customerPhone'
    | 'customerEmail'
    | 'address'
    | 'lat'
    | 'lng'
    | 'material'
    | 'ageYears'
    | 'geometry'
    | 'condition'
    | 'carrier'
    | 'policyNumber'
    | 'claimNumber'
    | 'adjusterName'
  >
>;

export type PhotoCapture = {
  uri: string;
  slope: SlopeOrientation;
  findings: InspectionFinding[];
  markers: DamageMarker[];
  /** One of AREA_TAGS — persisted to Slope.photoMeta when present. */
  areaTag?: string;
  captureMode?: CaptureMode;
};

export type RawCapture = {
  uri: string;
  slope: SlopeOrientation;
  /** One of AREA_TAGS — persisted to Slope.photoMeta when present. */
  areaTag?: string;
  captureMode?: CaptureMode;
};

/**
 * Per-capture-mode hit totals.
 *
 * There is deliberately no setter for these: `withRecount` derives them from
 * the markers on every marker mutation, so an external write would be both
 * overwritten by the next edit and free to violate the
 * `square + singleShingle === hailCount` invariant.
 */
export type SlopeModeCounts = {
  squareHitCount?: number;
  singleShingleHitCount?: number;
};

type InspectionStoreState = {
  inspections: Inspection[];
  nextOrdinal: number;

  create: (draft: CreateDraft) => Inspection;
  remove: (id: string) => void;
  setStatus: (id: string, status: InspectionStatus) => void;
  setEvent: (id: string, event: Inspection['event']) => void;
  setStormSearchOutcome: (id: string, outcome: Inspection['stormSearchOutcome']) => void;
  /**
   * Store the aerial roof measurement and seed every slope's
   * `detectedAreaSquares` from it, so the cost formula, the estimator and the
   * proposal all read the same number without each re-deriving it.
   */
  setPropertyIntel: (id: string, intel: PropertyIntel) => void;
  /**
   * Store the Zillow record and PREFILL roof age from it — only when the
   * inspector has not entered one (`ageYears` 0 / unset). A number the
   * inspector typed is never overwritten; `ageSource` says where it came from.
   */
  setPropertyRecord: (id: string, record: PropertyRecord) => void;
  /** Choose (or clear, with undefined) the photo that fronts the job. */
  setCoverPhoto: (id: string, cover: CoverPhoto | undefined) => void;
  setInspectorSignature: (id: string, svg: string) => void;
  setCollateralItem: (id: string, key: string, value: boolean) => void;
  setKind: (id: string, kind: InspectionKind) => void;
  setCauseOfLoss: (id: string, cause: CauseOfLoss | undefined) => void;
  setClaimDetails: (id: string, patch: ClaimDetailsPatch) => void;
  /**
   * Correct the customer, address, or roof system on an existing job. Keys
   * present in `patch` are written as given (including `undefined`, which
   * clears an optional field); absent keys are untouched. No sync stamp is
   * needed: `inspectionSync` diffs object identity and marks the record
   * dirty on its own, the same as every other mutator here.
   */
  updateDetails: (id: string, patch: InspectionDetailsPatch) => void;
  setCollateralZone: (
    id: string,
    zone: CollateralZone,
    patch: Partial<CollateralChecklistItem>,
  ) => void;
  setBrittlenessProtocol: (id: string, protocol: BrittlenessProtocol | undefined) => void;
  /**
   * Persist a decision-engine snapshot.
   *
   * Ignored once `reportFinalizedAt` is set unless `opts.force` is passed: a
   * finalized report is signed evidence, and silently replacing the numbers
   * underneath it would leave the record claiming to be "frozen with the
   * finalized report" while carrying a determination that document never had.
   * Only a deliberate re-finalize (which re-stamps `reportFinalizedAt` in the
   * same action) may force it.
   */
  setStoredEngineResult: (
    inspectionId: string,
    result: unknown,
    atIso?: string,
    opts?: { force?: boolean },
  ) => void;
  setReportFinalizedAt: (id: string, atIso?: string) => void;
  clearReportFinalizedAt: (id: string) => void;
  addAudioNote: (id: string, note: { uri: string; durationSec: number; label?: string }) => void;
  removeAudioNote: (id: string, noteId: string) => void;
  setAudioNoteLabel: (id: string, noteId: string, label: string) => void;
  removePhoto: (inspectionId: string, slopeId: string, photoIndex: number) => void;
  replacePhoto: (inspectionId: string, slopeId: string, photoIndex: number, uri: string) => void;
  setPhotoUpload: (
    inspectionId: string,
    slopeId: string,
    localUri: string,
    remoteUrl: string,
  ) => void;
  /**
   * Record why a photo has not uploaded (or never will). `undefined` clears
   * the entry — `setPhotoUpload` does that itself on success.
   */
  setPhotoSyncState: (
    inspectionId: string,
    slopeId: string,
    localUri: string,
    state: PhotoSyncState | undefined,
  ) => void;
  /**
   * File a Pitch Gauge reading on one slope. Degrees, already clamped to
   * 0–75 by the gauge; the slope's own reading always wins over the roof's.
   */
  setSlopePitch: (inspectionId: string, slopeId: string, degrees: number) => void;
  /**
   * File a Pitch Gauge reading for the whole roof: stored on the inspection,
   * copied onto every slope that has NO pitch yet, and seeded onto slopes
   * created afterwards. A slope with its own reading is left alone.
   */
  setRoofPitch: (inspectionId: string, degrees: number) => void;
  /** Link (or unlink with `undefined`) the pipeline lead this job came from. */
  setLeadId: (inspectionId: string, leadId: string | undefined) => void;
  setNotes: (id: string, notes: string) => void;
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
  // Split the hail hits by the capture mode of the photo each marker came
  // from, in the SAME pass that recounts hailCount.
  //
  // This has to happen here rather than only after an analysis pass: the
  // decision engine reads `squareHitCount ?? hailCount` as the HAAG §2
  // per-square denominator, so a manual marker edit that recounted hailCount
  // but left squareHitCount behind would feed the engine a stale number —
  // worse than having no split at all. Every marker mutation in this store
  // funnels through withRecount, which makes
  // `squareHitCount + singleShingleHitCount === hailCount` a store invariant.
  //
  // Photos with no recorded mode fall into the square bucket, matching the
  // capture flow's default, so slopes captured before mode tagging recount to
  // exactly the numbers they had before.
  const hitsByPhotoIndex: Record<number, number> = {};
  for (const marker of m) {
    if (marker.category !== 'hail_hits') continue;
    const key = typeof marker.photoIndex === 'number' ? marker.photoIndex : -1;
    hitsByPhotoIndex[key] = (hitsByPhotoIndex[key] ?? 0) + 1;
  }
  const modeCounts = bucketHitCountsByMode(slope.photoMeta, hitsByPhotoIndex);

  return {
    ...slope,
    ...modeCounts,
    // §1 functional flag, re-derived from the markers as they stand NOW. The
    // engine treats it as authoritative and never re-derives it, so a marker
    // edit that left it behind would be the worst kind of stale: an inspector
    // who deletes the model's only mat-fracture hit would still ship a slope
    // marked functional, and one who adds a confirmed soft spot could not
    // establish it. Same derivation analyzeSlope runs after a pass.
    functional: deriveFunctional(slope).functional,
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

/** `record` without `key`; `undefined` once nothing is left, so the field disappears. */
function withoutKey<T>(
  record: Record<string, T> | undefined,
  key: string,
): Record<string, T> | undefined {
  if (!record || !(key in record)) return record;
  const { [key]: _dropped, ...rest } = record;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Appends per-photo capture metadata only when the capture carried some. */
function appendPhotoMeta(
  slope: Slope,
  photoIndex: number,
  cap: { areaTag?: string; captureMode?: CaptureMode },
): PhotoMeta[] | undefined {
  if (!cap.areaTag && !cap.captureMode) return slope.photoMeta;
  return [
    ...(slope.photoMeta ?? []),
    { photoIndex, areaTag: cap.areaTag, captureMode: cap.captureMode },
  ];
}

// -----------------------------------------------------------------------------
// Persist versioning
// -----------------------------------------------------------------------------

/** The persisted slice — the records only; every action is rebuilt on load. */
type Persisted = { inspections: Inspection[]; nextOrdinal: number };

/**
 * Bump whenever the persisted shape changes, and teach `migrateInspections`
 * the new field at the same time. zustand DROPS a stored blob whose version
 * does not match and no migrate function handles it — for this store that
 * is every job on the device.
 */
const PERSIST_VERSION = 1;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const finiteOr0 = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/**
 * Rehydration guard. Every field the current `Slope` shape REQUIRES is
 * filled with the same neutral value `makeSlope()` starts from — empty
 * arrays, zero counts, false — and nothing else is touched. It never invents
 * a value the roofer did not record (no pitch, no area, no verdict).
 */
function normalizeSlope(raw: Record<string, unknown>): Slope {
  return {
    ...(raw as unknown as Slope),
    orientation:
      typeof raw.orientation === 'string' ? (raw.orientation as SlopeOrientation) : 'Unknown',
    areaSquares: finiteOr0(raw.areaSquares),
    damage: Array.isArray(raw.damage) ? (raw.damage as DamageMarker[]) : [],
    hailCount: finiteOr0(raw.hailCount),
    windLiftCount: finiteOr0(raw.windLiftCount),
    wearCount: finiteOr0(raw.wearCount),
    missingCount: finiteOr0(raw.missingCount),
    bruisingCount: finiteOr0(raw.bruisingCount),
    functional: raw.functional === true,
    verifyWithInspector: raw.verifyWithInspector === true,
    aiFindings: Array.isArray(raw.aiFindings) ? (raw.aiFindings as InspectionFinding[]) : [],
    photoPaths: Array.isArray(raw.photoPaths)
      ? raw.photoPaths.filter((p): p is string => typeof p === 'string')
      : [],
  };
}

/** Same guard for the `Inspection` shell; the defaults are `create()`'s. */
function normalizeInspection(raw: Record<string, unknown>): Inspection {
  return {
    ...(raw as unknown as Inspection),
    status: typeof raw.status === 'string' ? (raw.status as InspectionStatus) : 'in_progress',
    customerName: typeof raw.customerName === 'string' ? raw.customerName : '',
    address: typeof raw.address === 'string' ? raw.address : '',
    brittlenessTest:
      typeof raw.brittlenessTest === 'string'
        ? (raw.brittlenessTest as BrittlenessTest)
        : 'not_tested',
    collateralChecklist: isRecord(raw.collateralChecklist)
      ? (raw.collateralChecklist as Record<string, boolean>)
      : {},
    slopes: Array.isArray(raw.slopes) ? raw.slopes.filter(isRecord).map(normalizeSlope) : [],
    verifyWithInspector: raw.verifyWithInspector === true,
  };
}

/**
 * Runs once, when a stored blob's version is older than PERSIST_VERSION.
 * `nextOrdinal` is re-derived from the highest report id present when the
 * stored counter is missing or behind it, so a migrated device can never
 * mint a duplicate RW-YYYY-#### number.
 */
function migrateInspections(persisted: unknown): Persisted {
  const raw = isRecord(persisted) ? persisted : {};
  const list = Array.isArray(raw.inspections) ? raw.inspections.filter(isRecord) : [];
  const inspections = list.map(normalizeInspection);
  const highest = inspections.reduce((max, i) => Math.max(max, ordinalOf(i.reportId)), 0);
  const stored = typeof raw.nextOrdinal === 'number' ? raw.nextOrdinal : 0;
  return { inspections, nextOrdinal: Math.max(stored, highest + 1) };
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
          ageSource: d.ageSource,
          geometry: d.geometry,
          condition: d.condition,
          brittlenessTest:
            d.brittlenessTest ??
            (d.brittlenessProtocol
              ? brittlenessResultToLegacy(d.brittlenessProtocol.result)
              : 'not_tested'),
          collateralChecklist: {},
          slopes: [],
          verifyWithInspector: false,

          // Insurance Claim mode. `kind` defaults to general; a claim gets an
          // empty four-zone collateral checklist so the capture flow always
          // has all zones to walk.
          kind: d.kind ?? 'general',
          causeOfLoss: d.causeOfLoss,
          policyType: d.policyType,
          deductible: d.deductible,
          homeValue: d.homeValue,
          priorClaimsWithin3Years: d.priorClaimsWithin3Years,
          dateOfLoss: d.dateOfLoss,
          collateralEvidence:
            d.collateralEvidence ??
            (d.kind === 'insurance_claim' ? emptyCollateralEvidence() : undefined),
          brittlenessProtocol: d.brittlenessProtocol,
          codeComplianceNotes: d.codeComplianceNotes,
          leadId: d.leadId,
          pitchDegrees: d.pitchDegrees,
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

      setStormSearchOutcome: (id, outcome) =>
        set((s) => ({
          inspections: s.inspections.map((i) =>
            i.id === id ? { ...i, stormSearchOutcome: outcome } : i,
          ),
        })),

      setPropertyRecord: (id, record) =>
        set((st) => ({
          inspections: st.inspections.map((i) => {
            if (i.id !== id) return i;
            const prefill = roofAgePrefill(record, new Date().getFullYear());
            const inspectorEntered = i.ageYears > 0 && (i.ageSource == null || i.ageSource === 'inspector');
            const applyAge = prefill != null && !inspectorEntered;
            return {
              ...i,
              propertyRecord: record,
              ...(applyAge ? { ageYears: prefill.ageYears, ageSource: prefill.source } : {}),
            };
          }),
        })),

      setCoverPhoto: (id, cover) =>
        set((st) => ({
          inspections: st.inspections.map((i) => (i.id === id ? { ...i, coverPhoto: cover } : i)),
        })),

      setPropertyIntel: (id, intel) =>
        set((st) => ({
          inspections: st.inspections.map((i) =>
            i.id === id
              ? {
                  ...i,
                  propertyIntel: intel,
                  // Seed the measured area onto slopes that have none. A number
                  // the inspector typed always wins — they were on the roof.
                  slopes: i.slopes.map((sl) => {
                    if (sl.detectedAreaSquares != null) return sl;
                    const squares = squaresFacing(intel, sl.orientation);
                    return squares == null ? sl : { ...sl, detectedAreaSquares: squares };
                  }),
                }
              : i,
          ),
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

      setKind: (id, kind) =>
        set((s) => ({
          inspections: s.inspections.map((i) => {
            if (i.id !== id) return i;
            return {
              ...i,
              kind,
              // Flipping an existing job to a claim initializes the four-zone
              // checklist; flipping back keeps any evidence already gathered.
              collateralEvidence:
                kind === 'insurance_claim'
                  ? i.collateralEvidence ?? emptyCollateralEvidence()
                  : i.collateralEvidence,
            };
          }),
        })),

      setCauseOfLoss: (id, cause) =>
        set((s) => ({
          inspections: s.inspections.map((i) =>
            i.id === id ? { ...i, causeOfLoss: cause } : i,
          ),
        })),

      setClaimDetails: (id, patch) =>
        set((s) => ({
          inspections: s.inspections.map((i) =>
            i.id === id ? { ...i, ...patch } : i,
          ),
        })),

      updateDetails: (id, patch) =>
        set((s) => ({
          inspections: s.inspections.map((i) =>
            i.id === id ? { ...i, ...patch } : i,
          ),
        })),

      setCollateralZone: (id, zone, patch) =>
        set((s) => ({
          inspections: s.inspections.map((i) => {
            if (i.id !== id) return i;
            // Migration-safe: pre-claim-mode records have no evidence map yet.
            const evidence = i.collateralEvidence ?? emptyCollateralEvidence();
            return {
              ...i,
              collateralEvidence: {
                ...evidence,
                [zone]: { ...evidence[zone], ...patch },
              },
            };
          }),
        })),

      setBrittlenessProtocol: (id, protocol) =>
        set((s) => ({
          inspections: s.inspections.map((i) => {
            if (i.id !== id) return i;
            return {
              ...i,
              brittlenessProtocol: protocol,
              // Mirror into the legacy field so older read sites (report
              // header, engine fallback) stay truthful.
              brittlenessTest: protocol
                ? brittlenessResultToLegacy(protocol.result)
                : i.brittlenessTest,
            };
          }),
        })),

      setStoredEngineResult: (inspectionId, result, atIso, opts) =>
        set((s) => ({
          inspections: s.inspections.map((i) => {
            if (i.id !== inspectionId) return i;
            // The freeze is a write-side invariant, not just a read-side label:
            // re-analysis after a report was signed must not overwrite the
            // determination that document carries.
            if (i.reportFinalizedAt && !opts?.force) return i;
            return {
              ...i,
              storedEngineResult: result,
              storedEngineResultAt: atIso ?? new Date().toISOString(),
            };
          }),
        })),

      setReportFinalizedAt: (id, atIso) =>
        set((s) => ({
          inspections: s.inspections.map((i) =>
            i.id === id
              ? { ...i, reportFinalizedAt: atIso ?? new Date().toISOString() }
              : i,
          ),
        })),

      clearReportFinalizedAt: (id) =>
        set((s) => ({
          inspections: s.inspections.map((i) =>
            i.id === id ? { ...i, reportFinalizedAt: undefined } : i,
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

      setAudioNoteLabel: (id, noteId, label) =>
        set((s) => ({
          inspections: s.inspections.map((i) =>
            i.id === id
              ? {
                  ...i,
                  audioNotes: (i.audioNotes ?? []).map((n) =>
                    n.id === noteId ? { ...n, label } : n,
                  ),
                }
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
                // Drop the photo + its markers; renumber markers and the
                // analyzed-index record above it so both stay aligned with
                // the shifted photoPaths array.
                const photoPaths = sl.photoPaths.filter((_, i) => i !== photoIndex);
                const damage = sl.damage
                  .filter((m) => m.photoIndex !== photoIndex)
                  .map((m) => {
                    if (typeof m.photoIndex !== 'number') return m;
                    return m.photoIndex > photoIndex
                      ? { ...m, photoIndex: m.photoIndex - 1 }
                      : m;
                  });
                const analyzedPhotoIndices = (sl.analyzedPhotoIndices ?? [])
                  .filter((i) => i !== photoIndex)
                  .map((i) => (i > photoIndex ? i - 1 : i));
                const photoMeta = sl.photoMeta
                  ?.filter((m) => m.photoIndex !== photoIndex)
                  .map((m) =>
                    m.photoIndex > photoIndex
                      ? { ...m, photoIndex: m.photoIndex - 1 }
                      : m,
                  );
                // Upload bookkeeping is keyed by URI, so nothing renumbers —
                // but a dropped photo's pending/failed state goes with it.
                const removedUri = sl.photoPaths[photoIndex];
                return withRecount({
                  ...sl,
                  photoPaths,
                  damage,
                  analyzedPhotoIndices,
                  photoMeta,
                  photoSync: withoutKey(sl.photoSync, removedUri),
                });
              }),
            };
          }),
        })),

      setNotes: (id, notes) =>
        set((s) => ({
          inspections: s.inspections.map((i) => (i.id === id ? { ...i, notes } : i)),
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

      setPhotoUpload: (inspectionId, slopeId, localUri, remoteUrl) =>
        set((s) => ({
          inspections: s.inspections.map((ins) => {
            if (ins.id !== inspectionId) return ins;
            return {
              ...ins,
              slopes: ins.slopes.map((sl) =>
                sl.id === slopeId
                  ? {
                      ...sl,
                      photoUploads: { ...(sl.photoUploads ?? {}), [localUri]: remoteUrl },
                      // An upload that landed has nothing left to explain.
                      photoSync: withoutKey(sl.photoSync, localUri),
                    }
                  : sl,
              ),
            };
          }),
        })),

      setPhotoSyncState: (inspectionId, slopeId, localUri, state) =>
        set((s) => ({
          inspections: s.inspections.map((ins) => {
            if (ins.id !== inspectionId) return ins;
            return {
              ...ins,
              slopes: ins.slopes.map((sl) => {
                if (sl.id !== slopeId) return sl;
                const photoSync = state
                  ? { ...(sl.photoSync ?? {}), [localUri]: state }
                  : withoutKey(sl.photoSync, localUri);
                return { ...sl, photoSync };
              }),
            };
          }),
        })),

      setSlopePitch: (inspectionId, slopeId, degrees) =>
        set((s) => ({
          inspections: s.inspections.map((ins) =>
            ins.id !== inspectionId
              ? ins
              : {
                  ...ins,
                  slopes: ins.slopes.map((sl) =>
                    sl.id === slopeId ? { ...sl, pitchDegrees: degrees } : sl,
                  ),
                },
          ),
        })),

      setRoofPitch: (inspectionId, degrees) =>
        set((s) => ({
          inspections: s.inspections.map((ins) =>
            ins.id !== inspectionId
              ? ins
              : {
                  ...ins,
                  pitchDegrees: degrees,
                  slopes: ins.slopes.map((sl) =>
                    sl.pitchDegrees == null ? { ...sl, pitchDegrees: degrees } : sl,
                  ),
                },
          ),
        })),

      setLeadId: (inspectionId, leadId) =>
        set((s) => ({
          inspections: s.inspections.map((ins) =>
            ins.id === inspectionId ? { ...ins, leadId } : ins,
          ),
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
                slope = makeSlope(cap.slope, ins.propertyIntel, ins.pitchDegrees);
                slopes.push(slope);
              }
              const photoIndex = slope.photoPaths.length;
              slope.photoPaths = [...slope.photoPaths, cap.uri];
              slope.photoMeta = appendPhotoMeta(slope, photoIndex, cap);
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
                slope = makeSlope(cap.slope, ins.propertyIntel, ins.pitchDegrees);
                slopes.push(slope);
              }
              const photoIndex = slope.photoPaths.length;
              slope.photoPaths = [...slope.photoPaths, cap.uri];
              slope.photoMeta = appendPhotoMeta(slope, photoIndex, cap);
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
                // This call is the definition of "analyzed" — it fires once
                // per photo regardless of whether Gemini found any damage,
                // so a clean photo still gets marked (unlike inferring from
                // `damage`, which would make it indistinguishable from
                // never-analyzed).
                const analyzedPhotoIndices = Array.from(
                  new Set([...(sl.analyzedPhotoIndices ?? []), photoIndex]),
                ).sort((a, b) => a - b);
                return withRecount({
                  ...sl,
                  damage: [...other, ...tagged],
                  analyzedPhotoIndices,
                });
              }),
            };
          }),
        })),
    }),
    {
      name: 'roofwise.inspections.v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: PERSIST_VERSION,
      migrate: (persisted) => migrateInspections(persisted),
      partialize: (s): Persisted => ({ inspections: s.inspections, nextOrdinal: s.nextOrdinal }),
    },
  ),
);
