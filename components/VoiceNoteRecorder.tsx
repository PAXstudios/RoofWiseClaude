import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Audio } from 'expo-av';
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
import type { AudioNote } from '@/lib/models/types';

type Props = {
  notes: AudioNote[];
  onRecorded: (note: { uri: string; durationSec: number }) => void;
  onRemove: (noteId: string) => void;
  onTranscribe?: (noteId: string) => Promise<void> | void;
};

export function VoiceNoteRecorder({ notes, onRecorded, onRemove, onTranscribe }: Props) {
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playbackRef = useRef<Audio.Sound | null>(null);
  const toast = useToastStore((s) => s.show);

  useEffect(() => {
    (async () => {
      const perm = await Audio.requestPermissionsAsync();
      setPermission(perm.granted);
    })();

    return () => {
      playbackRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(async () => {
      const status = await recording.getStatusAsync();
      if (status.isRecording) {
        setRecordingDuration(Math.floor(status.durationMillis / 1000));
      }
    }, 250);
    return () => clearInterval(t);
  }, [recording]);

  const startRecording = async () => {
    if (!permission) {
      toast({ tone: 'warn', title: 'Microphone access needed' });
      return;
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      setRecording(rec);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      toast({ tone: 'danger', title: 'Could not start recording' });
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (uri) {
        onRecorded({ uri, durationSec: recordingDuration });
        toast({ tone: 'success', title: 'Voice note saved' });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } finally {
      setRecording(null);
      setRecordingDuration(0);
    }
  };

  const playNote = async (note: AudioNote) => {
    try {
      if (playingId === note.id) {
        await playbackRef.current?.stopAsync();
        await playbackRef.current?.unloadAsync();
        playbackRef.current = null;
        setPlayingId(null);
        return;
      }
      if (playbackRef.current) {
        await playbackRef.current.unloadAsync();
        playbackRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri: note.uri });
      playbackRef.current = sound;
      setPlayingId(note.id);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingId(null);
        }
      });
      await sound.playAsync();
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
                  hitSlop={10}
                  disabled={transcribingId === note.id}
                >
                  {transcribingId === note.id ? (
                    <ActivityIndicator color={colors.orange} />
                  ) : (
                    <Ionicons name="sparkles-outline" size={18} color={colors.orange} />
                  )}
                </Pressable>
              )}
              <Pressable onPress={() => onRemove(note.id)} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
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
});
