// Thin wrapper around expo-notifications for local-only alerts.
//
// We don't yet ship push from a server — RoofWise emits *local*
// notifications when Storm Watch fires or when the recursive learning
// loop has weekly feedback to share.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestPushPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;

  const result = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return result.granted;
}

export async function sendLocalNotification(args: {
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}): Promise<string> {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: args.title,
      body: args.body,
      data: args.data,
      sound: Platform.OS === 'ios' ? 'default' : undefined,
    },
    trigger: null,
  });
}

/** Schedule a one-shot follow-up reminder for a lead (9am on the given day). */
export async function scheduleFollowUpReminder(args: {
  leadId: string;
  customerName: string;
  date: Date;
}): Promise<string | null> {
  const granted = await requestPushPermission();
  if (!granted) return null;
  const fireAt = new Date(args.date);
  fireAt.setHours(9, 0, 0, 0);
  if (fireAt.getTime() <= Date.now()) {
    fireAt.setTime(Date.now() + 60 * 1000); // due now-ish → fire in a minute
  }
  return Notifications.scheduleNotificationAsync({
    content: {
      title: 'Follow up today',
      body: `Reach back out to ${args.customerName}.`,
      data: { kind: 'lead_follow_up', leadId: args.leadId },
    },
    // expo-notifications ≥0.29 requires an explicit trigger `type`.
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
  });
}

/**
 * How long before a scheduled knock day's start the reminder fires. An hour
 * is enough to load the truck and drive; owner decision pending (Wave H).
 */
export const KNOCK_DAY_REMINDER_LEAD_MS = 60 * 60 * 1000;

/** "9:00 AM" from "09:00". */
function clockLabel(startTime: string): string {
  const [h, m] = startTime.split(':').map(Number);
  if (!Number.isFinite(h)) return startTime;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Day-of reminder for a scheduled knock day ("Knock day 1 starts at 9:00 AM
 * — 3 stops · first: Frisco"), an hour before the start. The tap opens the
 * plan (`knock_plan` routes in app/_layout.tsx). Returns the scheduled id
 * for `cancelKnockDayReminder`, or null when the day has already started or
 * push permission was refused.
 */
export async function scheduleKnockDayReminder(args: {
  planId: string;
  day: number;
  /** YYYY-MM-DD, local. */
  date: string;
  /** HH:mm, local. */
  startTime: string;
  stops: number;
  first: string;
}): Promise<string | null> {
  const [y, mo, d] = args.date.split('-').map(Number);
  const [hh, mm] = args.startTime.split(':').map(Number);
  if (![y, mo, d, hh].every(Number.isFinite)) return null;
  const startAt = new Date(y, mo - 1, d, hh, Number.isFinite(mm) ? mm : 0, 0, 0);
  if (startAt.getTime() <= Date.now()) return null;
  const granted = await requestPushPermission();
  if (!granted) return null;
  const fireAt = new Date(startAt.getTime() - KNOCK_DAY_REMINDER_LEAD_MS);
  if (fireAt.getTime() <= Date.now()) fireAt.setTime(Date.now() + 60 * 1000);
  return Notifications.scheduleNotificationAsync({
    content: {
      title: `Knock day ${args.day} starts at ${clockLabel(args.startTime)}`,
      body: `${args.stops} stop${args.stops === 1 ? '' : 's'} · first: ${args.first}`,
      data: { kind: 'knock_plan', planId: args.planId },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
  });
}

export async function cancelKnockDayReminder(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already fired or never existed — nothing to cancel.
  }
}

/** Schedule a weekly calibration push (every Monday 9am). */
export async function scheduleWeeklyCalibrationPush(): Promise<void> {
  // Wipe any previously-scheduled calibration push so we don't stack them.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if (n.content.data?.kind === 'calibration_weekly') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'RoofWise — your AI got smarter this week',
      body: 'Open the app to see what improved.',
      data: { kind: 'calibration_weekly' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 2,         // Monday (1 = Sunday in iOS calendar)
      hour: 9,
      minute: 0,
      // WEEKLY triggers always repeat; the old `repeats: true` flag is gone.
    },
  });
}
