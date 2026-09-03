import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RichCard } from '@/components/ui/RichCard';
import {
  DAMAGE_CATEGORIES,
  DAMAGE_CATEGORY_LABELS,
  type DamageCategory,
} from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const DAMAGE_INFO: Record<
  DamageCategory,
  { what: string; characteristics: string[]; notTo: string[]; coverage: string }
> = {
  hail_hits: {
    what: 'Round impact spots 1/4"–2" diameter from ice impact',
    characteristics: [
      'Granule loss exposing dark asphalt mat',
      'Soft bruise visible from low angle',
      'Sharp-edged discoloration distinct from normal pattern',
      'Clustered, random pattern (not uniform grid)',
    ],
    notTo: [
      'Manufacturing pattern variations',
      'Lichen, moss, or algae spots',
      'Foot traffic blemishes',
      'Mechanical damage from tools',
    ],
    coverage: 'Covered as storm damage. Primary qualifying type for HAAG.',
  },
  bruising: {
    what: 'Soft-spot depression in the granule mat',
    characteristics: [
      'Bull\'s-eye discoloration',
      'Granules still in place but crushed',
      'Often paired with hail hits in same impact area',
    ],
    notTo: ['Heat blistering (raised, not depressed)'],
    coverage: 'Storm damage — qualifies under HAAG when paired with hail.',
  },
  granule_loss: {
    what: 'Bald spots where the protective granule layer is gone',
    characteristics: [
      'Dark asphalt mat exposed',
      'Patches near valleys / drainage paths',
      'Granule accumulation in gutters',
    ],
    notTo: ['Uniform loss across whole roof (= normal aging)'],
    coverage:
      'Clustered loss from hail = storm coverage. Uniform loss = wear (not covered).',
  },
  wind_damage: {
    what: 'General wind-related damage category',
    characteristics: [
      'Lifted, torn, or displaced shingles',
      'Damaged ridge cap',
      'Sealant strip failure',
    ],
    notTo: ['Wind creasing (use that specific category)'],
    coverage: 'Storm damage — wind speed correlates to severity threshold.',
  },
  wind_creasing: {
    what: 'Visible bend or fold in shingle from wind lift',
    characteristics: [
      'Crease line across a shingle',
      'Shingle was folded back and sealed in place',
      'Sealant strip broken',
    ],
    notTo: ['Manufacturing crease (rare)'],
    coverage: 'Storm damage. Counts toward HAAG wind threshold.',
  },
  blistering: {
    what: 'Raised bumps in the shingle surface',
    characteristics: ['Heat-related, NOT depressed', 'Asphalt bubbles up'],
    notTo: ['Hail bruising (depressed, not raised)'],
    coverage: 'NOT covered — manufacturing or heat-related defect.',
  },
  cracking: {
    what: 'Straight-line surface cracks in shingles',
    characteristics: [
      'Linear cracks in shingle surface',
      'Often along edges or seams',
    ],
    notTo: ['Radial cracks from a point (= impact damage)'],
    coverage:
      'Usually aging-related (not covered). Radial cracks from impact = covered.',
  },
  flashing_damage: {
    what: 'Bent / missing / improperly sealed metal flashing',
    characteristics: [
      'Around chimneys, valleys, skylights, walls',
      'Often the source of leaks even when shingles look intact',
    ],
    notTo: [],
    coverage: 'Storm damage when caused by wind or hail. Photograph close-up.',
  },
  algae_moss: {
    what: 'Dark streaks (algae), green patches (moss), grey-green crust (lichen)',
    characteristics: [
      'Streaks run with slope direction (algae)',
      'Fuzzy patches (moss)',
      'Crusty growth (lichen)',
    ],
    notTo: [],
    coverage: 'NOT storm damage. Note on report for roof age context.',
  },
  missing_shingles: {
    what: 'Bare deck or underlayment visible where shingles should be',
    characteristics: [
      'Felt or synthetic underlayment visible',
      'Often follows wind events along the leading edge',
      'Adjacent shingles may show tear marks',
    ],
    notTo: [],
    coverage: 'Storm damage. Counts toward HAAG wind threshold.',
  },
  splitting: {
    what: 'Full-thickness vertical split through the shingle',
    characteristics: [
      'Goes all the way through (vs surface crack)',
      'Often vertical, aligned with grain',
    ],
    notTo: ['Surface cracking'],
    coverage: 'Often aging-related — borderline for coverage.',
  },
  lifted_shingles: {
    what: 'Sealant strip failure; shingle no longer flat against deck',
    characteristics: [
      'Visible bend at the bottom edge',
      'Sealant strip broken or visible',
      'Adjacent shingles may show stress at the seam',
    ],
    notTo: ['Wind creasing (full fold)'],
    coverage: 'Storm damage. Counts toward HAAG wind threshold.',
  },
  structural_sagging: {
    what: 'Visible dips or sags in the roof line',
    characteristics: [
      'Wave or dip in deck',
      'Cracked sheathing visible from attic',
      'Water staining on interior ceilings',
    ],
    notTo: [],
    coverage:
      'ESCALATE — needs a structural engineer, not just a roofer. Document and report.',
  },
};

export default function DamageExplainerScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Damage explainer</Text>
          <Text style={styles.sub}>What each HAAG category looks like</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {DAMAGE_CATEGORIES.map((cat) => {
          const info = DAMAGE_INFO[cat];
          return (
            <RichCard
              key={cat}
              title={DAMAGE_CATEGORY_LABELS[cat]}
              icon="albums-outline"
              iconTone="orange"
              contentStyle={styles.cardBody}
            >
              <Text style={styles.what}>{info.what}</Text>

              <Text style={styles.subSection}>Visual characteristics</Text>
              {info.characteristics.map((c, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Ionicons name="checkmark" size={14} color={colors.success} />
                  <Text style={styles.bullet}>{c}</Text>
                </View>
              ))}

              {info.notTo.length > 0 && (
                <>
                  <Text style={styles.subSection}>Not to be confused with</Text>
                  {info.notTo.map((c, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Ionicons name="close" size={14} color={colors.danger} />
                      <Text style={styles.bullet}>{c}</Text>
                    </View>
                  ))}
                </>
              )}

              <Text style={styles.subSection}>Coverage</Text>
              <Text style={styles.coverage}>{info.coverage}</Text>
            </RichCard>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  // Glove-sized back target (Drift #1) — was a 26px icon in 4pt of padding.
  headerBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },

  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  cardBody: { gap: spacing.xs },
  what: { fontSize: fontSize.bodyLg, color: colors.text },

  subSection: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    color: colors.slate,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: 4 },
  bullet: { flex: 1, fontSize: fontSize.bodyMd, color: colors.navy, lineHeight: 20 },
  coverage: { fontSize: fontSize.bodyMd, color: colors.navy, lineHeight: 20, fontStyle: 'italic', marginTop: 4 },
});
