// Responsive breakpoint hook — single source of truth for "which shell am I
// in?" decisions. Breakpoints live in theme/tokens.ts (`breakpoints`), never
// inline. Phone keeps the native glove-first shell (BottomTabs); desktop web
// (>= breakpoints.lg) swaps in the Sidebar + TopBar shell.

import { useWindowDimensions } from 'react-native';
import { breakpoints } from './tokens';

export type Responsive = {
  width: number;
  /** < breakpoints.md (768) — phones, the primary glove-first target. */
  isPhone: boolean;
  /** breakpoints.md..breakpoints.lg (768–1099) — tablets / narrow windows. */
  isTablet: boolean;
  /** >= breakpoints.lg (1100) — desktop web, gets the Sidebar shell. */
  isDesktop: boolean;
};

export function useResponsive(): Responsive {
  const { width } = useWindowDimensions();
  return {
    width,
    isPhone: width < breakpoints.md,
    isTablet: width >= breakpoints.md && width < breakpoints.lg,
    isDesktop: width >= breakpoints.lg,
  };
}
