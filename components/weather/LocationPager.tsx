/**
 * LocationPager — horizontal, full-width pages, one per weather location.
 *
 * Page 0 is always "Current location"; the rest are the roofer's saved
 * addresses in their chosen order. The pager owns the swipe and the page
 * index; the screen owns what a page contains (`renderPage`) and mounts the
 * data fetch only once a page has actually been shown, so five saved
 * addresses do not mean five forecast calls on open.
 *
 * `PagerDots` is the matching indicator for the dark header — one dot per
 * page, the active one wide. Both honour Reduce Motion: programmatic page
 * changes jump instead of gliding.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { colors, glass, radii, spacing } from '@/theme/tokens';

export type PagerPage = {
  id: string;
  /** Short name shown in the header ("Current location", "Plano, TX"). */
  title: string;
  /** Full address under the title, when there is one. */
  subtitle?: string;
  kind: 'device' | 'saved';
};

type Props<P extends PagerPage> = {
  pages: readonly P[];
  index: number;
  onIndexChange: (index: number) => void;
  /** Page width — the window width in practice. */
  width: number;
  renderPage: (page: P, index: number, active: boolean) => ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function LocationPager<P extends PagerPage>({
  pages,
  index,
  onIndexChange,
  width,
  renderPage,
  style,
}: Props<P>) {
  const listRef = useRef<FlatList<P>>(null);
  const reduced = useReducedMotion();
  // The offset the list is actually sitting at, so a programmatic scroll to
  // the page we're already on is a no-op rather than a visible stutter.
  const settledIndex = useRef(index);

  useEffect(() => {
    if (settledIndex.current === index) return;
    settledIndex.current = index;
    listRef.current?.scrollToOffset({ offset: index * width, animated: !reduced });
  }, [index, width, reduced]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
      const clamped = Math.max(0, Math.min(pages.length - 1, next));
      settledIndex.current = clamped;
      if (clamped !== index) onIndexChange(clamped);
    },
    [index, onIndexChange, pages.length, width],
  );

  return (
    <FlatList
      ref={listRef}
      style={[styles.list, style]}
      data={pages}
      keyExtractor={(p) => p.id}
      horizontal
      pagingEnabled
      bounces={false}
      showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={onMomentumEnd}
      // Web has no momentum event for a snap; the drag-end offset is final.
      onScrollEndDrag={onMomentumEnd}
      getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      initialScrollIndex={index}
      // Keep neighbours mounted so a swipe reveals a page, not a blank.
      windowSize={3}
      initialNumToRender={2}
      removeClippedSubviews={false}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item, index: i }) => (
        <View style={{ width }}>{renderPage(item, i, i === index)}</View>
      )}
    />
  );
}

/** Page indicator for the dark hero header. */
export function PagerDots({ count, index, style }: { count: number; index: number; style?: StyleProp<ViewStyle> }) {
  if (count <= 1) return null;
  return (
    <View
      style={[styles.dots, style]}
      accessibilityRole="text"
      accessibilityLabel={`Location ${index + 1} of ${count}`}
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    minHeight: spacing.lg,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: glass.borderStrong,
  },
  dotActive: { width: 18, backgroundColor: colors.textInverse },
});
