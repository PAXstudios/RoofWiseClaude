// Roof replacement cost estimator. Pure function over (material, squares,
// scope, region). Returns a Low / Mid / High range with per-line-item
// breakdown.
//
// Regional pricing is a simple multiplier vs. a baseline. Material pricing
// is per-square (one square = 100 sq ft).
//
// Numbers below are 2026 baselines averaged across published contractor
// pricing for the US. They are intentionally conservative; adjust the
// table when you have local data.

import type { RoofMaterial } from '../models/types';

export type Region = 'south' | 'midwest' | 'northeast' | 'west' | 'mountain';

export type DamageScope = 'repair' | 'partial_replacement' | 'full_replacement';

export type CostLineItem = {
  key: string;
  label: string;
  unit: 'sq' | 'lf' | 'ea';
  quantity: number;
  unitPriceLow: number;
  unitPriceHigh: number;
};

export type CostEstimate = {
  material: RoofMaterial;
  region: Region;
  scope: DamageScope;
  totalSquares: number;
  lineItems: CostLineItem[];
  totalLow: number;
  totalMid: number;
  totalHigh: number;
};

const REGION_MULTIPLIER: Record<Region, number> = {
  south: 1.0,
  midwest: 1.04,
  northeast: 1.18,
  west: 1.22,
  mountain: 1.1,
};

// Per-square material pricing (Low–High USD per square installed). Includes
// material + labor for an asphalt teardown; for tile / metal labor and
// disposal are included.
const MATERIAL_PRICING: Record<RoofMaterial, { low: number; high: number }> = {
  three_tab_asphalt:      { low: 330, high: 450 },
  architectural_asphalt:  { low: 430, high: 600 },
  luxury_asphalt:         { low: 600, high: 850 },
  wood_shake:             { low: 950, high: 1500 },
  wood_shingle:           { low: 850, high: 1300 },
  metal_standing_seam:    { low: 950, high: 1600 },
  metal_shingle:          { low: 800, high: 1300 },
  clay_tile:              { low: 1050, high: 1800 },
  concrete_tile:          { low: 800, high: 1400 },
  slate:                  { low: 1500, high: 3000 },
  synthetic_slate:        { low: 900, high: 1600 },
  composite:              { low: 700, high: 1100 },
  rolled_roofing:         { low: 250, high: 450 },
  tpo:                    { low: 600, high: 950 },
  epdm:                   { low: 550, high: 900 },
};

const SCOPE_FACTOR: Record<DamageScope, number> = {
  repair: 0.25,            // ~25% of full replacement
  partial_replacement: 0.55,
  full_replacement: 1.0,
};

export function estimateCost(input: {
  material: RoofMaterial;
  region: Region;
  scope: DamageScope;
  totalSquares: number;
}): CostEstimate {
  const { material, region, scope, totalSquares } = input;
  const matPrice = MATERIAL_PRICING[material];
  const regionMult = REGION_MULTIPLIER[region];
  const scopeFactor = SCOPE_FACTOR[scope];

  const effectiveSquares = totalSquares * scopeFactor;

  const lineItems: CostLineItem[] = [
    {
      key: 'tear_off',
      label: 'Tear-off & disposal',
      unit: 'sq',
      quantity: effectiveSquares,
      unitPriceLow: 60 * regionMult,
      unitPriceHigh: 110 * regionMult,
    },
    {
      key: 'underlayment',
      label: 'Underlayment + ice/water shield',
      unit: 'sq',
      quantity: effectiveSquares,
      unitPriceLow: 35 * regionMult,
      unitPriceHigh: 70 * regionMult,
    },
    {
      key: 'shingles',
      label: 'Shingles / panels (installed)',
      unit: 'sq',
      quantity: effectiveSquares,
      unitPriceLow: matPrice.low * regionMult,
      unitPriceHigh: matPrice.high * regionMult,
    },
    {
      key: 'flashing',
      label: 'Flashing, drip edge, valleys',
      unit: 'sq',
      quantity: effectiveSquares,
      unitPriceLow: 45 * regionMult,
      unitPriceHigh: 90 * regionMult,
    },
    {
      key: 'ventilation',
      label: 'Ridge vent / boots / ventilation',
      unit: 'sq',
      quantity: effectiveSquares,
      unitPriceLow: 25 * regionMult,
      unitPriceHigh: 55 * regionMult,
    },
    {
      key: 'permits',
      label: 'Permits, dump, cleanup',
      unit: 'ea',
      quantity: 1,
      unitPriceLow: 250 * regionMult,
      unitPriceHigh: 650 * regionMult,
    },
  ];

  const totalLow = lineItems.reduce((s, li) => s + li.unitPriceLow * li.quantity, 0);
  const totalHigh = lineItems.reduce((s, li) => s + li.unitPriceHigh * li.quantity, 0);
  const totalMid = (totalLow + totalHigh) / 2;

  return {
    material,
    region,
    scope,
    totalSquares,
    lineItems,
    totalLow: Math.round(totalLow),
    totalMid: Math.round(totalMid),
    totalHigh: Math.round(totalHigh),
  };
}

export function regionForState(stateAbbr?: string): Region {
  if (!stateAbbr) return 'south';
  const s = stateAbbr.toUpperCase();
  if (['TX', 'OK', 'LA', 'AR', 'MS', 'AL', 'GA', 'FL', 'SC', 'NC', 'TN', 'VA', 'KY'].includes(s)) return 'south';
  if (['NY', 'NJ', 'PA', 'CT', 'MA', 'RI', 'NH', 'VT', 'ME', 'MD', 'DE'].includes(s)) return 'northeast';
  if (['CA', 'OR', 'WA', 'NV', 'HI'].includes(s)) return 'west';
  if (['CO', 'NM', 'UT', 'WY', 'MT', 'AZ', 'ID'].includes(s)) return 'mountain';
  return 'midwest';
}
