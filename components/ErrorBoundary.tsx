import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { recordError, toText } from '@/lib/services/diagnostics';
import { useToastStore } from '@/lib/stores/toastStore';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type Props = { children: ReactNode };
type State = { error: Error | null; info: ErrorInfo | null };

/**
 * App-level crash net. Without this a render error unmounts the whole tree
 * and the roofer is left staring at a white screen mid-inspection with no
 * way back — the worst possible failure on a roof. Catches, explains, and
 * offers a one-tap recovery that remounts the tree with state intact
 * (Zustand stores live outside React, so captured photos survive).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack for the details panel. In production this is
    // also the hook point for a crash reporter (Sentry et al).
    this.setState({ info });
    console.error('[RoofWise] Unhandled render error:', error, info.componentStack);
    // Belt-and-suspenders: console.error above is already wrapped by
    // `diagnostics.install()`, but recording explicitly here means this
    // entry survives even if diagnostics wasn't installed yet (or its wrap
    // failed for some reason), and it lets the component stack ride along
    // as extra context on the same entry.
    recordError(error, { kind: 'js_error', extraStack: `Component stack:\n${info.componentStack ?? ''}` });
  }

  private reset = () => this.setState({ error: null, info: null });

  private openDiagnostics = () => router.push('/settings/diagnostics');

  private copyDetails = async () => {
    try {
      await Clipboard.setStringAsync(toText());
      useToastStore.getState().show({ tone: 'success', title: 'Details copied' });
    } catch {
      useToastStore.getState().show({ tone: 'danger', title: 'Could not copy details' });
    }
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons name="warning" size={34} color={colors.warn} />
          </View>

          <Text style={styles.title}>Something broke on this screen</Text>
          <Text style={styles.body}>
            Your inspections, photos, and leads are safe — nothing was lost.
            Tap Try again to get back to work.
          </Text>

          <Pressable style={styles.primaryBtn} onPress={this.reset}>
            <Ionicons name="refresh" size={20} color={colors.textInverse} />
            <Text style={styles.primaryBtnText}>Try again</Text>
          </Pressable>

          <View style={styles.secondaryRow}>
            <Pressable style={styles.secondaryBtn} onPress={this.copyDetails}>
              <Ionicons name="copy-outline" size={18} color={colors.navy} />
              <Text style={styles.secondaryBtnText}>Copy details</Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={this.openDiagnostics}>
              <Ionicons name="bug-outline" size={18} color={colors.navy} />
              <Text style={styles.secondaryBtnText}>Open Diagnostics</Text>
            </Pressable>
          </View>

          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>What happened</Text>
            <Text style={styles.detailText} selectable>
              {error.name}: {error.message || String(error)}
            </Text>
            <ScrollView style={styles.stackScroll} nestedScrollEnabled>
              <Text style={styles.stack} selectable>
                {(error.stack ?? '').trim()}
                {info?.componentStack ? `\n\nComponent stack:${info.componentStack.trimEnd()}` : ''}
              </Text>
            </ScrollView>
            <Text style={styles.detailHint}>
              Copy details and send it to support — it&apos;s what we need to fix it.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  iconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.warnSoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: {
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  body: {
    fontSize: fontSize.bodyLg,
    color: colors.slate,
    textAlign: 'center',
    lineHeight: 24,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    marginTop: spacing.sm,
  },
  primaryBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
  },
  secondaryBtnText: {
    color: colors.navy,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
  },
  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: colors.warn,
  },
  detailLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.slate,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailText: { fontSize: fontSize.bodyMd, color: colors.navy },
  // Scrollable so a long native+component stack never gets clipped —
  // the whole point of this screen is that the roofer can read (and copy)
  // the actual failure, not a truncated hint of it.
  stackScroll: { maxHeight: 220 },
  stack: {
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    lineHeight: 18,
  },
  detailHint: {
    fontSize: fontSize.bodySm,
    color: colors.slate,
    marginTop: spacing.xs,
  },
});
