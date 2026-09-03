// Saving a knock — the one write path from the pin sheet into the stores.
//
// A knock is a fact about a door; a lead is a promise about a customer. This
// module decides when the first creates or advances the second, using the
// outcome table (lib/services/knockOutcomes.ts) and never demoting a lead the
// roofer has already moved further along (a signed lead stays signed even if
// a second knock is logged as "Interested"). Every save leaves an activity
// event so Home's Recent Activity and the Activity screen tell the story.

import { LEAD_STAGE_ORDER, leadStageColumn } from '@/lib/models/types';
import type {
  ComeBackWhen,
  DoNotKnockEntry,
  Knock,
  KnockHistoryEntry,
  KnockOutcome,
  Lead,
  LeadStage,
  PropertyRecord,
} from '@/lib/models/types';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useDoNotKnockStore } from '@/lib/stores/doNotKnockStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { outcomeLabel, outcomeMeta } from '@/lib/services/knockOutcomes';
import { distanceMeters, SAME_HOUSE_METERS } from '@/lib/services/knockTrip';
import { PLACEHOLDER_KNOCK_NAME, isPlaceholderAddress, isPlaceholderName } from '@/lib/services/placeholderDetails';
import { addressKey } from '@/lib/services/propertyRecord';

export type PinDraft = {
  lat: number;
  lng: number;
  placedBy: 'gps' | 'map_tap';
  /** A real street from the geocoder or the roofer; undefined = GPS only. */
  address?: string;
  outcome: KnockOutcome;
  notes?: string;
  followUpAt?: string;
  contactName?: string;
  contactPhone?: string;
  propertyRecord?: PropertyRecord;
  damageNoted?: boolean;
  comeBackWhen?: ComeBackWhen;
};

export type SaveKnockResult = {
  knock: Knock;
  lead: Lead | null;
  leadCreated: boolean;
  leadUpdated: boolean;
  /** The lead exists but the address is a bare GPS pair — say so in the toast. */
  gpsOnly: boolean;
  /**
   * The pin sits on the do-not-knock list (a home, or inside an HOA zone).
   * The save still goes through — the roofer already knocked — but the
   * sheet should say so. Absent when the outcome IS "Do not knock".
   */
  blockedBy?: DoNotKnockEntry;
};

export type SaveKnockOptions = {
  /** Edit this knock in the active session instead of logging a new one. */
  existingKnockId?: string;
  /** History to seed a NEW knock with ("knock again" on an old pin). */
  seedHistory?: KnockHistoryEntry[];
};

/** "33.01980, -96.69890" — the honest address of a fix nobody could name. */
export function coordinateAddress(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function stageIndex(stage: LeadStage): number {
  return LEAD_STAGE_ORDER.indexOf(leadStageColumn(stage));
}

/**
 * The lead this door already has, if any: the one the knock created, else one
 * at the same street address, else one within a house-width of the pin.
 */
function findLeadForDoor(leads: readonly Lead[], draft: PinDraft, existing: Knock | undefined): Lead | undefined {
  if (existing?.createdLeadId) {
    const byId = leads.find((l) => l.id === existing.createdLeadId);
    if (byId) return byId;
  }
  if (draft.address) {
    const key = addressKey(draft.address);
    const byAddress = leads.find((l) => !isPlaceholderAddress(l.address) && addressKey(l.address) === key);
    if (byAddress) return byAddress;
  }
  return leads.find(
    (l) =>
      typeof l.lat === 'number' &&
      typeof l.lng === 'number' &&
      distanceMeters({ lat: l.lat, lng: l.lng }, draft) <= SAME_HOUSE_METERS,
  );
}

export function saveKnock(draft: PinDraft, opts: SaveKnockOptions = {}): SaveKnockResult | null {
  const sessionStore = useKnockSessionStore.getState();
  const session = sessionStore.activeSession;
  if (!session) return null;
  const existing = opts.existingKnockId ? session.knocks.find((k) => k.id === opts.existingKnockId) : undefined;

  const meta = outcomeMeta(draft.outcome);
  const leadStore = useLeadStore.getState();
  const activity = useActivityStore.getState();
  const now = new Date().toISOString();
  const gpsOnly = !draft.address;
  // Read BEFORE this save can add the door itself to the list.
  const blockedBy =
    meta.id === 'do_not_knock' ? undefined : useDoNotKnockStore.getState().blockedAt(draft.lat, draft.lng) ?? undefined;
  const addressForLead = draft.address ?? coordinateAddress(draft.lat, draft.lng);
  const contactGiven = !!(draft.contactName?.trim() || draft.contactPhone?.trim());

  // A renter only becomes a lead when the tenant named the owner — a lead
  // for "somebody rents this" is not a customer.
  const wantsLead = meta.createsLead && (meta.id !== 'renter' || contactGiven);

  let lead: Lead | null = null;
  let leadCreated = false;
  let leadUpdated = false;

  if (wantsLead) {
    const found = findLeadForDoor(leadStore.leads, draft, existing);
    if (found) {
      lead = found;
      const target = meta.leadStage;
      // Forward only: a knock never walks a lead backwards, and a lost lead
      // that answers the door again is genuinely reopened.
      if (target && (found.stage === 'lost' || stageIndex(target) > stageIndex(found.stage))) {
        leadStore.setStage(found.id, target);
        leadUpdated = true;
      }
      const patch: Parameters<typeof leadStore.updateDetails>[1] = {};
      if (draft.contactName?.trim() && isPlaceholderName(found.customerName)) patch.customerName = draft.contactName.trim();
      if (draft.contactPhone?.trim() && !found.customerPhone) patch.customerPhone = draft.contactPhone.trim();
      if (draft.address && isPlaceholderAddress(found.address)) {
        patch.address = draft.address;
        patch.lat = draft.lat;
        patch.lng = draft.lng;
      }
      if (Object.keys(patch).length > 0) {
        leadStore.updateDetails(found.id, patch);
        leadUpdated = true;
      }
      if (meta.setsFollowUp && draft.followUpAt) {
        leadStore.setFollowUp(found.id, draft.followUpAt);
        leadUpdated = true;
      }
      if (draft.propertyRecord?.status === 'found' && !found.propertyRecord) {
        leadStore.setPropertyRecord(found.id, draft.propertyRecord);
      }
      if (meta.isContact) {
        const current = useLeadStore.getState().leads.find((l) => l.id === found.id) ?? found;
        leadStore.upsert({ ...current, lastContactAt: now, updatedAt: now, syncStatus: 'pending' });
        leadUpdated = true;
      }
      lead = useLeadStore.getState().leads.find((l) => l.id === found.id) ?? found;
    } else {
      lead = leadStore.create({
        customerName: draft.contactName?.trim() || PLACEHOLDER_KNOCK_NAME,
        customerPhone: draft.contactPhone?.trim() || undefined,
        address: addressForLead,
        lat: draft.lat,
        lng: draft.lng,
        stage: meta.leadStage ?? 'new',
        stageChangedAt: now,
        source: 'door_knock',
        lastContactAt: meta.isContact ? now : undefined,
        followUpAt: meta.setsFollowUp ? draft.followUpAt : undefined,
        propertyRecord: draft.propertyRecord?.status === 'found' ? draft.propertyRecord : undefined,
      });
      leadCreated = true;
    }
  }

  const notes = composeNotes(draft, meta.id);
  const common = {
    address: draft.address,
    outcome: draft.outcome,
    notes,
    followUpAt: meta.setsFollowUp ? draft.followUpAt : undefined,
    createdLeadId: lead?.id ?? existing?.createdLeadId,
    contactName: draft.contactName?.trim() || undefined,
    contactPhone: draft.contactPhone?.trim() || undefined,
    propertyRecord: draft.propertyRecord ?? existing?.propertyRecord,
    damageNoted: meta.asksDamage ? draft.damageNoted : undefined,
    comeBackWhen: meta.asksWhen ? draft.comeBackWhen : undefined,
  };

  let knock: Knock | null;
  if (existing) {
    knock = sessionStore.updateKnock(existing.id, { ...common, lat: draft.lat, lng: draft.lng });
  } else {
    knock = sessionStore.logKnock({
      ...common,
      lat: draft.lat,
      lng: draft.lng,
      placedBy: draft.placedBy,
      history: opts.seedHistory,
    });
  }
  if (!knock) return null;

  // "Do not knock" is a promise about the door, not just a pin colour: it
  // goes on the list the planner and Knock mode read from. A door already
  // listed is updated, not duplicated (doNotKnockStore.add).
  if (meta.id === 'do_not_knock') {
    useDoNotKnockStore.getState().add({
      kind: 'home',
      source: 'outcome',
      lat: draft.lat,
      lng: draft.lng,
      address: draft.address,
      label: draft.address ?? coordinateAddress(draft.lat, draft.lng),
      note: draft.notes?.trim() || undefined,
      knockId: knock.id,
    });
  }

  const where = draft.address ?? 'GPS pin';
  activity.log({
    kind: 'knock_logged',
    leadId: lead?.id,
    message: `${existing ? 'Knock updated' : 'Knock logged'}: ${outcomeLabel(draft.outcome)} — ${where}`,
    payload: { knockId: knock.id, sessionId: session.id, outcome: draft.outcome },
  });
  if (leadCreated && lead) {
    activity.log({
      kind: 'knock_converted_to_lead',
      leadId: lead.id,
      message: `${leadHeadline(meta.id, draft)} — ${where}`,
    });
  } else if (lead && (meta.id === 'signed' || meta.id === 'appointment' || meta.id === 'inspected')) {
    // A door that moved an existing lead forward is news too.
    activity.log({
      kind: 'knock_converted_to_lead',
      leadId: lead.id,
      message: `${leadHeadline(meta.id, draft)} — ${where}`,
    });
  }

  return { knock, lead, leadCreated, leadUpdated, gpsOnly, blockedBy };
}

/** The activity line for an outcome that touched the pipeline. */
function leadHeadline(outcome: KnockOutcome, draft: PinDraft): string {
  switch (outcome) {
    case 'signed':
      return 'Signed at the door';
    case 'appointment':
      return `Inspection booked at the door${draft.followUpAt ? ` · ${shortDate(draft.followUpAt)}` : ''}`;
    case 'inspected':
      return draft.damageNoted === false ? 'Roof inspected at the door — no damage seen' : 'Roof inspected at the door';
    case 'renter':
      return 'Owner contact from a tenant';
    case 'come_back':
      return 'Come back later — lead created';
    default:
      return 'Knock converted to lead';
  }
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * The knock's notes: what the roofer typed, plus the structured answers in
 * words so the note reads whole on the lead and in a backup.
 */
function composeNotes(draft: PinDraft, outcome: KnockOutcome): string | undefined {
  const parts: string[] = [];
  const typed = draft.notes?.trim();
  if (typed) parts.push(typed);
  if (outcome === 'inspected' && draft.damageNoted !== undefined) {
    parts.push(draft.damageNoted ? 'Damage seen on the roof.' : 'No damage seen on the roof.');
  }
  if (outcome === 'come_back' && draft.comeBackWhen) {
    parts.push(`Asked to come back: ${draft.comeBackWhen}.`);
  }
  if (outcome === 'renter') {
    parts.push('Tenant at the door; the owner files the claim.');
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}
