import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type InspectorProfile = {
  fullName: string;
  phone: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  haagCertified: boolean;
  haagCertificationNumber?: string;
  yearsExperience: number;
  licenseNumber?: string;
};

const DEFAULT: InspectorProfile = {
  fullName: '',
  phone: '',
  haagCertified: false,
  yearsExperience: 0,
};

type State = {
  profile: InspectorProfile;
  update: (patch: Partial<InspectorProfile>) => void;
  reset: () => void;
};

export const useInspectorProfileStore = create<State>()(
  persist(
    (set) => ({
      profile: DEFAULT,
      update: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
      reset: () => set({ profile: DEFAULT }),
    }),
    {
      name: 'roofwise.inspectorProfile.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ profile: s.profile }),
    },
  ),
);
