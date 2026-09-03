// Placeholder customer / address detection — pure, and the one place the
// placeholder strings live.
//
// A standalone Quick Inspection has to save its photos under SOMETHING before
// the roofer has typed a name, and a door knock creates its lead from a GPS
// fix before anyone has asked the homeowner's name. Both write placeholders.
// Every surface that would present those placeholders as fact — the job hero,
// the HAAG packet, the proposal, the lead card — reads these helpers instead
// of comparing strings, so "Address pending" can never quietly reach a
// carrier (Drift #5: nothing invented is presented as real).

import type { Inspection, Lead } from '../models/types';

/** What a standalone Quick Inspection files its job under until it is named. */
export const PLACEHOLDER_CUSTOMER_NAME = 'Quick inspection';
export const PLACEHOLDER_ADDRESS = 'Address pending';
/** What a door knock names its lead until the homeowner is asked. */
export const PLACEHOLDER_KNOCK_NAME = 'Walk-in lead';

/** "33.01980, -96.69890" — a fix nobody could turn into a street. */
const COORDINATE_ADDRESS = /^-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+$/;

/** True when the address is a bare lat/lng pair rather than a street. */
export function isCoordinateAddress(address: string | undefined): boolean {
  return typeof address === 'string' && COORDINATE_ADDRESS.test(address.trim());
}

/** True when the customer name is empty or one of the placeholders. */
export function isPlaceholderName(name: string | undefined): boolean {
  const t = (name ?? '').trim();
  return t.length === 0 || t === PLACEHOLDER_CUSTOMER_NAME || t === PLACEHOLDER_KNOCK_NAME;
}

/** True when the address is empty, the placeholder, or only coordinates. */
export function isPlaceholderAddress(address: string | undefined): boolean {
  const t = (address ?? '').trim();
  return t.length === 0 || t === PLACEHOLDER_ADDRESS || isCoordinateAddress(t);
}

export type MissingDetails = {
  name: boolean;
  address: boolean;
  /** Either is missing. */
  any: boolean;
};

/** Which customer details a job still needs before it can go to a carrier. */
export function missingJobDetails(
  ins: Pick<Inspection, 'customerName' | 'address'>,
): MissingDetails {
  const name = isPlaceholderName(ins.customerName);
  const address = isPlaceholderAddress(ins.address);
  return { name, address, any: name || address };
}

/** Same read for a pipeline lead — a knock-created lead starts with both missing. */
export function missingLeadDetails(
  lead: Pick<Lead, 'customerName' | 'address'>,
): MissingDetails {
  const name = isPlaceholderName(lead.customerName);
  const address = isPlaceholderAddress(lead.address);
  return { name, address, any: name || address };
}

/** One line for a banner: what is still needed, in the roofer's words. */
export function describeMissingDetails(m: MissingDetails): string {
  if (m.name && m.address) return 'Add customer & address';
  if (m.name) return 'Add the customer name';
  return 'Add the property address';
}
