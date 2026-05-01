import { useState } from 'react';
import { View, Text, ImageBackground, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { colors, fontSize, fontWeight, radii, spacing, shadows } from '@/theme/tokens';

// Static map preview (Stadia Maps "OSM bright" style, no key required for the
// preview asset). Falls back gracefully if offline because it renders inside a
// View with the storm/lead pins absolutely positioned over the top.
const PREVIEW_IMG =
  'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=1200&q=80&auto=format&fit=crop';

type Mode = 'leads' | 'storms';

export function AreaActivityMap() {
  const [mode, setMode] = useState<Mode>('storms');
  return (
    <View style={styles.section}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <SectionHeader
          title="Area Activity"
          right={
            <ChipGroup<Mode>
              tone="accent"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'leads', label: 'Leads' },
                { value: 'storms', label: 'Storms' },
              ]}
            />
          }
        />
      </View>

      <View style={styles.mapWrap}>
        <ImageBackground
          source={{ uri: PREVIEW_IMG }}
          style={styles.map}
          imageStyle={styles.mapImg}
        >
          <Pin top={64} left={50} color={mode === 'storms' ? colors.stormHail : colors.brand} />
          <Pin top={120} left={210} color={mode === 'storms' ? colors.stormSevere : colors.brand} large />
          <Pin top={180} left={120} color={mode === 'storms' ? colors.stormWind : colors.brand} />
          <Pin top={86} left={260} color={mode === 'storms' ? colors.stormHail : colors.brand} />
        </ImageBackground>

        <Card style={styles.insightCard} elevated>
          <View style={styles.insightRow}>
            <View style={styles.aiIcon}>
              <Ionicons name="sparkles" size={16} color={colors.surface} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.insightTitle}>AI Insight</Text>
              <Text style={styles.insightBody}>
                3 recent leads are within 2 miles of the hail damage cluster.{' '}
                <Text style={styles.insightLink}>Launch campaign?</Text>
              </Text>
            </View>
          </View>
        </Card>
      </View>
    </View>
  );
}

function Pin({ top, left, color, large = false }: { top: number; left: number; color: string; large?: boolean }) {
  const size = large ? 18 : 14;
  return (
    <View
      style={[
        styles.pin,
        {
          top,
          left,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.lg },
  mapWrap: {
    marginHorizontal: spacing.lg,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    ...shadows.card,
  },
  map: {
    height: 260,
  },
  mapImg: { borderRadius: radii.lg },
  pin: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.surface,
    ...shadows.card,
  },
  insightCard: {
    margin: spacing.md,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  aiIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.brand,
    marginBottom: 2,
  },
  insightBody: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 20,
  },
  insightLink: {
    color: colors.brand,
    fontWeight: fontWeight.semibold,
  },
});
