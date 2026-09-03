// Photos tab — capture, the per-slope HAAG test-square blocks (unchanged
// from the old single-scroll job page, just moved here), and a new Photo
// Log: every photo across every slope in one 2-up grid with a caption, a
// long-press action sheet, and a real Annotate mount point
// (`components/photo/AnnotatedPhoto.tsx` — that module already exists in
// this tree, built by the annotations wave, so this tab uses it for real
// rather than stubbing it).

import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/PressableScale';
import { AnnotatedPhoto } from '@/components/photo/AnnotatedPhoto';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconChip, type IoniconName } from '@/components/ui/IconChip';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { AnalysisQueueChip } from '@/components/AnalysisQueueChip';
import { usePhotoCaptionStore } from '@/lib/stores/photoCaptionStore';
import { formatRelative } from '@/lib/format/date';
import { thresholdFor, carrierBarsRead } from '@/lib/services/haagThresholds';
import { documentedCoverage, documentedSummary } from '@/lib/services/documentedSquares';
import { deriveFunctional } from '@/lib/services/functionalDamage';
import type { LibraryImportProgress } from '@/lib/services/libraryImport';
import {
  DAMAGE_CATEGORY_LABELS,
  type Inspection,
  type Slope,
  type SlopeVerdict,
} from '@/lib/models/types';
import type { DecisionEngineResult, HaagEngineResult } from '@/lib/services/decisionEngine';
import { colors, fontSize, fontWeight, radii, shadows, spacing, touchTarget } from '@/theme/tokens';

/** Rates are read by adjusters — print 6.9, never 6.888888888888889. */
function fmtRate(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const SLOPE_VERDICT_PILL_TONE: Record<SlopeVerdict, PillTone> = {
  full_replace: 'accent',
  partial_replace: 'warn',
  verify_with_inspector: 'info',
  repair: 'neutral',
};
const SLOPE_VERDICT_LABEL: Record<SlopeVerdict, string> = {
  full_replace: 'Full replace',
  partial_replace: 'Partial',
  verify_with_inspector: 'Verify',
  repair: 'Repair',
};

type Props = {
  inspection: Inspection;
  decision: DecisionEngineResult;
  haag: HaagEngineResult;
  pendingHere: number;
  importing: boolean;
  importProgress: LibraryImportProgress | null;
  onOpenCapture: () => void;
  onImportFromLibrary: () => void;
};

export function PhotosTab({
  inspection,
  decision,
  haag,
  pendingHere,
  importing,
  importProgress,
  onOpenCapture,
  onImportFromLibrary,
}: Props) {
  const totalPhotos = inspection.slopes.reduce((a, sl) => a + sl.photoPaths.length, 0);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
      <PressableScale
        style={styles.captureCta}
        onPress={onOpenCapture}
        accessibilityRole="button"
        accessibilityLabel="Take photos to analyse for this job"
      >
        <Ionicons name="camera" size={24} color={colors.textInverse} />
        <Text style={styles.captureCtaText}>Take photos to analyse</Text>
      </PressableScale>

      <PressableScale
        style={[styles.importCta, importing && { opacity: 0.6 }]}
        disabled={importing}
        onPress={onImportFromLibrary}
        accessibilityRole="button"
        accessibilityLabel="Import photos from library for this job"
      >
        {importing ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <Ionicons name="images-outline" size={22} color={colors.text} />
        )}
        <Text style={styles.importCtaText}>
          {importing
            ? importProgress
              ? importProgress.phase === 'multi'
                ? `Importing ${importProgress.done} of ${importProgress.total}…`
                : `Imported ${importProgress.done}…`
              : 'Opening library…'
            : 'Import from library'}
        </Text>
      </PressableScale>

      {pendingHere > 0 && (
        <View style={styles.pendingStrip}>
          <AnalysisQueueChip inspectionId={inspection.id} />
        </View>
      )}

      <SectionHeader title="Roof Slopes" style={styles.sectionSpacing} />
      {inspection.slopes.length === 0 ? (
        <View style={styles.placeholderBox}>
          <IconChip name="camera-outline" tone="quiet" size="md" />
          <Text style={styles.placeholderText}>No slopes captured yet. Take photos above to start one.</Text>
        </View>
      ) : (
        inspection.slopes.map((slope) => {
          const result = decision.perSlope.find((r) => r.slopeId === slope.id);
          return (
            <SlopeBlock
              key={slope.id}
              inspection={inspection}
              slope={slope}
              verdict={result?.verdict ?? 'repair'}
              reasoning={result?.reasoning ?? ''}
              confidenceAvg={result?.confidenceAvg ?? 0}
              hitsPerSquare={haag.slope_evaluations.find((e) => e.slope === slope.id)?.hail_hits_per_square}
            />
          );
        })
      )}

      <SectionHeader title="Photo Log" style={styles.sectionSpacing} />
      <Text style={styles.photoLogIntro}>Tap a photo to add or edit its caption. Hold for more.</Text>
      {totalPhotos === 0 ? (
        <View style={styles.placeholderBox}>
          <IconChip name="images-outline" tone="quiet" size="md" />
          <Text style={styles.placeholderText}>No photos yet — take or import some above.</Text>
        </View>
      ) : (
        <PhotoLog inspection={inspection} />
      )}
    </ScrollView>
  );
}

// -----------------------------------------------------------------------------
// Photo Log — every photo, every slope, one 2-up grid.
// -----------------------------------------------------------------------------

type PhotoLogEntry = {
  uri: string;
  slopeId: string;
  slopeLabel: string;
  photoIndex: number;
  areaTag?: string;
  analyzedAt?: string;
};

function PhotoLog({ inspection }: { inspection: Inspection }) {
  const router = useRouter();
  const captions = usePhotoCaptionStore((s) => s.captions);
  const [captionTarget, setCaptionTarget] = useState<PhotoLogEntry | null>(null);
  const [actionTarget, setActionTarget] = useState<PhotoLogEntry | null>(null);

  const entries = useMemo<PhotoLogEntry[]>(() => {
    const out: PhotoLogEntry[] = [];
    for (const slope of inspection.slopes) {
      slope.photoPaths.forEach((uri, i) => {
        const meta = slope.photoMeta?.find((m) => m.photoIndex === i);
        const st = slope.photoAnalysis?.[uri];
        out.push({
          uri,
          slopeId: slope.id,
          slopeLabel: slope.orientation,
          photoIndex: i,
          areaTag: meta?.areaTag,
          analyzedAt: st?.status === 'done' ? st.at : undefined,
        });
      });
    }
    return out;
  }, [inspection.slopes]);

  return (
    <>
      <View style={styles.logGrid}>
        {entries.map((entry) => {
          const slope = inspection.slopes.find((s) => s.id === entry.slopeId);
          const markers = slope?.damage.filter((m) => m.photoIndex === entry.photoIndex) ?? [];
          const caption = captions[entry.uri];
          const timeLabel = caption
            ? `Captioned ${formatRelative(caption.updatedAt)}`
            : entry.analyzedAt
              ? `Analyzed ${formatRelative(entry.analyzedAt)}`
              : undefined;
          return (
            <View key={`${entry.slopeId}_${entry.photoIndex}`} style={styles.logTileWrap}>
              <AnnotatedPhoto
                uri={entry.uri}
                style={styles.logTile}
                markers={markers}
                onPress={() => setCaptionTarget(entry)}
                onLongPress={() => setActionTarget(entry)}
                accessibilityLabel={`${entry.slopeLabel} slope photo${entry.areaTag ? `, ${entry.areaTag}` : ''}${caption ? `, captioned ${caption.text}` : ''}. Tap to caption, hold for more.`}
              >
                <View style={styles.logTagRow} pointerEvents="none">
                  <View style={styles.logTag}>
                    <Text style={styles.logTagText} numberOfLines={1}>
                      {entry.slopeLabel}
                      {entry.areaTag ? ` · ${entry.areaTag}` : ''}
                    </Text>
                  </View>
                </View>
              </AnnotatedPhoto>
              <Text style={styles.logCaption} numberOfLines={2}>
                {caption?.text ?? 'No caption'}
              </Text>
              {timeLabel ? <Text style={styles.logTime}>{timeLabel}</Text> : null}
            </View>
          );
        })}
      </View>

      <PhotoCaptionSheet
        entry={captionTarget}
        initialText={captionTarget ? (captions[captionTarget.uri]?.text ?? '') : ''}
        onClose={() => setCaptionTarget(null)}
      />

      <BottomSheet
        visible={!!actionTarget}
        onClose={() => setActionTarget(null)}
        title="Photo"
        subtitle={actionTarget ? `${actionTarget.slopeLabel} slope${actionTarget.areaTag ? ` · ${actionTarget.areaTag}` : ''}` : undefined}
        accessibilityLabel="Photo actions"
      >
        <PhotoLogActionRow
          icon="pricetag-outline"
          label="Add / edit caption"
          onPress={() => {
            if (actionTarget) setCaptionTarget(actionTarget);
            setActionTarget(null);
          }}
        />
        <PhotoLogActionRow
          icon="document-text-outline"
          label="View photo report"
          onPress={() => {
            if (actionTarget) {
              router.push({
                pathname: '/photo-report',
                params: {
                  inspectionId: inspection.id,
                  slopeId: actionTarget.slopeId,
                  photoIndex: String(actionTarget.photoIndex),
                },
              });
            }
            setActionTarget(null);
          }}
        />
        <PhotoLogActionRow
          icon="brush-outline"
          label="Annotate"
          onPress={() => {
            if (actionTarget) {
              router.push({
                pathname: '/annotate',
                params: {
                  uri: actionTarget.uri,
                  inspectionId: inspection.id,
                  slopeId: actionTarget.slopeId,
                  index: String(actionTarget.photoIndex),
                },
              });
            }
            setActionTarget(null);
          }}
        />
      </BottomSheet>
    </>
  );
}

function PhotoLogActionRow({
  icon,
  label,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableScale style={styles.actionRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={styles.actionRowText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
    </PressableScale>
  );
}

function PhotoCaptionSheet({
  entry,
  initialText,
  onClose,
}: {
  entry: PhotoLogEntry | null;
  initialText: string;
  onClose: () => void;
}) {
  const setCaption = usePhotoCaptionStore((s) => s.setCaption);
  const [text, setText] = useState(initialText);

  // Reset the draft whenever a different photo opens, AND whenever the sheet
  // re-opens on the SAME photo after being dismissed without saving — a
  // swipe-to-close draft must never haunt the next open of the same photo.
  const [openUri, setOpenUri] = useState<string | null>(null);
  if (entry && entry.uri !== openUri) {
    setOpenUri(entry.uri);
    setText(initialText);
  } else if (!entry && openUri !== null) {
    setOpenUri(null);
  }

  const save = () => {
    if (entry) setCaption(entry.uri, text);
    onClose();
  };

  return (
    <BottomSheet visible={!!entry} onClose={onClose} title="Caption" subtitle={entry?.slopeLabel} accessibilityLabel="Edit photo caption">
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="What's in this photo?"
        placeholderTextColor={colors.textSubtle}
        style={styles.captionInput}
        multiline
        textAlignVertical="top"
        autoFocus
      />
      <PressableScale style={styles.saveCaptionBtn} onPress={save} accessibilityRole="button" accessibilityLabel="Save caption">
        <Ionicons name="checkmark" size={20} color={colors.textInverse} />
        <Text style={styles.saveCaptionText}>Save caption</Text>
      </PressableScale>
    </BottomSheet>
  );
}

// -----------------------------------------------------------------------------
// SlopeBlock — the per-slope HAAG test-square card. Unchanged behavior from
// the old single-scroll job page; thumbnails now go through AnnotatedPhoto so
// a hand-drawn annotation shows its badge right here too.
// -----------------------------------------------------------------------------

function SlopeBlock({
  inspection,
  slope,
  verdict,
  reasoning,
  confidenceAvg,
  hitsPerSquare,
}: {
  inspection: Inspection;
  slope: Slope;
  verdict: SlopeVerdict;
  reasoning: string;
  confidenceAvg: number;
  hitsPerSquare?: number;
}) {
  const router = useRouter();
  const detected = (slope.aiFindings ?? []).filter((f) => f.detected);
  const threshold = thresholdFor(inspection.material);
  const coverage = documentedCoverage(slope);
  const functionalInfo = deriveFunctional(slope);
  const legacyAnalyzed = new Set(slope.analyzedPhotoIndices ?? []);
  const analyzedHere = slope.photoPaths.filter((uri, i) => {
    const st = slope.photoAnalysis?.[uri];
    return st?.status === 'done' || (!st && legacyAnalyzed.has(i));
  }).length;

  return (
    <RichCard
      icon="home-outline"
      iconTone="blue"
      title={`Slope ${slope.orientation}`}
      headerTrailing={
        analyzedHere > 0 ? (
          <Pill label={SLOPE_VERDICT_LABEL[verdict]} tone={SLOPE_VERDICT_PILL_TONE[verdict]} size="sm" />
        ) : (
          <Pill label="Not assessed" tone="neutral" size="sm" />
        )
      }
    >
      <PressableScale
        style={styles.analyzeBtn}
        onPress={() => router.push({ pathname: '/analyze', params: { inspectionId: inspection.id, slopeId: slope.id } })}
      >
        <Ionicons name="analytics-outline" size={18} color={colors.text} />
        <Text style={styles.analyzeBtnText}>Analyze photos</Text>
      </PressableScale>

      {slope.photoPaths.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {slope.photoPaths.map((uri, i) => (
              <AnnotatedPhoto
                key={i}
                uri={uri}
                style={styles.photoTile}
                markers={slope.damage.filter((m) => m.photoIndex === i)}
                onPress={() =>
                  router.push({
                    pathname: '/photo-report',
                    params: { inspectionId: inspection.id, slopeId: slope.id, photoIndex: String(i) },
                  })
                }
              />
            ))}
          </View>
        </ScrollView>
      )}

      <View style={styles.testSquare}>
        <Text style={styles.testSquareLabel}>HAAG test square</Text>
        <Text style={styles.testSquareLine}>
          {hitsPerSquare != null
            ? `${fmtRate(hitsPerSquare)} hits per 10×10' square`
            : `${slope.hailCount} hits observed`}
          {' · threshold '}
          {threshold.hitsPerTestSquare === 0 ? '(penetration / crack)' : `${threshold.hitsPerTestSquare}+ per 10×10' square`}
        </Text>
        {hitsPerSquare != null && (
          <Text style={styles.testSquareLine}>
            {slope.hailCount} hit{slope.hailCount === 1 ? '' : 's'} documented across {slope.photoPaths.length} photo
            {slope.photoPaths.length === 1 ? '' : 's'} on this slope.
          </Text>
        )}
        {hitsPerSquare != null && hitsPerSquare > 0 && threshold.hitsPerTestSquare > 0 && (
          <Text
            style={[
              styles.testSquareLine,
              carrierBarsRead(inspection.material, hitsPerSquare).meetsStandard ? styles.functionalYes : undefined,
            ]}
          >
            {carrierBarsRead(inspection.material, hitsPerSquare).line}
          </Text>
        )}
        {coverage.photos > 0 && <Text style={styles.testSquareLine}>{documentedSummary(coverage)}</Text>}
        <Text style={[styles.testSquareLine, functionalInfo.functional ? styles.functionalYes : undefined]}>
          {functionalInfo.functional ? 'Functional damage: yes — ' : 'Functional damage: not established — '}
          {functionalInfo.reason}
        </Text>
        <Text style={styles.testSquareRule}>{threshold.rule}</Text>
      </View>

      {detected.length > 0 && (
        <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
          {detected.map((f) => (
            <Text key={f.label} style={styles.cardSub}>
              • {DAMAGE_CATEGORY_LABELS[f.label]} × {f.count} ({f.confidence}%)
            </Text>
          ))}
        </View>
      )}

      {analyzedHere > 0 ? (
        reasoning ? (
          <Text style={styles.reasoning}>
            {reasoning}
            {confidenceAvg > 0 ? ` (avg confidence ${Math.round(confidenceAvg)}%)` : ''}
          </Text>
        ) : null
      ) : (
        <Text style={styles.reasoning}>Not assessed — analyze photos on this slope to get a per-slope verdict.</Text>
      )}
    </RichCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  sectionSpacing: { marginBottom: spacing.sm },

  captureCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.brand,
    ...shadows.raised,
  },
  captureCtaText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
  importCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  importCtaText: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  pendingStrip: { marginTop: spacing.xs },

  placeholderBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  placeholderText: { color: colors.textMuted, fontSize: fontSize.bodyMd, textAlign: 'center' },

  photoLogIntro: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: -spacing.xs },
  logGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  logTileWrap: { width: '48%', gap: 2 },
  logTile: { width: '100%', height: 110, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  logTagRow: { position: 'absolute', left: 6, bottom: 6, right: 6 },
  logTag: { alignSelf: 'flex-start', backgroundColor: colors.scrim, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, maxWidth: '100%' },
  logTagText: { color: colors.textInverse, fontSize: 10, fontWeight: fontWeight.semibold },
  logCaption: { fontSize: fontSize.bodySm, color: colors.text, marginTop: 2 },
  logTime: { fontSize: fontSize.caption, color: colors.textSubtle },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
  },
  actionRowText: { flex: 1, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },

  captionInput: {
    minHeight: 96,
    fontSize: fontSize.bodyMd,
    color: colors.text,
    padding: spacing.md,
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.control,
  },
  saveCaptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.brand,
    marginTop: spacing.sm,
  },
  saveCaptionText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    marginTop: spacing.md,
  },
  analyzeBtnText: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  photoTile: {
    width: 140,
    height: 100,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },

  testSquare: { backgroundColor: colors.fillQuiet, borderRadius: radii.control, padding: spacing.md, gap: 2, marginTop: spacing.md },
  testSquareLabel: { fontSize: fontSize.caption, color: colors.textSubtle, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  testSquareLine: { fontSize: fontSize.bodyMd, color: colors.text, fontWeight: fontWeight.medium },
  functionalYes: { color: colors.danger, fontWeight: fontWeight.semibold },
  testSquareRule: { fontSize: fontSize.bodySm, color: colors.textMuted },

  cardSub: { fontSize: fontSize.bodyMd, color: colors.textMuted },
  reasoning: { fontSize: fontSize.bodySm, color: colors.textMuted, fontStyle: 'italic', marginTop: spacing.sm },
});
