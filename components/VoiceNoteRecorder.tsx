import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
// SDK 54: expo-av is in its final release (removed in 55) — recording and
// playback moved to expo-audio. Same props/behavior for callers.
import {
  RecordingPresets,
  createAudioPlayer,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioPlayer,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';
import { useToastStore } from '@/lib/stores/toastStore';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import type { AudioNote } from '@/lib/models/types';

type Props = {
  notes: AudioNote[];
  onRecorded: (note: { uri: string; durationSec: number }) => void;
  onRemove: (noteId: string) => void;
  onTranscribe?: (noteId: string) => Promise<void> | void;
};

export function VoiceNoteRecorder({ notes, onRecorded, onRemove, onTranscribe }: Props) {
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  // The note whose trash icon was tapped — deletion asks in a sheet first
  // (Drift #1); a recording cannot be re-taken.
  const [pendingDelete, setPendingDelete] = useState<AudioNote | null>(null);
  const playbackRef = useRef<AudioPlayer | null>(null);
  const toast = useToastStore((s) => s.show);

  // One reusable recorder per mount; prepared fresh before each recording.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Polls every 250ms — the same cadence the expo-av interval used.
  const recorderState = useAudioRecorderState(recorder, 250);
  const recordingDuration = recording
    ? Math.floor(recorderState.durationMillis / 1000)
    : 0;

  useEffect(() => {
    // Seed permission state WITHOUT prompting: Job Detail mounts this card,
    // and requestRecordingPermissionsAsync here popped the iOS microphone
    // dialog before the roofer had tapped anything. The prompt now lives in
    // startRecording.
    (async () => {
      try {
        const perm = await getRecordingPermissionsAsync();
        setPermission(perm.granted);
      } catch {
        setPermission(false);
      }
    })();

    return () => {
      try {
        playbackRef.current?.remove();
      } catch {
        // Already released.
      }
    };
  }, []);

  const startRecording = async () => {
    let granted = permission === true;
    if (!granted) {
      // First tap asks; iOS shows the system dialog here, on the user's action.
      try {
        const perm = await requestRecordingPermissionsAsync();
        granted = perm.granted;
        setPermission(granted);
      } catch {
        granted = false;
      }
    }
    if (!granted) {
      toast({ tone: 'warn', title: 'Microphone access needed' });
      return;
    }
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      toast({ tone: 'danger', title: 'Could not start recording' });
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    const durationSec = recordingDuration;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri) {
        onRecorded({ uri, durationSec });
        toast({ tone: 'success', title: 'Voice note saved' });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } finally {
      setRecording(false);
      // Leave the Record category. expo-audio keeps the iOS session in
      // PlayAndRecord after stop(), which routes later playback to the
      // earpiece at near-silent volume.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
        () => {},
      );
    }
  };

  const releasePlayer = () => {
    const player = playbackRef.current;
    playbackRef.current = null;
    if (!player) return;
    try {
      player.pause();
      player.remove();
    } catch {
      // Already released.
    }
  };

  const playNote = async (note: AudioNote) => {
    try {
      if (playingId === note.id) {
        releasePlayer();
        setPlayingId(null);
        return;
      }
      releasePlayer();
      // Playback category (speaker), never the leftover Record category.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
        () => {},
      );
      const player = createAudioPlayer({ uri: note.uri });
      playbackRef.current = player;
      setPlayingId(note.id);
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) {
          setPlayingId(null);
        }
      });
      player.play();
    } catch {
      toast({ tone: 'danger', title: 'Playback failed' });
    }
  };

  if (permission === null) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.slate} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Voice notes</Text>
      <Text style={styles.sub}>
        Hold the mic for hands-free notes — transcribed later by AI.
      </Text>

      <View style={styles.recordRow}>
        <Pressable
          style={[
            styles.recordBtn,
            recording ? styles.recordBtnActive : null,
          ]}
          onPress={recording ? stopRecording : startRecording}
        >
          <Ionicons
            name={recording ? 'stop' : 'mic'}
            size={28}
            color={colors.textInverse}
          />
          <Text style={styles.recordText}>
            {recording ? `Stop · ${formatDuration(recordingDuration)}` : 'Record voice note'}
          </Text>
        </Pressable>
      </View>

      {notes.length > 0 && (
        <View style={styles.notesList}>
          {notes.map((note, i) => (
            <View
              key={note.id}
              style={[styles.noteRow, i > 0 && styles.noteRowBorder]}
            >
              <Pressable style={styles.playBtn} onPress={() => playNote(note)}>
                <Ionicons
                  name={playingId === note.id ? 'pause' : 'play'}
                  size={20}
                  color={colors.textInverse}
                />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.noteLabel} numberOfLines={3}>
                  {note.label ?? `Note · ${formatDuration(note.durationSec)}`}
                </Text>
                <Text style={styles.noteMeta}>
                  {new Date(note.recordedAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
              {onTranscribe && !note.label && (
                <Pressable
                  onPress={async () => {
                    setTranscribingId(note.id);
                    try {
                      await onTranscribe(note.id);
                    } finally {
                      setTranscribingId(null);
                    }
                  }}
                  style={styles.iconBtn}
                  disabled={transcribingId === note.id}
                  accessibilityRole="button"
                  accessibilityLabel="Transcribe voice note"
                >
                  {transcribingId === note.id ? (
                    <ActivityIndicator color={colors.orange} />
                  ) : (
                    <Ionicons name="sparkles-outline" size={20} color={colors.orange} />
                  )}
                </Pressable>
              )}
              <Pressable
                onPress={() => setPendingDelete(note)}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="Delete voice note"
              >
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <ConfirmSheet
        visible={pendingDelete !== null}
        title="Delete this voice note?"
        body={
          pendingDelete
            ? `${pendingDelete.label ?? `Note · ${formatDuration(pendingDelete.durationSec)}`} will be removed. A recording cannot be re-taken.`
            : undefined
        }
        onConfirm={() => {
          if (pendingDelete) onRemove(pendingDelete.id);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </View>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  label: {
    fontSize: fontSize.caption,
    color: colors.slate,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sub: { fontSize: fontSize.bodySm, color: colors.slate },

  recordRow: { marginTop: spacing.md },
  recordBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnActive: { backgroundColor: colors.danger },
  recordText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },

  notesList: { marginTop: spacing.md },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  noteRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  playBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteLabel: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.medium },
  noteMeta: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  // Row icon buttons take the glove floor (Drift #1) — they were bare 18px
  // glyphs with hitSlop.
  iconBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
