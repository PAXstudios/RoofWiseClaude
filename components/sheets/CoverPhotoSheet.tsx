// "Change photo" — the sheet behind the job hero's camera button.
//
// The photo that fronts a job used to be whichever slope photo was shot
// first: a 10×10 test square of shingles, not a house. Now the Zillow record's
// lead photo fronts the job by default and the inspector can pick any of the
// record's photos, any captured photo, a new shot, or one from the library.
// Picks from the camera/library are COPIED into the app's document directory
// (the picker hands back a cache URI the OS may purge). Never stock imagery:
// with no record and no photos the hero keeps its gradient placeholder.

import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale } from '@/components/PressableScale';
import type { IoniconName } from '@/components/ui/IconChip';
import type { CoverPhoto, Inspection } from '@/lib/models/types';
import { coverPhotoSource, coverPhotoUri, zillowPhotoUrl } from '@/lib/services/propertyRecord';
import { colors, dataLabel, fontFamily, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  visible: boolean;
  inspection: Pick<Inspection, 'id' | 'coverPhoto' | 'propertyRecord' | 'slopes'>;
  onClose: () => void;
  /** undefined = back to the automatic choice (record photo, else first capture). */
  onChoose: (cover: CoverPhoto | undefined) => void;
};

const COVER_DIR = `${FileSystem.documentDirectory ?? ''}covers/`;

async function persistPick(uri: string, inspectionId: string): Promise<string> {
  try {
    await FileSystem.makeDirectoryAsync(COVER_DIR, { intermediates: true });
    const ext = /\.(png|heic|webp)$/i.exec(uri)?.[1] ?? 'jpg';
    const dest = `${COVER_DIR}${inspectionId}_${Date.now()}.${ext}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    // Copy failed (web, permissions) — the original URI still renders for now.
    return uri;
  }
}

export function CoverPhotoSheet({ visible, inspection, onClose, onChoose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) setBusy(null);
  }, [visible]);

  const current = coverPhotoUri(inspection, 'card');
  const source = coverPhotoSource(inspection);
  const zillowPhotos = inspection.propertyRecord?.status === 'found' ? inspection.propertyRecord.imageUrls ?? [] : [];
  const captured = inspection.slopes.flatMap((sl) => sl.photoPaths);

  const choose = (cover: CoverPhoto | undefined) => {
    onClose();
    setTimeout(() => onChoose(cover), 120);
  };

  const takePhoto = async () => {
    setBusy('camera');
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
      const uri = res.canceled ? undefined : res.assets?.[0]?.uri;
      if (!uri) return;
      const stored = await persistPick(uri, inspection.id);
      choose({ uri: stored, source: 'library', setAt: new Date().toISOString() });
    } finally {
      setBusy(null);
    }
  };

  const pickFromLibrary = async () => {
    setBusy('library');
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
      const uri = res.canceled ? undefined : res.assets?.[0]?.uri;
      if (!uri) return;
      const stored = await persistPick(uri, inspection.id);
      choose({ uri: stored, source: 'library', setAt: new Date().toISOString() });
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Job photo"
      subtitle={
        source === 'zillow'
          ? 'Showing the Zillow listing photo.'
          : source === 'capture'
            ? 'Showing the first captured photo.'
            : source === 'library'
              ? 'Showing a photo you chose.'
              : 'No photo yet — pick one below.'
      }
      accessibilityLabel="Change the job photo"
    >
      {current ? (
        <View style={styles.currentRow}>
          <Image source={{ uri: current }} style={styles.currentThumb} contentFit="cover" transition={120} />
          <Text style={styles.currentText}>Current photo</Text>
        </View>
      ) : null}

      {zillowPhotos.length > 0 ? (
        <>
          <Text style={styles.groupLabel}>Zillow listing photos</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {zillowPhotos.slice(0, 12).map((u, i) => (
              <PressableScale
                key={u}
                style={styles.tile}
                accessibilityRole="button"
                accessibilityLabel={`Use Zillow photo ${i + 1}`}
                onPress={() => choose({ uri: u, source: 'zillow', setAt: new Date().toISOString() })}
              >
                <Image source={{ uri: zillowPhotoUrl(u, 384) }} style={styles.tileImage} contentFit="cover" transition={120} />
              </PressableScale>
            ))}
          </ScrollView>
        </>
      ) : null}

      {captured.length > 0 ? (
        <>
          <Text style={styles.groupLabel}>Photos from this job</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {captured.slice(0, 24).map((u, i) => (
              <PressableScale
                key={u}
                style={styles.tile}
                accessibilityRole="button"
                accessibilityLabel={`Use captured photo ${i + 1}`}
                onPress={() => choose({ uri: u, source: 'capture', setAt: new Date().toISOString() })}
              >
                <Image source={{ uri: u }} style={styles.tileImage} contentFit="cover" transition={120} />
              </PressableScale>
            ))}
          </ScrollView>
        </>
      ) : null}

      <Row icon="camera-outline" label="Take a photo of the house" busy={busy === 'camera'} onPress={takePhoto} />
      <Row icon="images-outline" label="Choose from library" busy={busy === 'library'} onPress={pickFromLibrary} />
      {inspection.coverPhoto ? (
        <Row icon="refresh-outline" label="Use the automatic photo" onPress={() => choose(undefined)} />
      ) : null}
    </BottomSheet>
  );
}

function Row({ icon, label, busy, onPress }: { icon: IoniconName; label: string; busy?: boolean; onPress: () => void }) {
  return (
    <PressableScale style={styles.row} onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={label}>
      {busy ? <ActivityIndicator color={colors.text} /> : <Ionicons name={icon} size={22} color={colors.text} />}
      <Text style={styles.rowText}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  currentThumb: { width: 72, height: 54, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  currentText: { fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.regular, color: colors.textMuted },
  groupLabel: { ...dataLabel, color: colors.textMuted },
  strip: { gap: spacing.sm },
  // 96×72 tiles — big enough to read the house, ≥56pt tall (Drift #1).
  tile: { width: 96, height: 72, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  tileImage: { width: '100%', height: '100%' },
  row: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  rowText: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.text,
  },
});
