// A saved knock plan — its own page, found by date from the planner.
//
// Everything on it acts (components/knock/PlanView.tsx); this screen adds
// the plan's name and notes, and the only way to delete it (a confirm sheet).

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { RichCard } from '@/components/ui/RichCard';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { PlanView } from '@/components/knock/PlanView';
import { useKnockFinderStore } from '@/lib/stores/knockFinderStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { formatDateTime } from '@/lib/format/date';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

export default function KnockPlanScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const plan = useKnockFinderStore((s) => s.plans.find((p) => p.id === id));
  const setNotes = useKnockFinderStore((s) => s.setPlanNotes);
  const removePlan = useKnockFinderStore((s) => s.removePlan);
  const toast = useToastStore((s) => s.show);
  const [confirm, setConfirm] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  if (!plan) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Knock plan" back={() => router.back()} />
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.textSubtle} />
          <Text style={styles.emptyText}>This plan is no longer on this phone.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader
        title={plan.title}
        subtitle={`Made ${formatDateTime(plan.createdAt, 'recently')} · ${plan.result.areas.length} areas · ${plan.result.radiusMiles} mi`}
        back={() => router.back()}
        right={
          <PressableScale style={styles.headerBtn} onPress={() => setConfirm(true)} accessibilityRole="button" accessibilityLabel="Delete this plan">
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
          </PressableScale>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <PlanView plan={plan} />

        <RichCard
          icon="create-outline"
          iconTone="quiet"
          title="Notes"
          subtitle={plan.notes ? undefined : 'Anything you learned on these streets.'}
          action={{ label: notesOpen ? 'Done' : 'Edit', onPress: () => setNotesOpen((v) => !v), icon: notesOpen ? 'checkmark' : 'create-outline' }}
        >
          {notesOpen ? (
            <TextInput
              value={plan.notes ?? ''}
              onChangeText={(t) => setNotes(plan.id, t)}
              placeholder="Gate codes, best hours, who to ask for…"
              placeholderTextColor={colors.textSubtle}
              multiline
              style={styles.notesInput}
            />
          ) : plan.notes ? (
            <Text style={styles.notes}>{plan.notes}</Text>
          ) : null}
        </RichCard>
      </ScrollView>

      <ConfirmSheet
        visible={confirm}
        title="Delete this plan?"
        body="The ranked areas, statuses and notes on this page go with it. Leads and jobs you created from it stay."
        onConfirm={() => {
          removePlan(plan.id);
          toast({ tone: 'info', title: 'Plan deleted' });
          router.back();
        }}
        onClose={() => setConfirm(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl * 2 },
  headerBtn: { width: touchTarget.standard, height: touchTarget.standard, alignItems: 'center', justifyContent: 'center' },
  notes: { fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 21 },
  notesInput: { minHeight: 96, fontSize: fontSize.bodyMd, color: colors.text, lineHeight: 21, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.fillQuiet, textAlignVertical: 'top' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  emptyText: { fontSize: fontSize.bodyMd, color: colors.textMuted, fontWeight: fontWeight.medium },
});
