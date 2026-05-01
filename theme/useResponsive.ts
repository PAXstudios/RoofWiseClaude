import { useWindowDimensions } from 'react-native';
import { breakpoints } from './tokens';

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isMobile: width < breakpoints.md,
    isTablet: width >= breakpoints.md && width < breakpoints.lg,
    isDesktop: width >= breakpoints.lg,
    isWide: width >= breakpoints.md,
  };
}
