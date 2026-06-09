import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function randomToken(len = 8): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }
  return s;
}

const PUBLIC_BASE = 'https://roofwise.app/p/';

export type ProposalLink = {
  token: string;
  proposalId: string;
  jobId: string;
  createdAt: string;
  viewedAt?: string;
};

type State = {
  links: ProposalLink[];
  getOrCreate: (input: { proposalId: string; jobId: string }) => ProposalLink;
  urlFor: (token: string) => string;
  markViewed: (token: string) => void;
};

export const useProposalLinkStore = create<State>()(
  persist(
    (set, get) => ({
      links: [],

      getOrCreate: ({ proposalId, jobId }) => {
        const existing = get().links.find((l) => l.proposalId === proposalId);
        if (existing) return existing;
        const link: ProposalLink = {
          token: randomToken(),
          proposalId,
          jobId,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ links: [link, ...s.links].slice(0, 500) }));
        return link;
      },

      urlFor: (token) => `${PUBLIC_BASE}${token}`,

      markViewed: (token) =>
        set((s) => ({
          links: s.links.map((l) =>
            l.token === token && !l.viewedAt ? { ...l, viewedAt: new Date().toISOString() } : l,
          ),
        })),
    }),
    {
      name: 'roofwise.proposalLinks.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ links: s.links }),
    },
  ),
);
