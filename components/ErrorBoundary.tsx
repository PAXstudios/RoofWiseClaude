import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  }

  private reset = () => this.setState({ error: null, info: null });

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

          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>What happened</Text>
            <Text style={styles.detailText} selectable>
              {error.message || String(error)}
            </Text>
            {info?.componentStack ? (
              <Text style={styles.stack} selectable numberOfLines={12}>
                {info.componentStack.trim()}
              </Text>
            ) : null}
            <Text style={styles.detailHint}>
              Screenshot this and send it to support — it&apos;s what we need to fix it.
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
  stack: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    lineHeight: 15,
  },
  detailHint: {
    fontSize: fontSize.bodySm,
    color: colors.slate,
    marginTop: spacing.xs,
  },
});
