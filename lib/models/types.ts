// Core RoofWise data shapes. Modeled after the spec's Inspection / Slope /
// DamageMarker schemas. Snake_case in any JSON we send out; camelCase in TS.

import type { ImageSourcePropType } from 'react-native';

// -----------------------------------------------------------------------------
// Damage Taxonomy — the 13 canonical categories. Drift Warning #6.
// -----------------------------------------------------------------------------

export const DAMAGE_CATEGORIES = [
  'hail_hits',
  'bruising',
  'granule_loss',
  'wind_damage',
  'wind_creasing',
  'blistering',
  'cracking',
  'flashing_damage',
  'algae_moss',
  'missing_shingles',
  'splitting',
  'lifted_shingles',
  'structural_sagging',
] as const;

export type DamageCategory = (typeof DAMAGE_CATEGORIES)[number];

export const DAMAGE_CATEGORY_LABELS: Record<DamageCategory, string> = {
  hail_hits: 'Hail Hits',
  bruising: 'Bruising',
  granule_loss: 'Granule Loss',
  wind_damage: 'Wind Damage',
  wind_creasing: 'Wind Creasing',
  blistering: 'Blistering',
  cracking: 'Cracking',
  flashing_damage: 'Flashing Damage',
  algae_moss: 'Algae / Moss',
  missing_shingles: 'Missing Shingles',
  splitting: 'Splitting',
  lifted_shingles: 'Lifted Shingles',
  structural_sagging: 'Structural Sagging',
};

export type Severity = 'none' | 'minor' | 'moderate' | 'severe';

export const SEVERITY_LABELS: Record<Severity, string> = {
  none: 'None',
  minor: 'Minor',
  moderate: 'Moderate',
  severe: 'Severe',
};

// -----------------------------------------------------------------------------
// Roof material — used by HAAG threshold lookup
// -----------------------------------------------------------------------------

export type RoofMaterial =
  | 'three_tab_asphalt'
  | 'architectural_asphalt'
  | 'luxury_asphalt'
  | 'wood_shake'
  | 'wood_shingle'
  | 'metal_standing_seam'
  | 'metal_shingle'
  | 'clay_tile'
  | 'concrete_tile'
  | 'slate'
  | 'synthetic_slate'
  | 'composite'
  | 'rolled_roofing'
  | 'tpo'
  | 'epdm';

export const ROOF_MATERIAL_LABELS: Record<RoofMaterial, string> = {
  three_tab_asphalt: '3-Tab Asphalt',
  architectural_asphalt: 'Architectural Asphalt',
  luxury_asphalt: 'Luxury Asphalt',
  wood_shake: 'Wood Shake',
  wood_shingle: 'Wood Shingle',
  metal_standing_seam: 'Metal Standing Seam',
  metal_shingle: 'Metal Shingle',
  clay_tile: 'Clay Tile',
  concrete_tile: 'Concrete Tile',
  slate: 'Slate',
  synthetic_slate: 'Synthetic Slate',
  composite: 'Composite',
  rolled_roofing: 'Rolled Roofing',
  tpo: 'TPO',
  epdm: 'EPDM',
};

// -----------------------------------------------------------------------------
// Roof geometry + condition
// -----------------------------------------------------------------------------

export type RoofGeometry = 'gable' | 'hip' | 'mansard' | 'flat' | 'mixed';
export type RoofCondition = 'excellent' | 'good' | 'fair' | 'poor';

/**
 * Legacy quick-capture brittleness field. `'borderline'` was added for the
 * Insurance Claim mode field protocol — per HAAG_DECISION_ENGINE.md §4 a
 * BORDERLINE result gates repairs exactly like FAIL. New code should prefer
 * `Inspection.brittlenessProtocol` (result + mandatory photos) and fall back
 * to this field for older records.
 */
export type BrittlenessTest = 'not_tested' | 'passed' | 'failed' | 'borderline';

/**
 * HAAG brittleness result in decision-engine casing (§9 output
 * `brittleness_result`). FAIL and BORDERLINE both force replacement — spot
 * repairs on a brittle roof cause further damage.
 */
export type BrittlenessResult = 'PASS' | 'FAIL' | 'BORDERLINE';

/**
 * Brittleness *field protocol* (Professional Report §VII-C): lift shingle
 * corners in an undamaged area and photograph the test as you run it. In
 * Insurance Claim mode the photos are REQUIRED evidence — a result without
 * photos of the process is not defensible in front of an adjuster.
 */
export type BrittlenessProtocol = {
  result: BrittlenessResult;
  /** Local photo URIs of the test process (photoSync maps local → remote). */
  photoIds: string[];
  notes?: string;
};

export function brittlenessResultToLegacy(r: BrittlenessResult): BrittlenessTest {
  switch (r) {
    case 'PASS': return 'passed';
    case 'FAIL': return 'failed';
    case 'BORDERLINE': return 'borderline';
  }
}

export function legacyBrittlenessToResult(t: BrittlenessTest): BrittlenessResult | undefined {
  switch (t) {
    case 'passed': return 'PASS';
    case 'failed': return 'FAIL';
    case 'borderline': return 'BORDERLINE';
    case 'not_tested': return undefined;
  }
}

// -----------------------------------------------------------------------------
// Slope orientation — 8-way compass plus Flat / Unknown
// -----------------------------------------------------------------------------

export type SlopeOrientation =
  | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'Flat' | 'Unknown';

export const SLOPE_ORIENTATIONS: SlopeOrientation[] = [
  'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'Flat', 'Unknown',
];

// Convert compass yaw (0-360°) to orientation. Spec section "Compass overlay".
export function yawToOrientation(yawDegrees: number): SlopeOrientation {
  const y = ((yawDegrees % 360) + 360) % 360;
  if (y >= 337.5 || y < 22.5) return 'N';
  if (y < 67.5) return 'NE';
  if (y < 112.5) return 'E';
  if (y < 157.5) return 'SE';
  if (y < 202.5) return 'S';
  if (y < 247.5) return 'SW';
  if (y < 292.5) return 'W';
  return 'NW';
}

// Convert pitch in degrees to standard ratio "X/12".
export function pitchDegreesToRatio(degrees: number): string {
  if (degrees < 1) return 'Flat';
  const rise = Math.round(Math.tan((degrees * Math.PI) / 180) * 12);
  return `${rise}/12`;
}

// -----------------------------------------------------------------------------
// Damage Marker + Finding (per-photo AI output)
// -----------------------------------------------------------------------------

export type DamageMarker = {
  id: string;
  category: DamageCategory;
  severity: Severity;
  // Normalized 0-1 coordinates relative to the photo's pixel rect.
  x: number;
  y: number;
  radius: number;
  confidence: number;       // 0-100
  note?: string;
  /**
   * Insurance Claim mode — one sentence tying this observation to the
   * inspection's cause of loss ("Fracture pattern consistent with hail
   * impact"). Optional at capture; the insurance report requires it on every
   * observation it presents (Professional Report doc).
   */
  causation?: string;
  /** Index into Slope.photoPaths that this marker belongs to. */
  photoIndex?: number;
  /**
   * Normalized 0-1 bounding box from Gemini's native bbox detection.
   * When present the overlay draws a true rectangle; absent (manual or
   * legacy markers) it falls back to the center+radius circle.
   */
  box?: { xmin: number; ymin: number; xmax: number; ymax: number };
};

export type InspectionFinding = {
  label: DamageCategory;
  detected: boolean;
  severity: Severity;
  confidence: number;       // 0-100
  count: number;
  note?: string;
  /** See DamageMarker.causation — links the finding to the cause of loss. */
  causation?: string;
};

// Spec-described shingle type classification surfaced by Gemini.
export type ShingleTypeClassification = {
  type: string;              // free-form label from Gemini (e.g. "architectural asphalt")
  confidence: number;        // 0-100
  note?: string;
};

// -----------------------------------------------------------------------------
// Storm Event (from NOAA or manual entry)
// -----------------------------------------------------------------------------

export type StormKind = 'hail' | 'wind' | 'mixed' | 'tornado';

export type StormEvent = {
  date: string;             // ISO 8601
  kind: StormKind;
  hailSizeInches?: number;
  windSpeedMph?: number;
  noaaEventId?: string;
  distanceMiles?: number;
  source: 'NOAA' | 'manual' | 'other';
};

/**
 * Outcome of the automatic NOAA storm search that runs at job creation.
 * Distinguishes "search ran and found nothing" ('no_match' — the only value
 * that lets the decision engine treat `weather_event_exists` as false, §4
 * step 1 / §6 LOW) from "service unreachable" ('unavailable') and "never ran"
 * (field absent). Mirrors `StormMatchResult['status']` in stormMatch.ts.
 */
export type StormSearchOutcome = 'matched' | 'no_match' | 'unavailable';

// -----------------------------------------------------------------------------
// Insurance Claim mode — Professional Report doc sections VI–IX.
// Selecting 'insurance_claim' makes the claim questionnaire mandatory; the
// Storm Damage Protocol (§VII) activates only for wind/hail causes of loss.
// -----------------------------------------------------------------------------

export type InspectionKind = 'general' | 'insurance_claim';

export const INSPECTION_KIND_LABELS: Record<InspectionKind, string> = {
  general: 'General Inspection',
  insurance_claim: 'Insurance Claim',
};

/** Primary Cause of Loss — exactly 7 values (Professional Report §VI). */
export const CAUSES_OF_LOSS = [
  'wind_damage',
  'hail_damage',
  'debris_impact',
  'wear_and_tear',
  'installation_defect',
  'manufacturer_defect',
  'maintenance_neglect',
] as const;

export type CauseOfLoss = (typeof CAUSES_OF_LOSS)[number];

export const CAUSE_OF_LOSS_LABELS: Record<CauseOfLoss, string> = {
  wind_damage: 'Wind Damage',
  hail_damage: 'Hail Damage',
  debris_impact: 'Debris Impact',
  wear_and_tear: 'Wear & Tear / Age',
  installation_defect: 'Installation Defect',
  manufacturer_defect: 'Manufacturer Defect',
  maintenance_neglect: 'Maintenance Neglect',
};

/** §VII Storm Damage Protocols apply only to wind and hail causes. */
export function isStormCause(cause: CauseOfLoss | null | undefined): boolean {
  return cause === 'wind_damage' || cause === 'hail_damage';
}

/** RCV = replacement cost value; ACV = actual cash value (depreciation withheld). */
export type PolicyType = 'RCV' | 'ACV';

export const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  RCV: 'RCV — Replacement Cost',
  ACV: 'ACV — Actual Cash Value',
};

/**
 * Claim Viability input (HAAG_DECISION_ENGINE.md §6): deductible ≤ 2% of home
 * value supports HIGH viability; above it is a LOW-viability signal.
 */
export const DEDUCTIBLE_HOME_VALUE_MAX_RATIO = 0.02;

/** undefined when either number is missing/invalid — never guess. */
export function isDeductibleHigh(
  deductible: number | undefined,
  homeValue: number | undefined,
): boolean | undefined {
  if (
    deductible === undefined || homeValue === undefined ||
    !Number.isFinite(deductible) || !Number.isFinite(homeValue) || homeValue <= 0
  ) {
    return undefined;
  }
  return deductible > homeValue * DEDUCTIBLE_HOME_VALUE_MAX_RATIO;
}

/**
 * The four canonical collateral evidence zones (Professional Report §VIII).
 * Soft-metal dents off the roof corroborate the storm; each zone gets
 * photographed even when clean — a no-damage photo proves the zone was
 * inspected. Distinct from the legacy `collateralChecklist` quick-observation
 * booleans, which stay untouched for older records.
 */
export const COLLATERAL_ZONES = [
  'gutters_downspouts',
  'hvac_condenser_fins',
  'siding_window_screens',
  'soft_metal_roof_vents',
] as const;

export type CollateralZone = (typeof COLLATERAL_ZONES)[number];

export const COLLATERAL_ZONE_LABELS: Record<CollateralZone, string> = {
  gutters_downspouts: 'Gutters & Downspouts',
  hvac_condenser_fins: 'HVAC Condenser Fins',
  siding_window_screens: 'Siding & Window Screens',
  soft_metal_roof_vents: 'Soft-Metal Roof Vents',
};

export const COLLATERAL_ZONE_HINTS: Record<CollateralZone, string> = {
  gutters_downspouts: 'Look for dents, not blockage',
  hvac_condenser_fins: 'Crushed or flattened fins on the condenser coil',
  siding_window_screens: 'Impact marks, torn screens, cracked siding',
  soft_metal_roof_vents: 'Dings on turtle vents, turbines, flashing caps',
};

export type CollateralChecklistItem = {
  /** True once the zone has been inspected (damaged or clean). */
  checked: boolean;
  /** Local photo URIs of the zone (photoSync maps local → remote). */
  photoIds: string[];
  note?: string;
};

export type CollateralEvidence = Record<CollateralZone, CollateralChecklistItem>;

export function emptyCollateralEvidence(): CollateralEvidence {
  return {
    gutters_downspouts: { checked: false, photoIds: [] },
    hvac_condenser_fins: { checked: false, photoIds: [] },
    siding_window_screens: { checked: false, photoIds: [] },
    soft_metal_roof_vents: { checked: false, photoIds: [] },
  };
}

// -----------------------------------------------------------------------------
// Photo capture — 19-area subject tagging + the two capture modes
// -----------------------------------------------------------------------------

/**
 * The 19 canonical capture subjects (Camera prompt). Roof slopes lead so the
 * common picks sit closest to a gloved thumb; the label rides the photo into
 * the report.
 */
export const AREA_TAGS = [
  'Front Slope',
  'Rear Slope',
  'Left Slope',
  'Right Slope',
  'Ridge / Hip',
  'Valley',
  'Flashing / Penetrations',
  'Gutters / Downspouts',
  'Fascia / Soffit',
  'Siding',
  'Windows',
  'Window Screens',
  'Garage Door',
  'Fence / Gate',
  'HVAC Condenser',
  'Roof Vents / Soft Metals',
  'Chimney',
  'Skylight',
  'Other',
] as const;

export type AreaTag = (typeof AREA_TAGS)[number];

/**
 * The two capture modes. Their hit counts aggregate **separately** in reports
 * (Camera prompt): a 10x10 test square is the HAAG per-square denominator, a
 * single-shingle close-up is not and must never be mixed into it.
 */
export type CaptureMode = 'square_10x10' | 'single_shingle';

export const CAPTURE_MODE_LABELS: Record<CaptureMode, string> = {
  square_10x10: '10x10 Square',
  single_shingle: 'Single Shingle',
};

/**
 * Per-photo capture metadata, keyed by index into `Slope.photoPaths`.
 * `areaTag` is a plain string (values come from AREA_TAGS) so older or
 * free-form persisted labels still load.
 */
export type PhotoMeta = {
  photoIndex: number;
  areaTag?: string;
  captureMode?: CaptureMode;
};

// -----------------------------------------------------------------------------
// Slope + Inspection
// -----------------------------------------------------------------------------

export type SlopeVerdict = 'repair' | 'partial_replace' | 'full_replace' | 'verify_with_inspector';

export type Slope = {
  id: string;
  orientation: SlopeOrientation;
  pitchDegrees?: number;
  areaSquares: number;          // 1 square = 100 sq ft
  detectedAreaSquares?: number; // from Solar API
  damage: DamageMarker[];
  hailCount: number;
  windLiftCount: number;
  wearCount: number;
  missingCount: number;
  bruisingCount: number;
  functional: boolean;          // functional vs cosmetic
  verdict?: SlopeVerdict;
  verifyWithInspector: boolean; // when confidence_avg < 0.5
  aiFindings?: InspectionFinding[];
  photoPaths: string[];
  /**
   * Indices into photoPaths that have been run through Gemini — the
   * authoritative "was this photo analyzed" record. Older persisted
   * inspections predate this field (undefined); read sites fall back to
   * treating every captured photo as analyzed rather than showing none.
   * Deliberately independent of `damage`: a photo that was analyzed and
   * found clean has zero markers but must still count as analyzed.
   */
  analyzedPhotoIndices?: number[];
  /** localUri → Supabase Storage public URL, written by photoSync. */
  photoUploads?: Record<string, string>;
  /**
   * Per-photo shingle-scale calibration estimates from Gemini (keyed by
   * photoIndex), persisted for calibration logging. Optional — older
   * inspections predate this field. Rides the whole-Inspection JSON payload
   * through inspectionSync automatically.
   */
  scaleEstimates?: {
    photoIndex: number;
    pixelsPerInch: number | null;
    confidence: number;
    reference?: string;
  }[];
  /**
   * Per-photo area tag + capture mode. Absent on photos captured before
   * tagging existed; entries are renumbered alongside photoPaths on delete.
   */
  photoMeta?: PhotoMeta[];
  /**
   * Hit counts aggregated per capture mode — kept apart because only the
   * 10x10 square feeds the HAAG per-square threshold. Absent until a
   * mode-tagged capture writes them; never derive one from the other.
   */
  squareHitCount?: number;
  singleShingleHitCount?: number;
};

export type InspectionStatus = 'lead' | 'scheduled' | 'in_progress' | 'complete';

export type RoofRecommendation = 'repair' | 'partial_replacement' | 'full_replacement';

export type Inspection = {
  id: string;
  reportId: string;             // auto-minted "RW-2026-####"
  createdAt: string;            // ISO 8601
  status: InspectionStatus;

  // Customer & Property
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  address: string;
  lat?: number;
  lng?: number;

  // Insurance
  carrier?: InsuranceCarrier;
  policyNumber?: string;
  claimNumber?: string;
  adjusterName?: string;

  // Insurance Claim mode (Professional Report §VI–IX). All optional so
  // persisted pre-claim-mode inspections load unchanged; absent `kind`
  // reads as 'general'.
  kind?: InspectionKind;
  causeOfLoss?: CauseOfLoss;
  policyType?: PolicyType;
  deductible?: number;              // dollars
  homeValue?: number;               // dollars — for the deductible ≤2% viability check
  priorClaimsWithin3Years?: boolean;
  /**
   * Date of loss as reported by the homeowner (§VII). Written for every
   * insurance-claim cause, not only storm ones.
   *
   * ISO timestamp at LOCAL NOON. A bare 'YYYY-MM-DD' parses as UTC midnight
   * and renders as the previous day in every US timezone — an off-by-one on
   * the one date an adjuster actually verifies against weather records. Any
   * new editor must write the same shape:
   * `new Date(y, m - 1, d, 12, 0, 0).toISOString()`.
   */
  dateOfLoss?: string;
  collateralEvidence?: CollateralEvidence;
  brittlenessProtocol?: BrittlenessProtocol;
  /** §IX — local code items that expand covered scope (ventilation, ice & water shield). */
  codeComplianceNotes?: string;

  // Roof System
  material: RoofMaterial;
  ageYears: number;
  geometry: RoofGeometry;
  condition: RoofCondition;
  brittlenessTest: BrittlenessTest;
  collateralChecklist: Record<string, boolean>;

  // Event
  event?: StormEvent;
  /** How the automatic storm search resolved — absent on inspections that never searched. */
  stormSearchOutcome?: StormSearchOutcome;

  // Slopes
  slopes: Slope[];

  // Roof-level outputs
  roofRecommendation?: RoofRecommendation;
  roofVerdictReasoning?: string;
  verifyWithInspector: boolean;

  /**
   * Frozen decision-engine snapshot (a JSON-serializable `HaagEngineResult`),
   * so a finalized report keeps showing the numbers it was signed with.
   * Typed `unknown` to keep the model layer free of a services import — read
   * sites cast it through the reports helper.
   */
  storedEngineResult?: unknown;
  /** ISO timestamp the storedEngineResult snapshot was taken. */
  storedEngineResultAt?: string;
  /** ISO timestamp the report was finalized — gates the finalize step. */
  reportFinalizedAt?: string;

  // Traceability
  originEstimateId?: string;

  // Signatures
  inspectorSignaturePng?: string;  // base64 or file URI
  inspectorSignatureSvg?: string;  // serialized SVG path
  homeownerSignaturePng?: string;
  homeownerSignatureSvg?: string;
  signedAt?: string;

  // Voice notes
  audioNotes?: AudioNote[];

  // Free-form notes
  notes?: string;
};

export type AudioNote = {
  id: string;
  uri: string;
  durationSec: number;
  recordedAt: string;
  label?: string;
};

// -----------------------------------------------------------------------------
// Insurance carriers — Tier 1 + insurtechs + regional (spec page 1522-1605)
// -----------------------------------------------------------------------------

export type InsuranceCarrier =
  // Tier 1
  | 'state_farm' | 'allstate' | 'usaa' | 'liberty_mutual'
  | 'farmers' | 'travelers' | 'nationwide' | 'erie'
  // Insurtechs
  | 'hippo' | 'lemonade' | 'kin' | 'branch' | 'openly'
  // Regional
  | 'texas_farm_bureau' | 'oklahoma_farm_bureau' | 'kansas_farm_bureau'
  | 'mercury' | 'aaa' | 'american_family'
  | 'other';

export const INSURANCE_CARRIER_TIER: Record<InsuranceCarrier, 'tier1' | 'insurtech' | 'regional' | 'other'> = {
  state_farm: 'tier1', allstate: 'tier1', usaa: 'tier1', liberty_mutual: 'tier1',
  farmers: 'tier1', travelers: 'tier1', nationwide: 'tier1', erie: 'tier1',
  hippo: 'insurtech', lemonade: 'insurtech', kin: 'insurtech', branch: 'insurtech', openly: 'insurtech',
  texas_farm_bureau: 'regional', oklahoma_farm_bureau: 'regional', kansas_farm_bureau: 'regional',
  mercury: 'regional', aaa: 'regional', american_family: 'regional',
  other: 'other',
};

export const INSURANCE_CARRIER_LABELS: Record<InsuranceCarrier, string> = {
  state_farm: 'State Farm', allstate: 'Allstate', usaa: 'USAA', liberty_mutual: 'Liberty Mutual',
  farmers: 'Farmers', travelers: 'Travelers', nationwide: 'Nationwide', erie: 'Erie',
  hippo: 'Hippo', lemonade: 'Lemonade', kin: 'Kin', branch: 'Branch', openly: 'Openly',
  texas_farm_bureau: 'Texas Farm Bureau', oklahoma_farm_bureau: 'Oklahoma Farm Bureau',
  kansas_farm_bureau: 'Kansas Farm Bureau', mercury: 'Mercury', aaa: 'AAA',
  american_family: 'American Family', other: 'Other',
};

// -----------------------------------------------------------------------------
// CRM-ish models
// -----------------------------------------------------------------------------

/**
 * Pipeline stages. The first line is the original set — kept verbatim so
 * persisted leads never fail to load; the second line adds the Kanban PRD's
 * post-sale stages. `proposal_sent` is the legacy spelling of `estimate_sent`
 * and folds into that column via `leadStageColumn()`.
 */
export type LeadStage =
  | 'new' | 'contacted' | 'inspection_scheduled' | 'inspected'
  | 'proposal_sent' | 'signed' | 'lost'
  | 'estimate_sent' | 'install_scheduled' | 'in_progress'
  | 'completed' | 'invoiced' | 'paid';

/**
 * The 11 board columns in display order (Kanban PRD). `lost` is terminal and
 * deliberately off-board; `proposal_sent` is absent because it maps onto
 * `estimate_sent` — bucket leads with `leadStageColumn()`, not raw equality.
 */
export const LEAD_STAGE_ORDER: LeadStage[] = [
  'new',
  'contacted',
  'inspection_scheduled',
  'inspected',
  'estimate_sent',
  'signed',
  'install_scheduled',
  'in_progress',
  'completed',
  'invoiced',
  'paid',
];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New Lead',
  contacted: 'Contacted',
  inspection_scheduled: 'Inspection Scheduled',
  inspected: 'Inspection Complete',
  proposal_sent: 'Proposal Sent',
  estimate_sent: 'Estimate Sent',
  signed: 'Approved / Signed',
  install_scheduled: 'Scheduled for Install',
  in_progress: 'In Progress',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
  lost: 'Lost',
};

/** Board column a stage renders in — folds the legacy `proposal_sent`. */
export function leadStageColumn(stage: LeadStage): LeadStage {
  return stage === 'proposal_sent' ? 'estimate_sent' : stage;
}

export type Lead = {
  id: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  address: string;
  lat?: number;
  lng?: number;
  stage: LeadStage;
  source?: string;
  value?: number;
  lastContactAt?: string;
  followUpAt?: string;
  createdAt: string;
  updatedAt?: string;
  /**
   * When `stage` last changed. Distinct from `updatedAt`, which any write
   * bumps (follow-up, storm match) — the Pipeline board's days-in-stage
   * number is only honest if it measures the stage, not the last touch.
   */
  stageChangedAt?: string;
  syncStatus?: 'pending' | 'synced' | 'failed';
  /**
   * Last NOAA storm this address matched. Absent means "never checked" —
   * distinct from a check that found nothing, which never writes this field.
   */
  lastStormMatch?: {
    eventDate: string;
    distanceMiles: number;
    hailInches?: number;
    matchedAt: string;
  };
};

export type JobStatus = 'scheduled' | 'in_progress' | 'awaiting_adjuster' | 'done' | 'lost';

export type Job = {
  id: string;
  inspectionId?: string;
  proposalId?: string;
  customerName: string;
  address: string;
  status: JobStatus;
  damageScore?: number;          // 0-100
  scheduledAt?: string;
  installStartAt?: string;
  installEndAt?: string;
  crewLead?: string;
};

// -----------------------------------------------------------------------------
// Knock + KnockSession (door-knocking mode)
// -----------------------------------------------------------------------------

export type KnockOutcome =
  | 'not_home' | 'interested' | 'not_interested'
  | 'inspection_scheduled' | 'follow_up';

export type Knock = {
  id: string;
  sessionId: string;
  lat: number;
  lng: number;
  address?: string;
  outcome: KnockOutcome;
  notes?: string;
  followUpAt?: string;
  createdLeadId?: string;
  createdAt: string;
};

export type KnockSession = {
  id: string;
  startedAt: string;
  endedAt?: string;
  routeStormAlertId?: string;
  knocks: Knock[];
};

// -----------------------------------------------------------------------------
// Service Area + Storm Alert
// -----------------------------------------------------------------------------

export type ServiceArea = {
  id: string;
  label: string;          // "Plano, TX" or "75024"
  kind: 'zip' | 'city';
  centroidLat?: number;
  centroidLng?: number;
};

export type StormAlertStatus = 'new' | 'dismissed' | 'acted_on';

export type StormAlert = {
  id: string;
  firedAt: string;
  eventKind: StormKind;
  areaLabel: string;
  propertyCount: number;
  status: StormAlertStatus;
  hailSizeInches?: number;
  windSpeedMph?: number;
};

// -----------------------------------------------------------------------------
// Proposal
// -----------------------------------------------------------------------------

export type ProposalLineItem = {
  id: string;
  label: string;
  unit: string;            // "sq" | "ft" | "ea"
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired';

export type Proposal = {
  id: string;
  jobId: string;
  status: ProposalStatus;
  coverNarrative?: string;
  scopeOfWork?: string;
  lineItems: ProposalLineItem[];
  subtotal: number;
  tax: number;
  deposit: number;
  total: number;
  warrantyYears: number;
  termsText?: string;
  expirationAt?: string;
  sentTo?: string;
  sentAt?: string;
  viewedAt?: string;
  signedAt?: string;
  signaturePng?: string;
  /** Serialized SVG path string of the homeowner signature ("M x y L x y …"). */
  homeownerSignatureSvg?: string;
};

// -----------------------------------------------------------------------------
// Training Queue + Corrections (Phase 9 — recursive learning loop)
// -----------------------------------------------------------------------------

export type TrainingItemStatus = 'pending' | 'reviewed' | 'discarded';

export type TrainingItem = {
  id: string;
  inspectionId: string;
  slopeId?: string;
  photoPath: string;
  originalAnalysis: {
    findings: InspectionFinding[];
    markers: DamageMarker[];
  };
  status: TrainingItemStatus;
  enqueuedAt: string;
};

/** `swipe_correct` is the up-swipe gesture — distinct from a deliberate `edit`. */
export type CorrectionType =
  | 'swipe_accept' | 'swipe_reject' | 'swipe_correct'
  | 'edit' | 'add_marker' | 'remove_marker';

export type Correction = {
  id: string;
  inspectionId: string;
  photoId: string;
  slopeId?: string;
  correctionType: CorrectionType;
  categoriesAffected: DamageCategory[];
  originalDetection: { findings: InspectionFinding[]; markers: DamageMarker[] };
  correctedDetection: { findings: InspectionFinding[]; markers: DamageMarker[] };
  delta: Record<string, unknown>;
  photoUrl?: string;
  photoHash?: string;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  correctedAt: string;
  /** How sure the contractor was, 1-5 stars. Absent when not asked. */
  confidenceStars?: 1 | 2 | 3 | 4 | 5;
  /** Future certification weighting for the learning loop. Absent by default. */
  inspectorTrustWeight?: number;
};

export type UserCorrectionProfile = {
  totalCorrections: number;
  perCategoryAccuracy: Record<DamageCategory, number>;
  underCount: Record<DamageCategory, number>;
  overCount: Record<DamageCategory, number>;
  calibrationOffset: Record<DamageCategory, number>;
  updatedAt: string;
};

// -----------------------------------------------------------------------------
// Activity Feed
// -----------------------------------------------------------------------------

export type ActivityEventKind =
  | 'job_created' | 'slope_saved' | 'photo_captured' | 'analysis_ran'
  | 'weather_checked' | 'proposal_sent' | 'proposal_signed'
  | 'signature_recorded' | 'knock_logged' | 'knock_converted_to_lead'
  | 'route_completed' | 'ai_calibration_updated' | 'storm_alert_received'
  | 'lead_created' | 'inspection_completed' | 'pdf_generated';

export type ActivityEvent = {
  id: string;
  kind: ActivityEventKind;
  jobId?: string;
  inspectionId?: string;
  leadId?: string;
  proposalId?: string;
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

// -----------------------------------------------------------------------------
// Mileage tracker
// -----------------------------------------------------------------------------

export type SavedEstimate = {
  id: string;
  createdAt: string;
  address: string;
  lat?: number;
  lng?: number;
  material: RoofMaterial;
  scope: 'repair' | 'partial_replacement' | 'full_replacement';
  totalSquares: number;
  totalLow: number;
  totalMid: number;
  totalHigh: number;
};

export type MileageTrip = {
  id: string;
  startedAt: string;
  endedAt: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  startAddress?: string;
  endAddress?: string;
  miles: number;
  purpose?: string;       // "inspection", "knocking", "supply run", etc.
};

// -----------------------------------------------------------------------------
// Schedule entry (today's plan)
// -----------------------------------------------------------------------------

export type ScheduleEntry = {
  id: string;
  kind: 'inspection' | 'install' | 'meeting' | 'travel';
  title: string;
  address?: string;
  startAt: string;
  endAt?: string;
  jobId?: string;
};

// -----------------------------------------------------------------------------
// Asset helpers
// -----------------------------------------------------------------------------

export type AssetRef = string | ImageSourcePropType;
