// The roofer's own price book — per-square material/labor/tear-off rates,
// markup/tax/deposit percentages, and a small accessory catalog. Everything
// here starts at a sensible non-RoofWise-endorsed placeholder and is meant to
// be overwritten: Drift #5 forbids presenting seeded numbers as market truth,
// so `customized` stays false (and every consumer must say "starting
// numbers — set yours") until the roofer edits something themselves.
//
// `revision` + `updatedAt` are the price-book provenance stamp: every
// estimate and proposal this book prices carries them, so a document can
// always say which price book produced it (app/estimator.tsx,
// lib/services/{costEstimator,proposalGenerator,proposalPdf}.ts).

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ROOF_MATERIAL_LABELS, type RoofMaterial } from '../models/types';

export type PricingAccessoryKey = 'ridge_cap' | 'drip_edge' | 'ice_water_shield' | 'ventilation';

export type PricingAccessory = {
  key: PricingAccessoryKey;
  label: string;
  /** 'lf' and 'ea' quantities are estimated from squares by costEstimator.ts
   *  (no ridge-length / vent-count model exists yet) — flagged in the line
   *  item label, never presented as a measurement. */
  unit: 'sq' | 'lf' | 'ea';
  unitPrice: number;
};

export type PricingBook = {
  materialPricePerSquare: Record<RoofMaterial, number>;
  /** Separate labor line. Defaults to 0 — the starting material numbers below
   *  are carried over from the app's prior all-in installed pricing, so a
   *  fresh install must not silently double-count labor. Set this only when
   *  pricing labor as its own line. */
  laborPerSquare: number;
  tearOffPerSquare: number;
  markupPercent: number;
  taxPercent: number;
  depositPercent: number;
  accessories: PricingAccessory[];
  /** Bumped on every edit. Stamped onto every estimate/proposal this book
   *  prices (`priceBookVersion`) so a document can always say which numbers
   *  it used. */
  revision: number;
  updatedAt: string;
  /** False until the roofer changes a number. Gates the "starting numbers —
   *  set yours" disclosure (Drift #5): never let a seeded default be read as
   *  the roofer's real pricing. */
  customized: boolean;
};

// Carried over from the previous hardcoded MATERIAL_PRICING mid-points
// (lib/services/costEstimator.ts) so the starting book prices roughly where
// the app already did — a scaffold to correct, not a market claim.
const STARTING_MATERIAL_PRICE: Record<RoofMaterial, number> = {
  three_tab_asphalt: 390,
  architectural_asphalt: 515,
  luxury_asphalt: 725,
  wood_shake: 1225,
  wood_shingle: 1075,
  metal_standing_seam: 1275,
  metal_shingle: 1050,
  clay_tile: 1425,
  concrete_tile: 1100,
  slate: 2250,
  synthetic_slate: 1250,
  composite: 900,
  rolled_roofing: 350,
  tpo: 775,
  epdm: 725,
};

function startingMaterialPrices(): Record<RoofMaterial, number> {
  // Object.keys(ROOF_MATERIAL_LABELS) is the canonical RoofMaterial list —
  // there is no separate ROOF_MATERIALS array export.
  const out = {} as Record<RoofMaterial, number>;
  for (const m of Object.keys(ROOF_MATERIAL_LABELS) as RoofMaterial[]) {
    out[m] = STARTING_MATERIAL_PRICE[m] ?? 500;
  }
  return out;
}

const STARTING_ACCESSORIES: PricingAccessory[] = [
  { key: 'ridge_cap', label: 'Ridge cap', unit: 'lf', unitPrice: 6 },
  { key: 'drip_edge', label: 'Drip edge', unit: 'lf', unitPrice: 3 },
  { key: 'ice_water_shield', label: 'Ice & water shield', unit: 'sq', unitPrice: 120 },
  { key: 'ventilation', label: 'Ventilation', unit: 'ea', unitPrice: 350 },
];

function defaultBook(): PricingBook {
  return {
    materialPricePerSquare: startingMaterialPrices(),
    laborPerSquare: 0,
    tearOffPerSquare: 85,
    markupPercent: 20,
    taxPercent: 8.25,
    depositPercent: 25,
    accessories: STARTING_ACCESSORIES.map((a) => ({ ...a })),
    revision: 0,
    updatedAt: new Date().toISOString(),
    customized: false,
  };
}

type PricingState = {
  book: PricingBook;
  /** Any subset of the flat rate fields. */
  updateRates: (
    patch: Partial<
      Pick<
        PricingBook,
        'laborPerSquare' | 'tearOffPerSquare' | 'markupPercent' | 'taxPercent' | 'depositPercent'
      >
    >,
  ) => void;
  updateMaterialPrice: (material: RoofMaterial, pricePerSquare: number) => void;
  updateAccessory: (key: PricingAccessoryKey, patch: Partial<Pick<PricingAccessory, 'unitPrice' | 'unit'>>) => void;
  /** Back to the starting numbers — still `customized: false` after, since
   *  nothing the roofer set survives a reset. */
  reset: () => void;
};

function touch(book: PricingBook): Pick<PricingBook, 'revision' | 'updatedAt' | 'customized'> {
  return { revision: book.revision + 1, updatedAt: new Date().toISOString(), customized: true };
}

export const usePricingStore = create<PricingState>()(
  persist(
    (set) => ({
      book: defaultBook(),

      updateRates: (patch) =>
        set((s) => {
          const book = { ...s.book, ...patch };
          return { book: { ...book, ...touch(book) } };
        }),

      updateMaterialPrice: (material, pricePerSquare) =>
        set((s) => {
          const book = {
            ...s.book,
            materialPricePerSquare: {
              ...s.book.materialPricePerSquare,
              [material]: Math.max(0, pricePerSquare),
            },
          };
          return { book: { ...book, ...touch(book) } };
        }),

      updateAccessory: (key, patch) =>
        set((s) => {
          const book = {
            ...s.book,
            accessories: s.book.accessories.map((a) => (a.key === key ? { ...a, ...patch } : a)),
          };
          return { book: { ...book, ...touch(book) } };
        }),

      reset: () => set({ book: defaultBook() }),
    }),
    {
      name: 'roofwise.pricing.v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ book: s.book }),
      // Deep-merge so a shape change (a material or accessory added after a
      // roofer already customized their book) fills in only the new keys
      // instead of losing their edits under a wholesale replace (BACKLOG #5:
      // no store here declared version/migrate before this one).
      merge: (persisted, current) => {
        const p = (persisted as { book?: Partial<PricingBook> } | undefined)?.book;
        if (!p) return current;
        return {
          ...current,
          book: {
            ...current.book,
            ...p,
            materialPricePerSquare: {
              ...current.book.materialPricePerSquare,
              ...p.materialPricePerSquare,
            },
            accessories:
              p.accessories && p.accessories.length > 0 ? p.accessories : current.book.accessories,
          },
        };
      },
    },
  ),
);

/** Human label for the price-book stamp on a generated document. */
export function priceBookProvenance(book: Pick<PricingBook, 'customized' | 'revision' | 'updatedAt'>): string {
  if (!book.customized) {
    return 'Priced from RoofWise starting numbers — not yet set by the contractor (Settings → Pricing).';
  }
  const when = new Date(book.updatedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `Priced from the contractor's own price book, rev. ${book.revision} (updated ${when}).`;
}
