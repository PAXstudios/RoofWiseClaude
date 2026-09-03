// Per-address cache for Zillow property records (APIllow), persisted.
//
// The free tier is 50 lookups a month. A house is looked up when a job is
// created, when an estimate is saved, and when the inspector taps refresh —
// often the same address three times. One record per normalised address,
// good for 30 days, so the second and third are free. `lookup()` is the one
// entry point; it also collapses concurrent requests for the same address
// into a single service call.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PropertyRecord } from '../models/types';
import { addressKey, fetchPropertyRecord } from '../services/propertyRecord';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A failed lookup is retried after this — quota and outages clear. */
const FAILED_TTL_MS = 6 * 60 * 60 * 1000;

type Entry = { record: PropertyRecord; cachedAt: string };

type PropertyRecordState = {
  byAddress: Record<string, Entry>;
  cached: (address: string) => PropertyRecord | undefined;
  /** Cache-first lookup; `force` bypasses the cache (the refresh button). */
  lookup: (address: string, opts?: { force?: boolean }) => Promise<PropertyRecord>;
  remember: (address: string, record: PropertyRecord) => void;
};

const inFlight = new Map<string, Promise<PropertyRecord>>();

export const usePropertyRecordStore = create<PropertyRecordState>()(
  persist(
    (set, get) => ({
      byAddress: {},

      cached: (address) => {
        const key = addressKey(address);
        const hit = get().byAddress[key];
        if (!hit) return undefined;
        const age = Date.now() - new Date(hit.cachedAt).getTime();
        const ttl = hit.record.status === 'found' || hit.record.status === 'not_found' ? TTL_MS : FAILED_TTL_MS;
        return age <= ttl ? hit.record : undefined;
      },

      remember: (address, record) =>
        set((s) => ({
          byAddress: { ...s.byAddress, [addressKey(address)]: { record, cachedAt: new Date().toISOString() } },
        })),

      lookup: async (address, opts) => {
        const key = addressKey(address);
        if (!opts?.force) {
          const hit = get().cached(address);
          if (hit) return hit;
          const pending = inFlight.get(key);
          if (pending) return pending;
        }
        const run = fetchPropertyRecord({ address })
          .then((record) => {
            // A 'not_configured' answer is not worth caching — the key may
            // arrive with the next update.
            if (record.status !== 'not_configured') get().remember(address, record);
            return record;
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, run);
        return run;
      },
    }),
    {
      name: 'roofwise.propertyRecords.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ byAddress: s.byAddress }),
    },
  ),
);
