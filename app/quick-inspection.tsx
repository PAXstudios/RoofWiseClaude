import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
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
import { type SlopeOrientation } from '@/lib/models/types';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';

const SLOPES: SlopeOrientation[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

type CapturedPhoto = {
  uri: string;
  slope: SlopeOrientation;
};

export default function QuickInspection() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const attachRawPhotos = useInspectionStore((s) => s.attachRawPhotos);
  const logActivity = useActivityStore((s) => s.log);
  const [permission, requestPermission] = useCameraPermissions();
  const camRef = useRef<CameraView>(null);
  const [slope, setSlope] = useState<SlopeOrientation>('S');
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  if (!permission) return <View style={styles.permRoot} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permRoot} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.permWrap}>
          <Ionicons name="camera-outline" size={40} color={colors.textInverse} />
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permBody}>
            RoofWise uses the camera to capture roof photos for HAAG-protocol analysis.
          </Text>
          <Pressable style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Enable camera</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={{ marginTop: spacing.md }}>
            <Text style={styles.linkText}>Not now</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const capture = async () => {
    if (!camRef.current) return;
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await camRef.current.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) throw new Error('No photo data');
      setPhotos((prev) => [...prev, { uri: photo.uri, slope }]);
    } catch (e) {
      Alert.alert('Capture failed', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const finish = () => {
    if (!jobId) {
      Alert.alert(
        'Not linked to a job',
        'Photos were captured but no job is set. Open a Job and tap Start Quick Inspection to attach.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
      return;
    }
    if (photos.length === 0) {
      router.back();
      return;
    }
    attachRawPhotos(jobId, photos);
    logActivity({
      kind: 'photo_captured',
      inspectionId: jobId,
      message: `Captured ${photos.length} photo${photos.length === 1 ? '' : 's'} for inspection`,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace({ pathname: `/job/${jobId}` as any });
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" />
      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.topBtn}>
            <Ionicons name="close" size={24} color={colors.textInverse} />
          </Pressable>
          <View style={styles.topPill}>
            <Text style={styles.topPillText}>
              {photos.length === 0 ? 'Tap shutter to capture' : `${photos.length} photo${photos.length === 1 ? '' : 's'}`}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/pitch-gauge')}
            hitSlop={10}
            style={styles.topBtn}
            accessibilityLabel="Open pitch gauge"
          >
            <Ionicons name="compass-outline" size={22} color={colors.textInverse} />
          </Pressable>
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
              style={[styles.doneBtn, photos.length === 0 && styles.doneBtnDisabled]}
              disabled={photos.length === 0}
              onPress={finish}
            >
              <Text style={styles.doneBtnText}>Done</Text>
              <Text style={styles.doneBtnSub}>{photos.length}</Text>
            </Pressable>
          </View>

          <Text style={styles.captureHint}>
            Photos save to the job. Run AI analysis after — Job Detail → Analyze.
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
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

  bottomDock: { paddingBottom: spacing.md, backgroundColor: 'rgba(0,0,0,0.55)' },
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
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.textInverse },

  doneBtn: {
    minWidth: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnDisabled: { opacity: 0.4 },
  doneBtnText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold },
  doneBtnSub: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },

  photoStrip: { flexDirection: 'row', gap: -16 },
  thumb: { width: 40, height: 40, borderRadius: 8, borderWidth: 2, borderColor: colors.textInverse, marginRight: -10 },

  captureHint: {
    color: 'rgba(240,240,228,0.78)',
    fontSize: fontSize.caption,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },

  permRoot: { flex: 1, backgroundColor: colors.navy },
  permWrap: { flex: 1, padding: spacing.xxl, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  permTitle: { color: colors.textInverse, fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, textAlign: 'center' },
  permBody: { color: 'rgba(255,255,255,0.82)', fontSize: fontSize.bodyMd, textAlign: 'center' },
  permBtn: {
    height: touchTarget.sticky,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  permBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
  linkText: { color: colors.textInverse, fontSize: fontSize.bodyMd },
});
