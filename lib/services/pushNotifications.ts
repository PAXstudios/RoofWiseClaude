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
    trigger: { date: fireAt },
  });
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
      weekday: 2,         // Monday (1 = Sunday in iOS calendar)
      hour: 9,
      minute: 0,
      repeats: true,
    },
  });
}
