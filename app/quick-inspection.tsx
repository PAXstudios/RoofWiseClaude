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
import {
  Stack,
  useLocalSearchParams,
  useRootNavigationState,
  useRouter,
} from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { prepareCapturedPhoto } from '@/lib/services/imagePipeline';
import * as Haptics from 'expo-haptics';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';
import { type SlopeOrientation } from '@/lib/models/types';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useSafetyStore } from '@/lib/stores/safetyStore';
import { CameraHUD } from '@/components/CameraHUD';

const SLOPES: SlopeOrientation[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

type CapturedPhoto = {
  uri: string;
  slope: SlopeOrientation;
};

export default function QuickInspection() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const attachRawPhotos = useInspectionStore((s) => s.attachRawPhotos);
  const createInspection = useInspectionStore((s) => s.create);
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

  // Pre-flight safety check (re-runs the checklist every 4h while enabled).
  // Gated on navigator readiness: cold-launching straight into this route
  // (deep link, notification tap) used to fire router.replace before the
  // root navigator mounted, which throws "Attempted to navigate before
  // mounting the Root Layout component" and leaves a dead screen.
  const preFlightEnabled = useSafetyStore((s) => s.preFlightEnabled);
  const lastConfirmedAt = useSafetyStore((s) => s.lastConfirmedAt);
  const navReady = !!useRootNavigationState()?.key;
  useEffect(() => {
    if (!navReady) return;
    if (!preFlightEnabled) return;
    const fresh =
      lastConfirmedAt &&
      Date.now() - new Date(lastConfirmedAt).getTime() < 4 * 60 * 60 * 1000;
    if (fresh) return;
    router.replace({
      pathname: '/safety-check',
      params: jobId ? { jobId } : undefined,
    });
  }, [navReady, preFlightEnabled, lastConfirmedAt, router, jobId]);

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
      // Capture near-lossless. The old 0.7 baked JPEG artifacts into the
      // frame before our pipeline ever saw it, permanently smearing the
      // granule texture damage calls depend on. prepareCapturedPhoto is
      // the single intentional lossy step. (Unrelated to the ImagePicker
      // `quality` param removed in #23 — that was a multi-HEIC OOM path.)
      const photo = await camRef.current.takePictureAsync({ quality: 0.95 });
      if (!photo?.uri) throw new Error('No photo data');
      const small = await prepareCapturedPhoto(photo.uri);
      setPhotos((prev) => [...prev, { uri: small, slope }]);
    } catch (e) {
      Alert.alert('Capture failed', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const pickFromLibrary = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photos access needed',
          'Enable Photos access in Settings to upload existing images.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        // Single-select only. Expo Go's multi-select native handler rejects its
        // promise once per failed asset; two failures = double-reject = SIGABRT
        // (app dies, no JS error). The single path settles exactly once. The
        // user taps the library button again to add more photos.
        allowsMultipleSelection: false,
        // Compatible (not Current) makes iOS transcode HEIC / iCloud originals
        // to a readable JPEG before handing them over. Current returns raw HEIC
        // bytes, which fail with "Cannot load representation of type public.heic"
        // — especially on the simulator and for not-yet-downloaded iCloud photos.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled || result.assets.length === 0) return;
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const small = await prepareCapturedPhoto(result.assets[0].uri);
      setPhotos((prev) => [...prev, { uri: small, slope }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const readFail = /load representation|failed to read/i.test(msg);
      Alert.alert(
        readFail ? "Couldn't read that photo" : 'Upload failed',
        readFail
          ? "iOS couldn't load this image's data. This is common with the iOS Simulator's built-in photos (they're HEIC placeholders) and with iCloud photos that haven't fully downloaded to the device. Try a screenshot as a test image, pick a different photo, or run on a real iPhone."
          : msg,
      );
    }
  };

  const finish = () => {
    if (photos.length === 0) {
      router.back();
      return;
    }

    // Standalone capture (no job set) auto-creates a lightweight inspection so
    // photos are never lost. Customer/address/roof details default to
    // placeholders the inspector can edit later on the Job screen.
    let targetId = jobId;
    if (!targetId) {
      const ins = createInspection({
        customerName: 'Quick inspection',
        address: 'Address pending',
        material: 'architectural_asphalt',
        ageYears: 0,
        geometry: 'gable',
        condition: 'good',
      });
      targetId = ins.id;
      logActivity({
        kind: 'job_created',
        inspectionId: ins.id,
        message: `Created quick inspection ${ins.reportId}`,
      });
    }

    attachRawPhotos(targetId, photos);
    logActivity({
      kind: 'photo_captured',
      inspectionId: targetId,
      message: `Captured ${photos.length} photo${photos.length === 1 ? '' : 's'} for inspection`,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Jump straight into AI analysis for the slope we just filled so the
    // capture -> analyze loop is one continuous flow. Fall back to the job
    // screen only if no slope ended up with photos.
    const ins = useInspectionStore.getState().inspections.find((i) => i.id === targetId);
    const slopeWithPhotos = ins?.slopes.find((s) => s.photoPaths.length > 0);
    if (slopeWithPhotos) {
      router.replace({
        pathname: '/analyze',
        params: { inspectionId: targetId, slopeId: slopeWithPhotos.id },
      });
    } else {
      router.replace({ pathname: `/job/${targetId}` as any });
    }
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing="back" />
      <CameraHUD selectedSlope={slope} />
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
          <View style={styles.topRightGroup}>
            <Pressable
              onPress={pickFromLibrary}
              hitSlop={10}
              style={styles.topBtn}
              accessibilityLabel="Add a photo from library (tap again for more)"
            >
              <Ionicons name="images-outline" size={22} color={colors.textInverse} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/pitch-gauge')}
              hitSlop={10}
              style={styles.topBtn}
              accessibilityLabel="Open pitch gauge"
            >
              <Ionicons name="compass-outline" size={22} color={colors.textInverse} />
            </Pressable>
          </View>
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
            Capture or upload, then tap Done to run AI damage analysis.
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
  topRightGroup: { flexDirection: 'row', gap: spacing.sm },
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
