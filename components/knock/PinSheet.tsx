// The pin sheet — what a dropped pin asks. One house, one sheet:
//
//   the street (reverse-geocoded when Google can name it; "GPS only" when it
//   can't — never a bare coordinate dressed as an address, Drift #5),
//   "Look up house" (ONE Zillow lookup, on the roofer's tap only — the free
//   tier is 50 a month, so nothing here looks up on its own),
//   the outcome grid (56pt colour-coded chips, two per row),
//   what the outcome needs — a follow-up day, a time of day, damage y/n, a
//   name and number — a note, and a sticky 88pt Save.
//
// Three ways in: a NEW pin (a map tap or "Pin here"; a pin dropped within a
// house-width of a knock from this route offers to update that house
// instead), EDIT an active knock (a second visit upgrades the outcome and the
// first visit stays in history), or an ARCHIVED knock from an earlier route
// (read it, or knock again with its history carried).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Pill } from '@/components/ui/Pill';
import { PressableScale } from '@/components/PressableScale';
import { openPhone, openSms } from '@/components/pipeline/contact';
import type { ComeBackWhen, Knock, KnockOutcome, PropertyRecord } from '@/lib/models/types';
import { isApillowConfigured, isGoogleMapsConfigured } from '@/lib/env';
import { reverseGeocode } from '@/lib/services/geocoding';
import {
  COME_BACK_WHEN,
  FOLLOW_UP_DAYS,
  KNOCK_OUTCOMES,
  comeBackFollowUpAt,
  followUpAtFromDays,
  outcomeLabel,
  outcomeMeta,
} from '@/lib/services/knockOutcomes';
import { isCoordinateAddress } from '@/lib/services/placeholderDetails';
import { recordCardUrl, recordFactsLine, recordRoofLine, recordStatusBadge } from '@/lib/services/propertyRecord';
import { usePropertyRecordStore } from '@/lib/stores/propertyRecordStore';
import { useDoNotKnockStore } from '@/lib/stores/doNotKnockStore';
import { blockedBy } from '@/lib/services/doNotKnock';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';
import { outcomeColor, outcomeIcon } from './outcomeStyle';
import { saveKnock, type SaveKnockResult } from './saveKnock';
import { appointmentAt, appointmentFields, isAppointmentTimestamp } from '@/lib/services/appointmentTime';

export type PinPoint = { lat: number; lng: number; placedBy: 'gps' | 'map_tap' };

export type PinSheetMode =
  | { kind: 'new'; point: PinPoint; nearby: Knock | null }
  | { kind: 'edit'; knock: Knock }
  | { kind: 'archived'; knock: Knock; canKnockAgain: boolean };

type Props = {
  visible: boolean;
  mode: PinSheetMode | null;
  onClose: () => void;
  onSaved: (result: SaveKnockResult) => void;
  /** The screen confirms before removing (ConfirmSheet). */
  onRemove: (knock: Knock) => void;
  onOpenLead: (leadId: string) => void;
};

type FollowUpChoice = { kind: 'days'; days: number } | { kind: 'keep'; iso: string } | { kind: 'none' };

/** Reverse-geocode answers by 5-decimal coordinate — a reopened pin is free. */
const streetCache = new Map<string, string | null>();
function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function PinSheet({ visible, mode, onClose, onSaved, onRemove, onOpenLead }: Props) {
  const cached = usePropertyRecordStore((s) => s.cached);
  const lookup = usePropertyRecordStore((s) => s.lookup);

  // The knock being edited (an active knock, or the nearby one when the
  // roofer accepts "update this house"); null for a fresh pin.
  const [useNearby, setUseNearby] = useState(true);
  const editing: Knock | null = useMemo(() => {
    if (!mode) return null;
    if (mode.kind === 'edit') return mode.knock;
    if (mode.kind === 'new') return useNearby ? mode.nearby : null;
    return null;
  }, [mode, useNearby]);
  const archived = mode?.kind === 'archived' ? mode.knock : null;
  const readOnly = mode?.kind === 'archived' && !mode.canKnockAgain;

  const point: PinPoint | null = useMemo(() => {
    if (!mode) return null;
    if (mode.kind === 'new') {
      return editing ? { lat: editing.lat, lng: editing.lng, placedBy: editing.placedBy ?? 'gps' } : mode.point;
    }
    return { lat: mode.knock.lat, lng: mode.knock.lng, placedBy: mode.knock.placedBy ?? 'map_tap' };
  }, [mode, editing]);

  const [address, setAddress] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<KnockOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState<FollowUpChoice>({ kind: 'none' });
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  // Preserve the original instant (including repeated-hour offset/seconds)
  // until the roofer actually changes a calendar or clock field.
  const [unchangedAppointmentIso, setUnchangedAppointmentIso] = useState<string | undefined>();
  /** The date the knock came in with — offered as "Keep …" beside the cadence chips. */
  const [keepIso, setKeepIso] = useState<string | null>(null);
  const [comeBackWhen, setComeBackWhen] = useState<ComeBackWhen | null>(null);
  const [damageNoted, setDamageNoted] = useState<boolean | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [record, setRecord] = useState<PropertyRecord | undefined>();
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const openedRef = useRef(0);
  // Do-not-knock check for the pin's point (homes 25 m, zones by polygon /
  // radius) — re-evaluated whenever the point or the list changes.
  const dnkEntries = useDoNotKnockStore((s) => s.entries);
  const blockedEntry = useMemo(
    () => (point ? blockedBy(dnkEntries, point.lat, point.lng) : null),
    [dnkEntries, point],
  );
  // "New roof · 2024 (listing Mar 2024)" — the Zillow listing's roof line.
  const roofLine = useMemo(
    () => (record?.status === 'found' ? recordRoofLine(record, new Date().getFullYear()) : null),
    [record],
  );

  // Fresh draft each time the sheet opens, prefilled from the knock in play.
  useEffect(() => {
    if (!visible || !mode) return;
    openedRef.current += 1;
    const opened = openedRef.current;
    setUseNearby(true);
    const source = mode.kind === 'new' ? mode.nearby : mode.knock;
    const fresh = mode.kind === 'archived';
    setOutcome(fresh ? null : (source?.outcome ?? null));
    setNotes(fresh ? '' : (source?.notes ?? ''));
    setFollowUp(!fresh && source?.followUpAt ? { kind: 'keep', iso: source.followUpAt } : { kind: 'none' });
    setKeepIso(!fresh && source?.followUpAt ? source.followUpAt : null);
    const booked = !fresh && source && outcomeMeta(source.outcome).id === 'appointment'
      ? appointmentFields(source.followUpAt) : appointmentFields();
    setAppointmentDate(booked.date);
    setAppointmentTime(booked.time);
    setUnchangedAppointmentIso(booked.date && isAppointmentTimestamp(source?.followUpAt) ? source.followUpAt : undefined);
    setComeBackWhen(!fresh ? (source?.comeBackWhen ?? null) : null);
    setDamageNoted(!fresh && source?.damageNoted !== undefined ? source.damageNoted : null);
    setContactName(source?.contactName ?? '');
    setContactPhone(source?.contactPhone ?? '');
    setLookingUp(false);
    setSaving(false);

    const knownAddress = source?.address && !isCoordinateAddress(source.address) ? source.address : '';
    setAddress(knownAddress);
    setLocationNote(null);
    setRecord(source?.propertyRecord ?? (knownAddress ? cached(knownAddress) : undefined));

    if (knownAddress) {
      setLocating(false);
      return;
    }
    const p = mode.kind === 'new' ? mode.point : { lat: mode.knock.lat, lng: mode.knock.lng };
    if (!isGoogleMapsConfigured) {
      setLocating(false);
      setLocationNote('GPS only — Google geocoding is not set up on this build. Type the street if you know it.');
      return;
    }
    const key = coordKey(p.lat, p.lng);
    if (streetCache.has(key)) {
      const hit = streetCache.get(key);
      setLocating(false);
      if (hit) {
        setAddress(hit);
        setRecord((r) => r ?? cached(hit));
      } else {
        setLocationNote('GPS only — no street at this spot. Type it if you know it.');
      }
      return;
    }
    setLocating(true);
    reverseGeocode({ lat: p.lat, lng: p.lng })
      .then((g) => {
        const street = g?.formattedAddress?.trim() || null;
        streetCache.set(key, street);
        if (openedRef.current !== opened) return;
        if (street) {
          setAddress(street);
          setRecord((r) => r ?? cached(street));
        } else {
          setLocationNote('GPS only — no street at this spot. Type it if you know it.');
        }
      })
      .catch(() => {
        if (openedRef.current !== opened) return;
        setLocationNote('GPS only — the geocoder did not answer. Type the street if you know it.');
      })
      .finally(() => {
        if (openedRef.current === opened) setLocating(false);
      });
    // Runs on open only; `mode` is rebuilt by the caller per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Switching between "update this house" and "new pin" re-reads the draft.
  useEffect(() => {
    if (!visible || mode?.kind !== 'new' || !mode.nearby) return;
    const source = useNearby ? mode.nearby : null;
    setOutcome(source?.outcome ?? null);
    setNotes(source?.notes ?? '');
    setFollowUp(source?.followUpAt ? { kind: 'keep', iso: source.followUpAt } : { kind: 'none' });
    setKeepIso(source?.followUpAt ?? null);
    const booked = source && outcomeMeta(source.outcome).id === 'appointment'
      ? appointmentFields(source.followUpAt) : appointmentFields();
    setAppointmentDate(booked.date);
    setAppointmentTime(booked.time);
    setUnchangedAppointmentIso(booked.date && isAppointmentTimestamp(source?.followUpAt) ? source.followUpAt : undefined);
    setContactName(source?.contactName ?? '');
    setContactPhone(source?.contactPhone ?? '');
    if (source?.propertyRecord) setRecord(source.propertyRecord);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useNearby]);

  const meta = outcome ? outcomeMeta(outcome) : null;

  // Picking an outcome that carries a follow-up preselects its cadence —
  // unless the knock already has a date the roofer has not touched.
  const pickOutcome = (id: KnockOutcome) => {
    setOutcome(id);
    const m = outcomeMeta(id);
    if (m.setsFollowUp && followUp.kind === 'none' && m.defaultFollowUpDays !== undefined) {
      setFollowUp({ kind: 'days', days: m.defaultFollowUpDays });
    }
  };

  const addressReal = address.trim().length > 0 && !isCoordinateAddress(address);
  const canLookUp = isApillowConfigured && addressReal && !lookingUp;
  const badge = recordStatusBadge(record);
  const facts = recordFactsLine(record);
  const photo = recordCardUrl(record);

  const onLookUp = async () => {
    if (!canLookUp) return;
    setLookingUp(true);
    try {
      const r = await lookup(address.trim());
      setRecord(r);
    } finally {
      setLookingUp(false);
    }
  };

  const changeAppointmentDate = (date: string) => {
    if (date !== appointmentDate) setUnchangedAppointmentIso(undefined);
    setAppointmentDate(date);
  };
  const changeAppointmentTime = (time: string) => {
    if (time !== appointmentTime) setUnchangedAppointmentIso(undefined);
    setAppointmentTime(time);
  };
  const resolvedFollowUpAt = (): string | undefined => {
    if (!meta?.setsFollowUp) return undefined;
    if (meta.id === 'appointment') return unchangedAppointmentIso ?? appointmentAt(appointmentDate, appointmentTime);
    if (meta.asksWhen) return comeBackWhen ? comeBackFollowUpAt(comeBackWhen) : undefined;
    if (followUp.kind === 'days') return followUpAtFromDays(followUp.days);
    if (followUp.kind === 'keep') return followUp.iso;
    return undefined;
  };

  const canSave = !!outcome && !!point && !saving && !readOnly && (!meta?.asksWhen || !!comeBackWhen) &&
    (meta?.id !== 'appointment' || !!resolvedFollowUpAt());

  const save = () => {
    if (!canSave || !outcome || !point) return;
    setSaving(true);
    const result = saveKnock(
      {
        lat: point.lat,
        lng: point.lng,
        placedBy: point.placedBy,
        address: addressReal ? address.trim() : undefined,
        outcome,
        notes,
        followUpAt: resolvedFollowUpAt(),
        contactName,
        contactPhone,
        propertyRecord: record,
        damageNoted: damageNoted ?? undefined,
        comeBackWhen: comeBackWhen ?? undefined,
      },
      {
        existingKnockId: editing?.id,
        seedLeadId: archived?.createdLeadId,
        seedHistory: archived
          ? [
              ...(archived.history ?? []),
              { outcome: archived.outcome, at: archived.updatedAt ?? archived.createdAt, notes: archived.notes },
            ]
          : undefined,
      },
    );
    setSaving(false);
    if (!result) return;
    onClose();
    onSaved(result);
  };

  const title =
    mode?.kind === 'edit' ? 'This house' : mode?.kind === 'archived' ? 'Knocked before' : editing ? 'Same house' : 'Drop a pin';
  const saveLabel = editing ? 'Update knock' : archived ? 'Knock again' : 'Save knock';
  const history = (editing ?? archived)?.history ?? [];
  const leadId = (editing ?? archived)?.createdLeadId;
  const phoneOnFile = contactPhone.trim() || (editing ?? archived)?.contactPhone;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      accessibilityLabel={title}
      footer={!readOnly ? (
        <PressableScale
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          disabled={!canSave}
          onPress={save}
          accessibilityRole="button"
          accessibilityLabel={saveLabel}
          accessibilityState={{ disabled: !canSave }}
        >
          <Text style={[styles.saveText, !canSave && styles.saveTextDisabled]}>{saveLabel}</Text>
        </PressableScale>
      ) : undefined}
    >
      <View style={styles.body}>
          {/* "Update this house?" — a pin inside a house-width of a knock from this route. */}
          {mode?.kind === 'new' && mode.nearby ? (
            <View style={styles.nearby}>
              <Ionicons name="home" size={18} color={outcomeColor(mode.nearby.outcome)} />
              <View style={styles.fill}>
                <Text style={styles.nearbyTitle}>
                  {useNearby ? 'Updating this house' : 'New pin next to a knock'}
                </Text>
                <Text style={styles.nearbyBody}>
                  {outcomeLabel(mode.nearby.outcome)} · {formatWhen(mode.nearby.updatedAt ?? mode.nearby.createdAt)}
                </Text>
              </View>
              <PressableScale
                style={styles.nearbyBtn}
                onPress={() => setUseNearby((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={useNearby ? 'Make a new pin instead' : 'Update the existing house instead'}
              >
                <Text style={styles.nearbyBtnText}>{useNearby ? 'New pin' : 'Update it'}</Text>
              </PressableScale>
            </View>
          ) : null}

          {/* Archived: what happened last time. */}
          {archived ? (
            <View style={styles.archivedCard}>
              <View style={[styles.archivedDot, { backgroundColor: outcomeColor(archived.outcome) }]}>
                <Ionicons name={outcomeIcon(archived.outcome)} size={14} color={colors.textInverse} />
              </View>
              <View style={styles.fill}>
                <Text style={styles.archivedTitle}>{outcomeLabel(archived.outcome)}</Text>
                <Text style={styles.archivedBody}>{formatWhen(archived.updatedAt ?? archived.createdAt)}</Text>
                {archived.notes ? <Text style={styles.archivedNotes}>{archived.notes}</Text> : null}
              </View>
            </View>
          ) : null}

          {/* Address */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Address</Text>
            <View style={styles.inputRow}>
              <Ionicons name="location-outline" size={20} color={locating ? colors.textSubtle : colors.brand} />
              {locating ? (
                <View style={styles.locatingRow}>
                  <ActivityIndicator color={colors.textMuted} />
                  <Text style={styles.locatingText}>Locating…</Text>
                </View>
              ) : (
                <TextInput
                  style={styles.input}
                  value={address}
                  onChangeText={setAddress}
                  placeholder={readOnly ? 'GPS only' : 'Street address'}
                  placeholderTextColor={colors.textSubtle}
                  editable={!readOnly}
                  autoCapitalize="words"
                  accessibilityLabel="Street address"
                />
              )}
            </View>
            {!locating && locationNote && !addressReal ? (
              <View style={styles.note}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                <Text style={styles.noteText}>{locationNote}</Text>
              </View>
            ) : null}
            {!locating && address.length > 0 && isCoordinateAddress(address) ? (
              <View style={styles.note}>
                <Ionicons name="warning-outline" size={16} color={colors.warn} />
                <Text style={styles.noteText}>That is a coordinate pair, not a street. The pin keeps the GPS point either way.</Text>
              </View>
            ) : null}
            {/* The roofer's own promise: this door (or this HOA) is on the
                do-not-knock list. Said before anything is saved — the save
                is never blocked, the roofer decides. */}
            {blockedEntry ? (
              <View style={styles.note}>
                <Ionicons name="hand-left-outline" size={16} color={colors.danger} />
                <Text style={[styles.noteText, styles.noteDanger]}>
                  On your do-not-knock list — {blockedEntry.label}
                  {blockedEntry.kind === 'zone' ? ' (zone)' : ''}. Skip this door unless they asked you back.
                </Text>
              </View>
            ) : null}
          </View>

          {/* The house — one lookup, only on the tap. */}
          {record?.status === 'found' ? (
            <View style={styles.recordCard}>
              {photo ? <Image source={{ uri: photo }} style={styles.recordPhoto} contentFit="cover" transition={150} /> : null}
              <View style={styles.fill}>
                {badge ? <Pill label={badge.label} tone={badge.tone} size="sm" /> : null}
                {facts ? <Text style={styles.recordFacts}>{facts}</Text> : null}
                {badge ? <Text style={styles.recordHint}>{badge.hint}</Text> : null}
                {roofLine ? <Text style={styles.recordHint}>{roofLine}</Text> : null}
                {badge && record.listingAgent?.phone ? (
                  <Text style={styles.recordHint}>
                    Listing agent: {record.listingAgent.name ?? 'on file'} · {record.listingAgent.phone}
                  </Text>
                ) : null}
                <Text style={styles.recordSource}>Zillow record</Text>
              </View>
            </View>
          ) : (
            <View style={styles.field}>
              <PressableScale
                style={[styles.lookupBtn, !canLookUp && styles.lookupBtnOff]}
                disabled={!canLookUp}
                onPress={onLookUp}
                accessibilityRole="button"
                accessibilityLabel="Look up this house on Zillow"
                accessibilityState={{ disabled: !canLookUp }}
              >
                {lookingUp ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <Ionicons name="home-outline" size={20} color={canLookUp ? colors.brand : colors.textSubtle} />
                )}
                <Text style={[styles.lookupText, !canLookUp && styles.lookupTextOff]}>
                  {lookingUp ? 'Looking up the house…' : 'Look up house'}
                </Text>
                <Text style={styles.lookupCost}>1 lookup</Text>
              </PressableScale>
              <Text style={styles.noteText}>
                {!isApillowConfigured
                  ? 'Property records are not set up on this build.'
                  : record
                    ? (record.reason ?? 'No record for this address.')
                    : !addressReal
                      ? 'Needs a street address first.'
                      : 'Photo, year built, size, and whether it is for sale, just sold, or a rental. Free tier: 50 a month.'}
              </Text>
            </View>
          )}

          {/* Outcome grid */}
          {!readOnly ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{archived ? 'This visit' : 'What happened'}</Text>
              <View style={styles.grid}>
                {KNOCK_OUTCOMES.map((o) => {
                  const active = outcome !== null && outcomeMeta(outcome).id === o.id;
                  const tint = colors[o.tone];
                  return (
                    <PressableScale
                      key={o.id}
                      pressedScale={0.96}
                      style={[styles.chip, active && { backgroundColor: tint, borderColor: tint }]}
                      onPress={() => pickOutcome(o.id)}
                      accessibilityRole="button"
                      accessibilityLabel={o.label}
                      accessibilityState={{ selected: active }}
                    >
                      <Ionicons name={outcomeIcon(o.id)} size={20} color={active ? colors.textInverse : tint} />
                      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                        {o.short}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
              {meta ? (
                <View style={styles.note}>
                  <Ionicons name="arrow-forward-circle-outline" size={16} color={colors[meta.tone]} />
                  <Text style={styles.noteText}>{meta.next}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Time of day (come back) */}
          {meta?.asksWhen ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>When did they say?</Text>
              <View style={styles.rowWrap}>
                {COME_BACK_WHEN.map((w) => {
                  const active = comeBackWhen === w.id;
                  return (
                    <PressableScale
                      key={w.id}
                      pressedScale={0.96}
                      style={[styles.pick, active && styles.pickActive]}
                      onPress={() => setComeBackWhen(w.id)}
                      accessibilityRole="button"
                      accessibilityLabel={w.label}
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.pickText, active && styles.pickTextActive]}>{w.label}</Text>
                    </PressableScale>
                  );
                })}
              </View>
              {comeBackWhen ? (
                <Text style={styles.noteText}>Reminder: {formatWhen(comeBackFollowUpAt(comeBackWhen))}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Follow-up day */}
          {meta?.id === 'appointment' ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Inspection date and time</Text>
              <View style={styles.rowWrap}>
                {FOLLOW_UP_DAYS.map((d) => {
                  const date = appointmentFields(followUpAtFromDays(d.days)).date;
                  const active = appointmentDate === date;
                  return (
                    <PressableScale key={d.days} style={[styles.pick, active && styles.pickActive]}
                      onPress={() => changeAppointmentDate(date)} accessibilityRole="button"
                      accessibilityLabel={`Inspection ${d.label}, ${date}`} accessibilityState={{ selected: active }}>
                      <Text style={[styles.pickText, active && styles.pickTextActive]}>{d.label}</Text>
                    </PressableScale>
                  );
                })}
              </View>
              <View style={styles.inputRow}>
                <TextInput style={styles.input} value={appointmentDate} onChangeText={changeAppointmentDate}
                  placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSubtle}
                  accessibilityLabel="Inspection date, YYYY-MM-DD" editable={!readOnly} />
              </View>
              <View style={styles.rowWrap}>
                {['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'].map((time) => {
                  const hour = Number(time.slice(0, 2));
                  const label = `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
                  const active = appointmentTime === time;
                  return (
                    <PressableScale key={time} style={[styles.pick, active && styles.pickActive]}
                      onPress={() => changeAppointmentTime(time)} accessibilityRole="button"
                      accessibilityLabel={`Inspection at ${label}`} accessibilityState={{ selected: active }}>
                      <Text style={[styles.pickText, active && styles.pickTextActive]}>{label}</Text>
                    </PressableScale>
                  );
                })}
              </View>
              <View style={styles.inputRow}>
                <TextInput style={styles.input} value={appointmentTime} onChangeText={changeAppointmentTime}
                  placeholder="HH:MM (24-hour)" placeholderTextColor={colors.textSubtle}
                  accessibilityLabel="Inspection time, HH:MM, 24-hour local time" editable={!readOnly} />
              </View>
              <Text style={styles.noteText}>{resolvedFollowUpAt()
                ? `Appointment: ${formatWhen(resolvedFollowUpAt()!)} · local time`
                : 'Choose a valid date and time to book the inspection.'}</Text>
            </View>
          ) : null}

          {meta?.setsFollowUp && !meta.asksWhen && meta.id !== 'appointment' ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Follow up</Text>
              <View style={styles.rowWrap}>
                {keepIso ? (
                  <PressableScale
                    pressedScale={0.96}
                    style={[styles.pick, followUp.kind === 'keep' && styles.pickActive]}
                    onPress={() => setFollowUp({ kind: 'keep', iso: keepIso })}
                    accessibilityRole="button"
                    accessibilityLabel={`Keep ${formatWhen(keepIso)}`}
                    accessibilityState={{ selected: followUp.kind === 'keep' }}
                  >
                    <Text style={[styles.pickText, followUp.kind === 'keep' && styles.pickTextActive]}>
                      Keep {formatWhen(keepIso)}
                    </Text>
                  </PressableScale>
                ) : null}
                {FOLLOW_UP_DAYS.map((d) => {
                  const active = followUp.kind === 'days' && followUp.days === d.days;
                  return (
                    <PressableScale
                      key={d.days}
                      pressedScale={0.96}
                      style={[styles.pick, active && styles.pickActive]}
                      onPress={() => setFollowUp({ kind: 'days', days: d.days })}
                      accessibilityRole="button"
                      accessibilityLabel={d.label}
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.pickText, active && styles.pickTextActive]}>{d.label}</Text>
                    </PressableScale>
                  );
                })}
                <PressableScale
                  pressedScale={0.96}
                  style={[styles.pick, followUp.kind === 'none' && styles.pickActive]}
                  onPress={() => setFollowUp({ kind: 'none' })}
                  accessibilityRole="button"
                  accessibilityLabel="No date"
                  accessibilityState={{ selected: followUp.kind === 'none' }}
                >
                  <Text style={[styles.pickText, followUp.kind === 'none' && styles.pickTextActive]}>No date</Text>
                </PressableScale>
              </View>
              {followUp.kind === 'days' ? (
                <Text style={styles.noteText}>On Plan for {formatWhen(followUpAtFromDays(followUp.days))}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Damage seen (inspected) */}
          {meta?.asksDamage ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Damage seen?</Text>
              <View style={styles.rowWrap}>
                {[
                  { v: true, label: 'Yes — damage' },
                  { v: false, label: 'No damage' },
                ].map((o) => {
                  const active = damageNoted === o.v;
                  return (
                    <PressableScale
                      key={String(o.v)}
                      pressedScale={0.96}
                      style={[styles.pick, styles.pickHalf, active && styles.pickActive]}
                      onPress={() => setDamageNoted(o.v)}
                      accessibilityRole="button"
                      accessibilityLabel={o.label}
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.pickText, active && styles.pickTextActive]}>{o.label}</Text>
                    </PressableScale>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Contact */}
          {meta?.asksContact || contactName || contactPhone ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{meta?.contactLabel ?? 'Contact'}</Text>
              <View style={styles.inputRow}>
                <Ionicons name="person-outline" size={20} color={colors.brand} />
                <TextInput
                  style={styles.input}
                  value={contactName}
                  onChangeText={setContactName}
                  placeholder="Name"
                  placeholderTextColor={colors.textSubtle}
                  autoCapitalize="words"
                  editable={!readOnly}
                  accessibilityLabel="Contact name"
                />
              </View>
              <View style={styles.inputRow}>
                <Ionicons name="call-outline" size={20} color={colors.success} />
                <TextInput
                  style={styles.input}
                  value={contactPhone}
                  onChangeText={setContactPhone}
                  placeholder="Phone"
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="phone-pad"
                  editable={!readOnly}
                  accessibilityLabel="Contact phone"
                />
                {phoneOnFile ? (
                  <>
                    <PressableScale
                      style={styles.dial}
                      onPress={() => openPhone(phoneOnFile)}
                      accessibilityRole="button"
                      accessibilityLabel="Call"
                    >
                      <Ionicons name="call" size={20} color={colors.textInverse} />
                    </PressableScale>
                    <PressableScale
                      style={[styles.dial, styles.dialSms]}
                      onPress={() => openSms(phoneOnFile)}
                      accessibilityRole="button"
                      accessibilityLabel="Text"
                    >
                      <Ionicons name="chatbubble" size={18} color={colors.textInverse} />
                    </PressableScale>
                  </>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Notes — plain keyboard; voice-to-text needs the native build. */}
          {!readOnly ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput
                style={[styles.input, styles.notes]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Who you spoke to, what they said"
                placeholderTextColor={colors.textSubtle}
                multiline
                textAlignVertical="top"
                accessibilityLabel="Notes"
              />
            </View>
          ) : null}

          {/* Earlier visits */}
          {history.length > 0 ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Earlier at this door</Text>
              {history.map((h, i) => (
                <View key={`${h.at}_${i}`} style={styles.historyRow}>
                  <View style={[styles.historyDot, { backgroundColor: outcomeColor(h.outcome) }]} />
                  <Text style={styles.historyText}>
                    {outcomeLabel(h.outcome)} · {formatWhen(h.at)}
                    {h.notes ? ` — ${h.notes}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        <View style={styles.footer}>
          {!readOnly && !canSave ? (
            <Text style={styles.saveHint}>
              {!outcome ? 'Pick what happened to save.' : meta?.asksWhen && !comeBackWhen ? 'Pick when to come back.' : meta?.id === 'appointment' ? 'Choose a valid inspection date and time.' : ''}
            </Text>
          ) : null}
          {leadId || editing ? (
            <View style={styles.secondaryRow}>
              {leadId ? (
                <PressableScale
                  style={styles.secondaryBtn}
                  onPress={() => {
                    onClose();
                    onOpenLead(leadId);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open the lead"
                >
                  <Ionicons name="person-outline" size={18} color={colors.text} />
                  <Text style={styles.secondaryText}>Open lead</Text>
                </PressableScale>
              ) : null}
              {editing ? (
                <PressableScale
                  style={[styles.secondaryBtn, styles.secondaryDanger]}
                  onPress={() => {
                    onClose();
                    onRemove(editing);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Remove this pin"
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  <Text style={[styles.secondaryText, styles.secondaryDangerText]}>Remove pin</Text>
                </PressableScale>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { gap: spacing.lg, paddingBottom: spacing.md },
  field: { gap: spacing.sm },
  fieldLabel: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceMuted,
  },
  input: { flex: 1, fontSize: fontSize.bodyLg, color: colors.text, minHeight: touchTarget.standard },
  notes: {
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceMuted,
  },
  locatingRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  locatingText: { fontSize: fontSize.bodyLg, color: colors.textMuted },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  noteText: { flex: 1, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  noteDanger: { color: colors.danger, fontWeight: fontWeight.semibold },

  nearby: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.brandSoft,
  },
  nearbyTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold, color: colors.text },
  nearbyBody: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },
  nearbyBtn: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyBtnText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.brand },

  archivedCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.fillQuiet,
  },
  archivedDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  archivedTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold, color: colors.text },
  archivedBody: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },
  archivedNotes: { fontSize: fontSize.bodyMd, color: colors.text, marginTop: spacing.xs, lineHeight: 20 },

  recordCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'flex-start',
  },
  recordPhoto: { width: 96, height: 72, borderRadius: radii.md, backgroundColor: colors.fillQuiet },
  recordFacts: { fontSize: fontSize.bodyMd, color: colors.text, marginTop: spacing.xs, lineHeight: 20 },
  recordHint: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 18 },
  recordSource: { fontSize: fontSize.caption, color: colors.textSubtle, marginTop: spacing.xs },
  lookupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.brandSoft,
  },
  lookupBtnOff: { backgroundColor: colors.fillQuiet },
  lookupText: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.brand },
  lookupTextOff: { color: colors.textMuted },
  lookupCost: { fontSize: fontSize.caption, color: colors.textMuted, fontWeight: fontWeight.semibold },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // 56pt chips, two per row (Drift #1).
  chip: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipText: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  chipTextActive: { color: colors.textInverse },

  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pick: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
  },
  pickHalf: { flexBasis: '47%' },
  pickActive: { backgroundColor: colors.text },
  pickText: { fontSize: fontSize.bodyMd, color: colors.text, fontWeight: fontWeight.semibold },
  pickTextActive: { color: colors.textInverse },

  dial: {
    width: touchTarget.small,
    height: touchTarget.small,
    borderRadius: radii.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialSms: { backgroundColor: colors.brand },

  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  historyDot: { width: 10, height: 10, borderRadius: 5 },
  historyText: { flex: 1, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },

  footer: { gap: spacing.sm, paddingTop: spacing.sm },
  saveBtn: {
    height: touchTarget.sticky,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { backgroundColor: colors.fillDisabled },
  saveText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  saveTextDisabled: { color: colors.textMuted },
  saveHint: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center' },
  secondaryRow: { flexDirection: 'row', gap: spacing.sm },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryDanger: { backgroundColor: colors.dangerSoft },
  secondaryText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  secondaryDangerText: { color: colors.danger },
});
