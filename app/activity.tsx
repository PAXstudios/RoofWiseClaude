import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useActivityStore } from '@/lib/stores/activityStore';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function ActivityScreen() {
  const router = useRouter();
  const events = useActivityStore((s) => s.events);
  const clear = useActivityStore((s) => s.clear);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <Text style={styles.title}>Activity</Text>
        {events.length > 0 && (
          <Pressable onPress={clear} hitSlop={10}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {events.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={36} color={colors.slate} />
            <Text style={styles.emptyTitle}>No activity yet</Text>
            <Text style={styles.emptyBody}>
              Inspections, photo captures, knocks, and proposal events will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {events.map((evt, i) => (
              <View
                key={evt.id}
                style={[styles.row, i > 0 && styles.rowBorder]}
              >
                <Ionicons name={iconFor(evt.kind)} size={20} color={colors.orange} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.msg}>{evt.message}</Text>
                  <Text style={styles.time}>{formatTime(evt.createdAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function iconFor(kind: string): keyof typeof Ionicons.glyphMap {
  switch (kind) {
    case 'job_created': return 'briefcase-outline';
    case 'photo_captured': return 'camera-outline';
    case 'analysis_ran': return 'analytics-outline';
    case 'proposal_sent': return 'send-outline';
    case 'proposal_signed': return 'document-text-outline';
    case 'knock_logged': return 'walk-outline';
    case 'storm_alert_received': return 'thunderstorm-outline';
    case 'pdf_generated': return 'document-attach-outline';
    default: return 'ellipse-outline';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  title: { flex: 1, fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  clear: { color: colors.orange, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.md },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  msg: { fontSize: fontSize.bodyMd, color: colors.navy },
  time: { fontSize: fontSize.caption, color: colors.slate, marginTop: 2 },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 220,
    justifyContent: 'center',
    ...shadows.card,
  },
  emptyTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, marginTop: spacing.sm },
  emptyBody: { fontSize: fontSize.bodyMd, color: colors.slate, textAlign: 'center' },
});
