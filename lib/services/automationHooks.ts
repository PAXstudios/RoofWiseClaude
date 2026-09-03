// React + native glue for the automation engine (lib/services/automations.ts).
//
// `useAutomationTicks()` — mount ONCE in app/_layout.tsx. It installs the
// push adapter (the engine itself never imports expo-notifications, so it
// stays Node-testable), runs the clock-driven checks on boot and on every
// foreground, and repeats them hourly while the app is open.

import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { requestPushPermission } from './pushNotifications';
import { installAutomationAdapters, runAutomationTicks, type ReminderRequest } from './automations';

const TICK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Schedule a one-shot local reminder. Snaps a bare date to 9:00 local; a
 * time already past fires in a minute (the roofer still gets the nudge).
 * The tap deep-links to the lead (`lead_follow_up` in app/_layout.tsx).
 */
export async function scheduleAutomationReminder(r: ReminderRequest): Promise<string | null> {
  const granted = await requestPushPermission();
  if (!granted) return null;
  const fireAt = new Date(r.date);
  if (Number.isNaN(fireAt.getTime())) return null;
  if (fireAt.getTime() <= Date.now()) fireAt.setTime(Date.now() + 60 * 1000);
  return Notifications.scheduleNotificationAsync({
    content: {
      title: r.title,
      body: r.body,
      data: r.leadId
        ? { kind: 'lead_follow_up', leadId: r.leadId, inspectionId: r.inspectionId }
        : { kind: 'automation', inspectionId: r.inspectionId },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
  });
}

let adaptersInstalled = false;

/** Idempotent — safe to call from any screen that wants reminders live early. */
export function ensureAutomationAdapters(): void {
  if (adaptersInstalled) return;
  adaptersInstalled = true;
  installAutomationAdapters({ scheduleReminder: scheduleAutomationReminder });
}

export function useAutomationTicks(): void {
  useEffect(() => {
    ensureAutomationAdapters();
    const tick = () => {
      try {
        runAutomationTicks(new Date());
      } catch {
        // A tick must never take the root layout down.
      }
    };
    tick();
    const onState = (next: AppStateStatus) => {
      if (next === 'active') tick();
    };
    const sub = AppState.addEventListener('change', onState);
    const interval = setInterval(tick, TICK_INTERVAL_MS);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, []);
}
