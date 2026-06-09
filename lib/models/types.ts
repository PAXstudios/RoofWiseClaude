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
export type BrittlenessTest = 'not_tested' | 'passed' | 'failed';

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
  /** Index into Slope.photoPaths that this marker belongs to. */
  photoIndex?: number;
};

export type InspectionFinding = {
  label: DamageCategory;
  detected: boolean;
  severity: Severity;
  confidence: number;       // 0-100
  count: number;
  note?: string;
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

  // Roof System
  material: RoofMaterial;
  ageYears: number;
  geometry: RoofGeometry;
  condition: RoofCondition;
  brittlenessTest: BrittlenessTest;
  collateralChecklist: Record<string, boolean>;

  // Event
  event?: StormEvent;

  // Slopes
  slopes: Slope[];

  // Roof-level outputs
  roofRecommendation?: RoofRecommendation;
  roofVerdictReasoning?: string;
  verifyWithInspector: boolean;

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

export type LeadStage =
  | 'new' | 'contacted' | 'inspection_scheduled' | 'inspected'
  | 'proposal_sent' | 'signed' | 'lost';

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
  syncStatus?: 'pending' | 'synced' | 'failed';
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

export type CorrectionType = 'swipe_accept' | 'swipe_reject' | 'edit' | 'add_marker' | 'remove_marker';

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
