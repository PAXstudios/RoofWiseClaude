// Settings → Automations. Ten "when X, do Y" rules (lib/services/
// automations.ts) with a toggle and a last-run line each, plus the four
// editable customer-message templates rule 10 offers. Nothing here can send
// anything — the engine only ever prepares a message; a screen offers it.

import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { AUTOMATION_RULES, type AutomationRuleId } from '@/lib/services/automations';
import {
  useAutomationStore,
  DEFAULT_MESSAGE_TEMPLATES,
  MESSAGE_TEMPLATE_KEYS,
  MESSAGE_TEMPLATE_LABELS,
  type MessageTemplateKey,
} from '@/lib/stores/automationStore';
import { PressableScale } from '@/components/PressableScale';
import { FadeSlideIn } from '@/components/motion';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { colors, fontSize, fontWeight, motion, radii, spacing, touchTarget } from '@/theme/tokens';

/** Icon + tone per rule — purely cosmetic, keyed off the id so a rule added
 *  later still renders (falls back to a generic bolt). */
const RULE_ICON: Partial<Record<AutomationRuleId, { icon: IoniconName; tone: ChipTone }>> = {
  inspection_starts_job: { icon: 'camera-outline', tone: 'blue' },
  report_done_inspected: { icon: 'document-text-outline', tone: 'blue' },
  estimate_sent_follow_up: { icon: 'send-outline', tone: 'orange' },
  signed_next_steps: { icon: 'checkmark-done-outline', tone: 'green' },
  install_scheduled_reminder: { icon: 'calendar-outline', tone: 'purple' },
  idle_nudge: { icon: 'time-outline', tone: 'quiet' },
  storm_task: { icon: 'thunderstorm-outline', tone: 'blue' },
  knock_booked_job: { icon: 'walk-outline', tone: 'green' },
  follow_up_bell: { icon: 'notifications-outline', tone: 'orange' },
  stage_message: { icon: 'chatbubble-ellipses-outline', tone: 'purple' },
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function AutomationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const enabledMap = useAutomationStore((s) => s.enabled);
  const setEnabled = useAutomationStore((s) => s.setEnabled);
  const runs = useAutomationStore((s) => s.runs);

  const onCount = useMemo(
    () => AUTOMATION_RULES.filter((r) => (enabledMap[r.id] ?? r.defaultOn)).length,
    [enabledMap],
  );

  const lastRunFor = (id: AutomationRuleId) => runs.find((r) => r.ruleId === id);

  const toggle = (id: AutomationRuleId, on: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    setEnabled(id, on);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Automations</Text>
          <Text style={styles.sub}>{onCount} of {AUTOMATION_RULES.length} rules on</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xxxl }]}
        showsVerticalScrollIndicator={false}
      >
        <FadeSlideIn style={styles.section}>
          <SectionHeader title="Rules" style={styles.sectionHeaderSpacing} />
          <RichCard padded={false}>
            {AUTOMATION_RULES.map((rule, i) => {
              const on = enabledMap[rule.id] ?? rule.defaultOn;
              const last = lastRunFor(rule.id);
              const meta = RULE_ICON[rule.id] ?? { icon: 'flash-outline', tone: 'quiet' as ChipTone };
              return (
                <View key={rule.id}>
                  {i > 0 && <View style={styles.sep} />}
                  <View style={styles.row}>
                    <IconChip name={meta.icon} tone={on ? meta.tone : 'quiet'} size="sm" />
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{rule.title}</Text>
                      <Text style={styles.rowSub}>{rule.detail}</Text>
                      {last && (
                        <Text style={styles.rowLast} numberOfLines={1}>
                          Last: {last.summary} · {relativeTime(last.at)}
                        </Text>
                      )}
                    </View>
                    <PressableScale
                      onPress={() => toggle(rule.id, !on)}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={rule.title}
                    >
                      <MiniSwitch on={on} />
                    </PressableScale>
                  </View>
                </View>
              );
            })}
          </RichCard>
          <Text style={styles.footer}>
            An automation writes state on your device and, where noted, schedules a local
            reminder. It never contacts a customer on its own.
          </Text>
        </FadeSlideIn>

        <FadeSlideIn style={styles.section} index={1}>
          <SectionHeader title="Message templates" style={styles.sectionHeaderSpacing} />
          <RichCard padded={false}>
            {MESSAGE_TEMPLATE_KEYS.map((key, i) => (
              <View key={key}>
                {i > 0 && <View style={styles.sep} />}
                <TemplateRow templateKey={key} />
              </View>
            ))}
          </RichCard>
          <Text style={styles.footer}>
            {'{name} {address} {company} {date} {amount}'} — filled in when a message is offered.
            A stage change opens the message in Messages or Mail; you review and send it, or dismiss
            it. Nothing is sent for you.
          </Text>
        </FadeSlideIn>
      </ScrollView>
    </View>
  );
}

function TemplateRow({ templateKey }: { templateKey: MessageTemplateKey }) {
  const stored = useAutomationStore((s) => s.templates[templateKey]);
  const setTemplate = useAutomationStore((s) => s.setTemplate);
  const resetTemplate = useAutomationStore((s) => s.resetTemplate);
  const [draft, setDraft] = useState(stored ?? DEFAULT_MESSAGE_TEMPLATES[templateKey]);
  const customized = stored != null;

  const commit = () => {
    const text = draft.trim();
    if (!text || text === DEFAULT_MESSAGE_TEMPLATES[templateKey]) {
      resetTemplate(templateKey);
      setDraft(DEFAULT_MESSAGE_TEMPLATES[templateKey]);
      return;
    }
    setTemplate(templateKey, text);
  };

  return (
    <View style={styles.templateRow}>
      <View style={styles.templateHeader}>
        <Text style={styles.rowTitle}>{MESSAGE_TEMPLATE_LABELS[templateKey]}</Text>
        {customized && (
          <Pressable
            onPress={() => {
              resetTemplate(templateKey);
              setDraft(DEFAULT_MESSAGE_TEMPLATES[templateKey]);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Reset ${MESSAGE_TEMPLATE_LABELS[templateKey]} to default`}
          >
            <Text style={styles.resetText}>Reset</Text>
          </Pressable>
        )}
      </View>
      <TextInput
        style={styles.templateInput}
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        multiline
        placeholder={DEFAULT_MESSAGE_TEMPLATES[templateKey]}
        placeholderTextColor={colors.textSubtle}
      />
    </View>
  );
}

/** iOS-style switch visual — the enclosing 56pt row is the real target. */
function MiniSwitch({ on }: { on: boolean }) {
  const x = useSharedValue(on ? 20 : 0);
  useEffect(() => {
    x.value = withSpring(on ? 20 : 0, motion.snappy);
  }, [on, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={[styles.switchTrack, on && styles.switchTrackOn]}>
      <Animated.View style={[styles.switchThumb, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
    backgroundColor: colors.barFill,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headerBtn: { width: touchTarget.small, height: touchTarget.small, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },
  sub: { fontSize: fontSize.caption, color: colors.textSubtle, marginTop: 1 },

  scroll: { padding: spacing.lg, paddingTop: spacing.md, gap: spacing.xl },
  section: {},
  sectionHeaderSpacing: { marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
  footer: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginLeft: spacing.lg },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text, lineHeight: 20 },
  rowSub: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
  rowLast: { fontSize: fontSize.caption, color: colors.textSubtle, marginTop: 2 },

  templateRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs },
  templateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resetText: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.brand },
  templateInput: {
    minHeight: 64,
    fontSize: fontSize.bodySm,
    color: colors.text,
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.control,
    padding: spacing.md,
    lineHeight: 19,
    textAlignVertical: 'top',
  },

  switchTrack: {
    width: 51,
    height: 31,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackOn: { backgroundColor: colors.success },
  switchThumb: { width: 27, height: 27, borderRadius: radii.pill, backgroundColor: colors.surface },
});
