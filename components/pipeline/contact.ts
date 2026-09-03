// One-tap customer contact via the OS — the same URL schemes `lead/[id].tsx`
// already uses, lifted here so the pipeline cards, the job screen and the
// lead screen dial the same way. Every opener swallows its own rejection: an
// unsupported scheme (web, a simulator with no Phone app) must never take a
// list screen down.

import { Linking, Platform } from 'react-native';

/** Digits and a leading `+` only — `tel:` chokes on spaces and parentheses. */
function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export function openPhone(phone: string): void {
  Linking.openURL(`tel:${dialable(phone)}`).catch(() => {});
}

export function openSms(phone: string): void {
  Linking.openURL(`sms:${dialable(phone)}`).catch(() => {});
}

export function openMail(email: string): void {
  Linking.openURL(`mailto:${email.trim()}`).catch(() => {});
}

/**
 * Directions to an address. Native maps first (Apple Maps / Android geo
 * intent), Google Maps on the web as the fallback for either. Coordinates,
 * when the record has them, make the web fallback land on the right house
 * rather than on a geocoder's best guess.
 */
export function openDirections(address: string, coords?: { lat?: number; lng?: number }): void {
  const q = encodeURIComponent(address);
  const native = Platform.OS === 'ios' ? `maps://?q=${q}` : `geo:0,0?q=${q}`;
  const web =
    coords?.lat != null && coords?.lng != null
      ? `https://maps.google.com/?daddr=${coords.lat},${coords.lng}`
      : `https://maps.google.com/?q=${q}`;
  Linking.openURL(native).catch(() => Linking.openURL(web).catch(() => {}));
}
