import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';
import {
  type SlopeOrientation,
  type DamageMarker,
  type InspectionFinding,
  type Severity,
  DAMAGE_CATEGORY_LABELS,
} from '@/lib/models/types';
import {
  analyzePhoto,
  GeminiNotConfiguredError,
  type AnalysisResult,
} from '@/lib/services/gemini';
import { isGeminiConfigured } from '@/lib/env';

const SLOPES: SlopeOrientation[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

type Phase = 'camera' | 'analyzing' | 'results' | 'permission_denied';

type CapturedPhoto = {
  uri: string;
  base64: string;
  slope: SlopeOrientation;
};

export default function QuickInspection() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [slope, setSlope] = useState<SlopeOrientation>('S');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  if (!permission) {
    return (
      <Backdrop>
        <ActivityIndicator color={colors.textInverse} />
      </Backdrop>
    );
  }

  if (!permission.granted) {
    return (
      <Backdrop>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.permWrap}>
          <Ionicons name="camera-outline" size={40} color={colors.textInverse} />
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permBody}>
            RoofWise uses the camera to capture roof photos for HAAG-protocol analysis.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>Enable camera</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={{ marginTop: spacing.md }}>
            <Text style={styles.linkText}>Not now</Text>
          </Pressable>
        </View>
      </Backdrop>
    );
  }

  const capture = async () => {
    if (!camRef.current || analyzing) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await camRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      if (!photo?.base64) throw new Error('No photo data');
      const base64 = photo.base64;
      setPhotos((prev) => [...prev, { uri: photo.uri, base64, slope }]);
    } catch (e) {
      Alert.alert('Capture failed', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const runAnalysis = async () => {
    if (photos.length === 0) return;
    setAnalyzing(true);
    setError(null);
    setPhase('analyzing');
    try {
      const out: AnalysisResult[] = [];
      for (const p of photos) {
        const r = await analyzePhoto({ imageBase64: p.base64, slope: p.slope });
        out.push(r);
      }
      setResults(out);
      setPhase('results');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      if (e instanceof GeminiNotConfiguredError) {
        setError('Gemini key not set. Add EXPO_PUBLIC_GEMINI_API_KEY in .env.local.');
      } else {
        setError(e instanceof Error ? e.message : 'Analysis failed.');
      }
      setPhase('results');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setAnalyzing(false);
    }
  };

  if (phase === 'analyzing' || phase === 'results') {
    return (
      <SafeAreaView style={styles.resultsRoot} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.resultsHeader}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: spacing.xs }}>
            <Ionicons name="chevron-back" size={26} color={colors.navy} />
          </Pressable>
          <Text style={styles.resultsTitle}>Quick Inspection</Text>
        </View>
        <ResultsView
          analyzing={analyzing}
          photos={photos}
          results={results}
          error={error}
          onRetake={() => {
            setPhotos([]);
            setResults([]);
            setError(null);
            setPhase('camera');
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" />
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.topRow}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.topBtn}
          >
            <Ionicons name="close" size={24} color={colors.textInverse} />
          </Pressable>
          <View style={styles.topPill}>
            <Text style={styles.topPillText}>
              {photos.length === 0 ? 'Tap shutter to capture' : `${photos.length} photo${photos.length === 1 ? '' : 's'}`}
            </Text>
          </View>
          <View style={styles.topBtn} />
        </View>

        <View style={styles.bottomDock}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.slopeRow}
          >
            {SLOPES.map((s) => (
              <Pressable
                key={s}
                style={[styles.slopeChip, slope === s && styles.slopeChipActive]}
                onPress={() => setSlope(s)}
              >
                <Text style={[styles.slopeChipText, slope === s && styles.slopeChipTextActive]}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.shutterRow}>
            <PhotoStrip photos={photos} />
            <Pressable
              style={styles.shutter}
              onPress={capture}
              accessibilityLabel="Capture photo"
            >
              <View style={styles.shutterInner} />
            </Pressable>
            <Pressable
              style={[styles.analyzeBtn, photos.length === 0 && styles.analyzeBtnDisabled]}
              disabled={photos.length === 0}
              onPress={runAnalysis}
            >
              <Text style={styles.analyzeBtnText}>Analyze</Text>
              <Text style={styles.analyzeBtnSub}>{photos.length}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return <View style={styles.permRoot}>{children}</View>;
}

function PhotoStrip({ photos }: { photos: CapturedPhoto[] }) {
  if (photos.length === 0) return <View style={{ width: 56 }} />;
  return (
    <View style={styles.photoStrip}>
      {photos.slice(-3).map((p, i) => (
        <Image key={i} source={{ uri: p.uri }} style={styles.thumb} />
      ))}
    </View>
  );
}

function ResultsView({
  analyzing,
  photos,
  results,
  error,
  onRetake,
}: {
  analyzing: boolean;
  photos: CapturedPhoto[];
  results: AnalysisResult[];
  error: string | null;
  onRetake: () => void;
}) {
  if (analyzing) {
    return (
      <View style={styles.analyzingWrap}>
        <ActivityIndicator color={colors.orange} size="large" />
        <Text style={styles.analyzingText}>Analyzing {photos.length} photo{photos.length === 1 ? '' : 's'}…</Text>
        <Text style={styles.analyzingSub}>Detecting hail · Checking granules · Wind · Flashing</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.resultsScroll}>
      {error && !isGeminiConfigured && (
        <View style={styles.warnCard}>
          <Ionicons name="information-circle-outline" size={22} color={colors.warn} />
          <View style={{ flex: 1 }}>
            <Text style={styles.warnTitle}>AI not connected</Text>
            <Text style={styles.warnBody}>
              Add a Gemini API key to enable damage detection. Photos are saved locally for later analysis.
            </Text>
          </View>
        </View>
      )}

      {error && isGeminiConfigured && (
        <View style={styles.errorCard}>
          <Ionicons name="warning-outline" size={22} color={colors.danger} />
          <View style={{ flex: 1 }}>
            <Text style={styles.errorTitle}>Analysis failed</Text>
            <Text style={styles.errorBody}>{error}</Text>
          </View>
        </View>
      )}

      {results.length > 0 && <SummaryCard results={results} />}

      {photos.map((p, i) => {
        const r = results[i];
        return (
          <View key={i} style={styles.photoCard}>
            <Image source={{ uri: p.uri }} style={styles.photoBig} />
            <View style={styles.photoMeta}>
              <Text style={styles.photoSlope}>Slope: {p.slope}</Text>
              {r ? (
                r.noRoofDetected ? (
                  <Text style={styles.photoFinding}>No roof detected in this photo.</Text>
                ) : (
                  <FindingList findings={r.findings} markers={r.markers} />
                )
              ) : (
                <Text style={styles.photoFinding}>Pending analysis.</Text>
              )}
            </View>
          </View>
        );
      })}

      <Pressable style={styles.retakeBtn} onPress={onRetake}>
        <Ionicons name="camera-reverse-outline" size={20} color={colors.navy} />
        <Text style={styles.retakeBtnText}>New inspection</Text>
      </Pressable>
    </ScrollView>
  );
}

function SummaryCard({ results }: { results: AnalysisResult[] }) {
  const totalMarkers = results.reduce((s, r) => s + r.markers.length, 0);
  const detectedCategories = new Set<string>();
  for (const r of results) {
    for (const f of r.findings) {
      if (f.detected) detectedCategories.add(f.label);
    }
  }
  const shingle = results.find((r) => r.shingleType)?.shingleType;

  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryTitle}>Inspection summary</Text>
      <View style={styles.summaryRow}>
        <SummaryStat label="Markers" value={String(totalMarkers)} />
        <SummaryStat label="Categories" value={String(detectedCategories.size)} />
        <SummaryStat label="Photos" value={String(results.length)} />
      </View>
      {shingle && (
        <Text style={styles.summarySub}>
          Material: {shingle.type} · {shingle.confidence}% confidence
        </Text>
      )}
    </View>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function FindingList({
  findings,
  markers,
}: {
  findings: InspectionFinding[];
  markers: DamageMarker[];
}) {
  const detected = findings.filter((f) => f.detected);
  if (detected.length === 0) {
    return <Text style={styles.photoFinding}>No damage detected.</Text>;
  }
  return (
    <View style={{ gap: spacing.xs }}>
      {detected.map((f) => (
        <View key={f.label} style={styles.findingRow}>
          <View style={[styles.sevDot, { backgroundColor: severityColor(f.severity) }]} />
          <Text style={styles.findingText}>
            {DAMAGE_CATEGORY_LABELS[f.label]} · {f.count}× · {f.confidence}%
          </Text>
        </View>
      ))}
      <Text style={styles.markerCount}>{markers.length} markers placed</Text>
    </View>
  );
}

function severityColor(s: Severity): string {
  return s === 'severe'
    ? colors.danger
    : s === 'moderate'
    ? colors.warn
    : s === 'minor'
    ? colors.info
    : colors.slate;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between' },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  topBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topPill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  topPillText: { color: colors.textInverse, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },

  bottomDock: {
    paddingBottom: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  slopeRow: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.sm },
  slopeChip: {
    minWidth: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slopeChipActive: { backgroundColor: colors.orange },
  slopeChipText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  slopeChipTextActive: { color: colors.textInverse },

  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.textInverse,
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.textInverse,
  },

  analyzeBtn: {
    minWidth: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  analyzeBtnDisabled: { opacity: 0.4 },
  analyzeBtnText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold },
  analyzeBtnSub: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },

  photoStrip: { flexDirection: 'row', gap: -16 },
  thumb: { width: 40, height: 40, borderRadius: 8, borderWidth: 2, borderColor: colors.textInverse, marginRight: -10 },

  // permission
  permRoot: { flex: 1, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  permWrap: { padding: spacing.xxl, alignItems: 'center', gap: spacing.md, maxWidth: 380 },
  permTitle: { color: colors.textInverse, fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, textAlign: 'center' },
  permBody: { color: 'rgba(255,255,255,0.82)', fontSize: fontSize.bodyMd, textAlign: 'center' },
  primaryBtn: {
    height: touchTarget.sticky,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
  linkText: { color: colors.textInverse, fontSize: fontSize.bodyMd },

  // results
  resultsRoot: { flex: 1, backgroundColor: colors.bg },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.md },
  resultsTitle: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.navy },
  resultsScroll: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },

  analyzingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  analyzingText: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy },
  analyzingSub: { fontSize: fontSize.bodySm, color: colors.slate, textAlign: 'center' },

  warnCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.warnSoft,
  },
  warnTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
  warnBody: { fontSize: fontSize.bodySm, color: colors.navy, marginTop: 2 },

  errorCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.dangerSoft,
  },
  errorTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.danger },
  errorBody: { fontSize: fontSize.bodySm, color: colors.danger, marginTop: 2 },

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  summaryTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },
  summaryRow: { flexDirection: 'row' },
  summaryValue: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.orange },
  summaryLabel: { fontSize: fontSize.bodySm, color: colors.slate },
  summarySub: { fontSize: fontSize.bodySm, color: colors.slate },

  photoCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    overflow: 'hidden',
    ...shadows.card,
  },
  photoBig: { width: '100%', height: 220 },
  photoMeta: { padding: spacing.lg, gap: spacing.sm },
  photoSlope: { fontSize: fontSize.bodySm, color: colors.slate, fontWeight: fontWeight.semibold },
  photoFinding: { fontSize: fontSize.bodyMd, color: colors.navy },

  findingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sevDot: { width: 10, height: 10, borderRadius: 5 },
  findingText: { fontSize: fontSize.bodyMd, color: colors.navy },
  markerCount: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: spacing.xs },

  retakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  retakeBtnText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
});
