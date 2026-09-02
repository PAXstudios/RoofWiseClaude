// Crash diagnostics — the surface that turns "the app keeps crashing" into
// a pasteable, actionable report. Reads `lib/services/diagnostics.ts`'s ring
// buffer; never fabricates an entry, and says so plainly when there is none
// (Drift #5).

import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  clear as clearDiagnostics,
  list as listDiagnostics,
  getBootInfo,
  toText,
  type DiagnosticEntry,
  type DiagnosticKind,
} from '@/lib/services/diagnostics';
import { useToastStore } from '@/lib/stores/toastStore';
import { useMapTilesStore } from '@/lib/stores/mapTilesStore';
import { getGoogleTilesStatus } from '@/lib/services/mapTiles';
import { geminiModelChain, getActiveGeminiModel } from '@/lib/services/gemini';
import { isGeminiConfigured } from '@/lib/env';
import { formatDateTime, formatRelative } from '@/lib/format/date';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Pill, type PillTone } from '@/components/ui/Pill';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const KIND_META: Record<DiagnosticKind, { label: string; tone: PillTone; icon: 'alert-circle' | 'flash-outline' | 'terminal-outline' | 'rocket-outline' }> = {
  js_error: { label: 'JS Error', tone: 'danger', icon: 'alert-circle' },
  promise_rejection: { label: 'Promise rejection', tone: 'warn', icon: 'flash-outline' },
  console_error: { label: 'console.error', tone: 'warn', icon: 'terminal-outline' },
  boot: { label: 'App start', tone: 'info', icon: 'rocket-outline' },
};

export default function DiagnosticsScreen() {
  const toast = useToastStore((s) => s.show);
  const [entries, setEntries] = useState<DiagnosticEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(() => setEntries(listDiagnostics()), []);

  // Re-read every time this screen gains focus — "Open Diagnostics" from a
  // fresh crash needs the entry that just happened, not a stale snapshot
  // from whenever this screen last mounted.
  useFocusEffect(refresh);

  // Recomputed on every `entries` refresh (same trigger — screen focus) so
  // the footer reflects the current session's boot info, not a stale read
  // from whenever this screen first mounted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const boot = useMemo(() => getBootInfo(), [entries]);

  // Service provenance — what actually answers, not what was configured.
  // Both reads are cheap store/module lookups, so they run on every render:
  // the focus refresh above re-renders (Gemini's chain head is process-
  // lifetime — a fallback that answered once is tried first until relaunch),
  // and the tile-store subscription re-renders when a session or error lands
  // while this screen is open.
  useMapTilesStore((s) => s.sessions);
  useMapTilesStore((s) => s.lastError);
  const tiles = getGoogleTilesStatus();
  const gemini = { active: getActiveGeminiModel(), chain: geminiModelChain() };

  const onCopyAll = async () => {
    try {
      await Clipboard.setStringAsync(toText());
      toast({ tone: 'success', title: 'Copied all diagnostics' });
    } catch {
      toast({ tone: 'danger', title: 'Could not copy' });
    }
  };

  const onClear = () => {
    if (entries.length === 0) return;
    Alert.alert(
      'Clear diagnostics?',
      `This removes all ${entries.length} recorded ${entries.length === 1 ? 'entry' : 'entries'} from this device. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearDiagnostics();
            refresh();
            toast({ tone: 'success', title: 'Diagnostics cleared' });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Diagnostics" subtitle="What broke, where, and when" back />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <FadeSlideIn index={0} style={styles.actionsRow}>
          <PressableScale
            style={[styles.actionBtn, entries.length === 0 && styles.actionBtnDisabled]}
            onPress={onCopyAll}
            disabled={entries.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Copy all diagnostics"
          >
            <Ionicons name="copy-outline" size={19} color={colors.navy} />
            <Text style={styles.actionBtnText}>Copy all</Text>
          </PressableScale>
          <PressableScale
            style={[styles.actionBtn, entries.length === 0 && styles.actionBtnDisabled]}
            onPress={onClear}
            disabled={entries.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Clear diagnostics"
          >
            <Ionicons name="trash-outline" size={19} color={colors.danger} />
            <Text style={[styles.actionBtnText, { color: colors.danger }]}>Clear</Text>
          </PressableScale>
        </FadeSlideIn>

        <FadeSlideIn index={1} style={styles.section}>
          <SectionHeader
            title={entries.length === 0 ? 'Recorded entries' : `Recorded entries (${entries.length})`}
            style={styles.sectionHeaderSpacing}
          />

          {entries.length === 0 ? (
            <RichCard>
              <View style={styles.emptyWrap}>
                <Ionicons name="checkmark-done-circle-outline" size={28} color={colors.success} />
                <Text style={styles.emptyText}>No errors recorded on this device.</Text>
              </View>
            </RichCard>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {entries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  expanded={expandedId === entry.id}
                  onToggle={() =>
                    setExpandedId((cur) => (cur === entry.id ? null : entry.id))
                  }
                />
              ))}
            </View>
          )}
        </FadeSlideIn>

        <FadeSlideIn index={2} style={styles.section}>
          <SectionHeader title="Build" style={styles.sectionHeaderSpacing} />
          <RichCard>
            <BuildRow label="Update ID" value={boot.updateId ?? 'embedded (no EAS Update applied)'} />
            <BuildRow label="Runtime version" value={boot.runtimeVersion ?? 'unknown'} />
            <BuildRow label="Channel" value={boot.channel ?? 'unknown'} />
          </RichCard>
        </FadeSlideIn>

        <FadeSlideIn index={3} style={styles.section}>
          <SectionHeader title="Services" style={styles.sectionHeaderSpacing} />
          <RichCard>
            <BuildRow
              label="AI model"
              value={
                isGeminiConfigured
                  ? gemini.active
                  : 'not connected (no EXPO_PUBLIC_GEMINI_API_KEY)'
              }
            />
            <BuildRow label="AI fallback chain" value={gemini.chain.join(' → ')} />
            <BuildRow label="Google map imagery" value={tiles.message} />
            {tiles.lastError && (
              <BuildRow
                label="Imagery last error"
                value={
                  [
                    tiles.lastError.httpStatus != null ? `HTTP ${tiles.lastError.httpStatus}` : null,
                    tiles.lastError.googleReason,
                    formatRelative(new Date(tiles.lastError.at).toISOString()),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }
              />
            )}
          </RichCard>
        </FadeSlideIn>
      </ScrollView>
    </SafeAreaView>
  );
}

function BuildRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.buildRow}>
      <Text style={styles.buildLabel}>{label}</Text>
      <Text style={styles.buildValue} numberOfLines={2} selectable>
        {value}
      </Text>
    </View>
  );
}

function EntryCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: DiagnosticEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = KIND_META[entry.kind];

  return (
    <RichCard onPress={entry.stack ? onToggle : undefined} accessibilityLabel={`${meta.label}: ${entry.message}`}>
      <View style={styles.entryHeader}>
        <Pill label={meta.label} tone={meta.tone} size="sm" icon={meta.icon} />
        <Text style={styles.entryWhen}>{formatRelative(entry.iso)}</Text>
      </View>

      <Text style={styles.entryMessage} numberOfLines={expanded ? undefined : 3} selectable>
        {entry.message}
      </Text>

      <View style={styles.entryMetaRow}>
        <Ionicons name="navigate-outline" size={13} color={colors.textSubtle} />
        <Text style={styles.entryMetaText} numberOfLines={1}>
          {entry.route ?? 'unknown route'}
        </Text>
      </View>
      <View style={styles.entryMetaRow}>
        <Ionicons name="phone-portrait-outline" size={13} color={colors.textSubtle} />
        <Text style={styles.entryMetaText} numberOfLines={1}>
          {entry.device}
        </Text>
      </View>

      {entry.stack ? (
        expanded ? (
          <ScrollView style={styles.stackScroll} nestedScrollEnabled>
            <Text style={styles.stack} selectable>
              {entry.stack}
            </Text>
          </ScrollView>
        ) : (
          <Text style={styles.expandHint}>Tap to view stack</Text>
        )
      ) : null}

      <Text style={styles.entryFullTime}>{formatDateTime(entry.iso)}</Text>
    </RichCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },

  actionsRow: { flexDirection: 'row', gap: spacing.md },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
  },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
  },

  section: {},
  sectionHeaderSpacing: { marginBottom: spacing.sm },

  emptyWrap: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  emptyText: { fontSize: fontSize.bodyMd, color: colors.textMuted, textAlign: 'center' },

  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  entryWhen: { fontSize: fontSize.bodySm, color: colors.textSubtle },
  entryMessage: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.medium,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  entryMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  entryMetaText: { fontSize: fontSize.caption, color: colors.textSubtle, flexShrink: 1 },

  expandHint: {
    fontSize: fontSize.caption,
    color: colors.brand,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.sm,
  },
  stackScroll: {
    maxHeight: 220,
    marginTop: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  stack: {
    fontFamily: 'monospace',
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    lineHeight: 18,
  },
  entryFullTime: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    marginTop: spacing.sm,
  },

  buildRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: touchTarget.small,
    paddingVertical: spacing.xs,
  },
  buildLabel: { fontSize: fontSize.bodySm, color: colors.textMuted },
  buildValue: {
    flex: 1,
    fontSize: fontSize.bodySm,
    color: colors.text,
    textAlign: 'right',
    fontFamily: 'monospace',
  },
});
