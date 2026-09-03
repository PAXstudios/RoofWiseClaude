// Roof replacement cost estimator. Pure function over (material, squares,
// scope, region). Returns a Low / Mid / High range with per-line-item
// breakdown.
//
// Regional pricing is a simple multiplier vs. a baseline. Material pricing
// is per-square (one square = 100 sq ft).
//
// Numbers below are 2026 baselines averaged across published contractor
// pricing for the US — the fallback path when the roofer has not set their
// own price book (lib/stores/pricingStore.ts). Once `pricing.customized` is
// true, `estimateCost` prices from the roofer's OWN numbers instead: they
// already reflect the roofer's real, local market, so the generic regional
// multiplier below is not layered on top of them (it stays in force only on
// the still-generic fallback numbers — the material/labor/tear-off/
// accessory lines and the still-hardcoded permits line).

import type { RoofMaterial } from '../models/types';
import type { PricingAccessory, PricingBook } from '../stores/pricingStore';

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
  /** Price-book provenance, so every consumer can state which numbers priced
   *  this estimate (Wave C requirement). `0` = the RoofWise fallback table
   *  above, never the roofer's own book. */
  priceBookVersion: number;
  priceBookUpdatedAt?: string;
  /** False on the RoofWise fallback table AND on an unedited starting price
   *  book — true only once the roofer has actually changed a number
   *  (Drift #5: a seeded default is never presented as the roofer's price). */
  priceBookCustomized: boolean;
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

/**
 * Rough quantity heuristic for the accessory catalog's linear-foot / each
 * items — there is no ridge-length or vent-count model on the property yet
 * (BACKLOG "Traced roof outline" is the eventual real source). Flagged as
 * "estimated" in the line label, never presented as a measurement.
 */
function accessoryQuantity(unit: PricingAccessory['unit'], effectiveSquares: number): number {
  if (unit === 'sq') return effectiveSquares;
  if (unit === 'lf') return Math.round(effectiveSquares * 10); // ~10 lf / square, estimated
  return Math.max(1, Math.ceil(effectiveSquares / 15)); // ~1 unit / 15 squares, estimated
}

export function estimateCost(
  input: {
    material: RoofMaterial;
    region: Region;
    scope: DamageScope;
    totalSquares: number;
  },
  /** The roofer's own price book. Omitted, or not yet `customized`, falls
   *  back to the RoofWise table above untouched. */
  pricing?: PricingBook,
): CostEstimate {
  const { material, region, scope, totalSquares } = input;
  const regionMult = REGION_MULTIPLIER[region];
  const scopeFactor = SCOPE_FACTOR[scope];
  const effectiveSquares = totalSquares * scopeFactor;

  let lineItems: CostLineItem[];

  if (pricing?.customized) {
    // The roofer's own numbers ARE the local market — no generic regional
    // multiplier layered on top of them. Firm figures, not a range: low=high
    // states plainly that this is what the roofer actually charges, not a
    // fabricated spread. Permits stay on the generic region-multiplied
    // fallback below (Drift #5: pricingStore does not model it, so this line
    // is disclosed, elsewhere, as an estimate rather than invented here too).
    const markup = 1 + pricing.markupPercent / 100;
    const material_ = pricing.materialPricePerSquare[material] * markup;
    const labor = pricing.laborPerSquare * markup;
    lineItems = [
      {
        key: 'tear_off',
        label: 'Tear-off & disposal',
        unit: 'sq',
        quantity: effectiveSquares,
        unitPriceLow: pricing.tearOffPerSquare,
        unitPriceHigh: pricing.tearOffPerSquare,
      },
      {
        key: 'material',
        label: 'Material (installed)',
        unit: 'sq',
        quantity: effectiveSquares,
        unitPriceLow: material_,
        unitPriceHigh: material_,
      },
      {
        key: 'labor',
        label: 'Labor',
        unit: 'sq',
        quantity: effectiveSquares,
        unitPriceLow: labor,
        unitPriceHigh: labor,
      },
      ...pricing.accessories.map((a) => {
        const qty = accessoryQuantity(a.unit, effectiveSquares);
        const price = a.unitPrice * markup;
        return {
          key: `accessory_${a.key}`,
          label: a.unit === 'sq' ? a.label : `${a.label} (≈${qty} ${a.unit}, estimated)`,
          unit: a.unit,
          quantity: qty,
          unitPriceLow: price,
          unitPriceHigh: price,
        } satisfies CostLineItem;
      }),
      {
        key: 'permits',
        label: 'Permits, dump, cleanup (estimated)',
        unit: 'ea',
        quantity: 1,
        unitPriceLow: 250 * regionMult,
        unitPriceHigh: 650 * regionMult,
      },
    ];
  } else {
    const matPrice = MATERIAL_PRICING[material];
    lineItems = [
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
  }

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
    priceBookVersion: pricing?.customized ? pricing.revision : 0,
    priceBookUpdatedAt: pricing?.customized ? pricing.updatedAt : undefined,
    priceBookCustomized: pricing?.customized ?? false,
  };
}

/**
 * Two-letter state from a free-text address ("…, Plano, TX 75024" → "TX").
 * The estimator used to call `regionForState()` with nothing and priced
 * every address at the Texas multiplier (audit P1 #11); the proposal parsed
 * the state, so the two disagreed by up to 22 % on the same house.
 */
export function stateFromAddress(addr: string | undefined): string | undefined {
  if (!addr) return undefined;
  const m = addr.toUpperCase().match(/\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,?\s*USA?)?\s*$/);
  return m ? m[1] : undefined;
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
