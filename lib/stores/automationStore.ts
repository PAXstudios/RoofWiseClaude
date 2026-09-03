// Automation settings + run log + the customer-message suggestions the
// engine leaves for a screen to offer (lib/services/automations.ts).
//
// Only OVERRIDES are stored: a rule with no entry runs at its default. The
// rule list itself (ids, plain-English lines, defaults) lives in the engine
// so this store never imports it — the engine imports this store.
//
// Drift #5: runs and suggestions are written by real events only.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LeadStage } from '../models/types';

/** The four customer messages a stage change can offer. */
export type MessageTemplateKey = 'on_the_way' | 'inspection_done' | 'estimate_sent' | 'install_scheduled';

export const MESSAGE_TEMPLATE_KEYS: MessageTemplateKey[] = [
  'on_the_way',
  'inspection_done',
  'estimate_sent',
  'install_scheduled',
];

/** Which stage move offers which template. */
export const MESSAGE_TEMPLATE_STAGE: Record<MessageTemplateKey, LeadStage> = {
  on_the_way: 'inspection_scheduled',
  inspection_done: 'inspected',
  estimate_sent: 'estimate_sent',
  install_scheduled: 'install_scheduled',
};

export const MESSAGE_TEMPLATE_LABELS: Record<MessageTemplateKey, string> = {
  on_the_way: 'Inspection scheduled',
  inspection_done: 'Inspection done',
  estimate_sent: 'Estimate sent',
  install_scheduled: 'Install scheduled',
};

/**
 * Placeholders: {name} first name · {address} · {company} · {date} the
 * relevant date (appointment, install start, follow-up) · {amount}.
 * Every template is the roofer's to edit in Settings → Automations.
 */
export const DEFAULT_MESSAGE_TEMPLATES: Record<MessageTemplateKey, string> = {
  on_the_way:
    'Hi {name}, this is {company}. Your roof inspection at {address} is booked for {date}. Reply here if anything changes.',
  inspection_done:
    'Hi {name}, {company} here. We finished the inspection at {address} today and are putting the report together. I will send it over shortly.',
  estimate_sent:
    'Hi {name}, {company} here. Your estimate for {address} is on its way{amount}. Happy to walk through it whenever suits you.',
  install_scheduled:
    'Hi {name}, {company} here. Your roof install at {address} is scheduled for {date}. Please keep the driveway clear that morning.',
};

export type AutomationRun = {
  id: string;
  ruleId: string;
  at: string;
  eventType: string;
  /** One line: "Moved Dan Robinson to Signed · added 2 tasks". */
  summary: string;
  leadId?: string;
  inspectionId?: string;
};

export type MessageChannel = 'sms' | 'email';

/** A customer message the engine prepared. Never sent by the app — a screen offers it. */
export type MessageSuggestion = {
  id: string;
  createdAt: string;
  itemId: string;
  leadId?: string;
  inspectionId?: string;
  customerName: string;
  template: MessageTemplateKey;
  stage: LeadStage;
  channel: MessageChannel;
  /** Phone (sms) or email address. */
  to: string;
  body: string;
};

const MAX_RUNS = 100;
const MAX_SUGGESTIONS = 20;
let counter = 0;
const newId = (p: string) => `${p}_${Date.now()}_${counter++}`;

type AutomationState = {
  /** Rule overrides only; absent = the rule's default. */
  enabled: Record<string, boolean>;
  /** Template overrides only; absent = DEFAULT_MESSAGE_TEMPLATES. */
  templates: Partial<Record<MessageTemplateKey, string>>;
  runs: AutomationRun[];
  suggestions: MessageSuggestion[];
  /** Tick bookkeeping: which follow-up / idle window already rang. */
  ticks: { followUp: Record<string, string>; idle: Record<string, string> };

  isEnabled: (ruleId: string, defaultOn: boolean) => boolean;
  setEnabled: (ruleId: string, on: boolean) => void;
  templateFor: (key: MessageTemplateKey) => string;
  setTemplate: (key: MessageTemplateKey, text: string) => void;
  resetTemplate: (key: MessageTemplateKey) => void;
  recordRun: (run: Omit<AutomationRun, 'id' | 'at'>) => AutomationRun;
  lastRunFor: (ruleId: string) => AutomationRun | undefined;
  /** One suggestion per item + template: a newer one replaces the older. */
  addSuggestion: (s: Omit<MessageSuggestion, 'id' | 'createdAt'>) => MessageSuggestion;
  dismissSuggestion: (id: string) => void;
  clearSuggestions: () => void;
  markFollowUpTicked: (leadId: string, followUpAt: string) => void;
  markIdleTicked: (itemId: string, atIso: string) => void;
};

export const useAutomationStore = create<AutomationState>()(
  persist(
    (set, get) => ({
      enabled: {},
      templates: {},
      runs: [],
      suggestions: [],
      ticks: { followUp: {}, idle: {} },

      isEnabled: (ruleId, defaultOn) => {
        const v = get().enabled[ruleId];
        return typeof v === 'boolean' ? v : defaultOn;
      },

      setEnabled: (ruleId, on) => set((s) => ({ enabled: { ...s.enabled, [ruleId]: on } })),

      templateFor: (key) => get().templates[key] ?? DEFAULT_MESSAGE_TEMPLATES[key],

      setTemplate: (key, text) => set((s) => ({ templates: { ...s.templates, [key]: text } })),

      resetTemplate: (key) =>
        set((s) => {
          const { [key]: _dropped, ...rest } = s.templates;
          return { templates: rest };
        }),

      recordRun: (run) => {
        const entry: AutomationRun = { ...run, id: newId('run'), at: new Date().toISOString() };
        set((s) => ({ runs: [entry, ...s.runs].slice(0, MAX_RUNS) }));
        return entry;
      },

      lastRunFor: (ruleId) => get().runs.find((r) => r.ruleId === ruleId),

      addSuggestion: (s) => {
        const entry: MessageSuggestion = { ...s, id: newId('msg'), createdAt: new Date().toISOString() };
        set((st) => ({
          suggestions: [
            entry,
            ...st.suggestions.filter((x) => !(x.itemId === s.itemId && x.template === s.template)),
          ].slice(0, MAX_SUGGESTIONS),
        }));
        return entry;
      },

      dismissSuggestion: (id) =>
        set((s) => ({ suggestions: s.suggestions.filter((x) => x.id !== id) })),

      clearSuggestions: () => set({ suggestions: [] }),

      markFollowUpTicked: (leadId, followUpAt) =>
        set((s) => ({ ticks: { ...s.ticks, followUp: { ...s.ticks.followUp, [leadId]: followUpAt } } })),

      markIdleTicked: (itemId, atIso) =>
        set((s) => ({ ticks: { ...s.ticks, idle: { ...s.ticks.idle, [itemId]: atIso } } })),
    }),
    {
      name: 'roofwise.automations.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        enabled: s.enabled,
        templates: s.templates,
        runs: s.runs,
        suggestions: s.suggestions,
        ticks: s.ticks,
      }),
    },
  ),
);
