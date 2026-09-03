import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { brand, colors } from '@/theme/tokens';

export type InspectorProfile = {
  fullName: string;
  phone: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  haagCertified: boolean;
  haagCertificationNumber?: string;
  yearsExperience: number;
  licenseNumber?: string;
  company: CompanyProfile;
};

// -----------------------------------------------------------------------------
// Company branding — printed on every PDF header/footer (proposalPdf.ts,
// haagPdf.ts, longReport.ts). Absent (name blank) is a real, honest state:
// the documents fall back to the inspector's own name and print NO
// placeholder company (never "Your Company Here").
// -----------------------------------------------------------------------------

export type BrandColorKey = 'royal' | 'burnt' | 'navy' | 'success' | 'purple' | 'teal';

/** Token-safe swatch list for the branding picker — every hex traces back to
 *  theme/tokens.ts (Drift #11: no raw hex invented for this feature). PDF
 *  rendering resolves the same key through `BRAND_COLOR_SWATCHES` in
 *  lib/services/haagPdf.ts, since print HTML is documented as exempt from
 *  the app-UI token rule (`REPORT_BASE_CSS` comment). */
export const BRAND_COLOR_SWATCHES: Record<BrandColorKey, { label: string; hex: string }> = {
  royal: { label: 'Royal blue', hex: brand.royal },
  burnt: { label: 'Burnt orange', hex: brand.burnt },
  navy: { label: 'Navy ink', hex: brand.royalInk },
  success: { label: 'Forest green', hex: colors.success },
  purple: { label: 'Violet', hex: colors.tilePurpleInk },
  teal: { label: 'Sky blue', hex: colors.tileBlueInk },
};

export type CompanyProfile = {
  name: string;
  /** Original picked file URI — in-app preview only. */
  logoUri?: string;
  /** Compressed `data:image/jpeg;base64,…` thumbnail, self-contained so PDF
   *  generation never has to re-read a file that may not exist on this
   *  device (restored backup, other device). */
  logoBase64?: string;
  /** Company/contractor license — distinct from the inspector's own
   *  `licenseNumber` above, which is a personal credential. */
  licenseNumber?: string;
  insuranceLine?: string;
  phone?: string;
  email?: string;
  website?: string;
  brandColor?: BrandColorKey;
};

const DEFAULT_COMPANY: CompanyProfile = { name: '' };

const DEFAULT: InspectorProfile = {
  fullName: '',
  phone: '',
  haagCertified: false,
  yearsExperience: 0,
  company: DEFAULT_COMPANY,
};

/** True once the roofer has entered a company name — the gate every PDF
 *  header/footer checks before printing the branding block at all. */
export function hasCompanyBranding(company: CompanyProfile | undefined): boolean {
  return Boolean(company?.name?.trim());
}

type State = {
  profile: InspectorProfile;
  update: (patch: Partial<Omit<InspectorProfile, 'company'>>) => void;
  updateCompany: (patch: Partial<CompanyProfile>) => void;
  reset: () => void;
};

export const useInspectorProfileStore = create<State>()(
  persist(
    (set) => ({
      profile: DEFAULT,
      update: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
      updateCompany: (patch) =>
        set((s) => ({ profile: { ...s.profile, company: { ...s.profile.company, ...patch } } })),
      reset: () => set({ profile: DEFAULT }),
    }),
    {
      name: 'roofwise.inspectorProfile.v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ profile: s.profile }),
      // Every profile persisted before this change has no `company` key at
      // all. The default shallow merge would replace `profile` wholesale and
      // silently drop the `company` default this file just added (BACKLOG
      // #5) — merge it in explicitly instead.
      merge: (persisted, current) => {
        const p = (persisted as { profile?: Partial<InspectorProfile> } | undefined)?.profile;
        if (!p) return current;
        return {
          ...current,
          profile: { ...current.profile, ...p, company: { ...DEFAULT_COMPANY, ...p.company } },
        };
      },
    },
  ),
);
