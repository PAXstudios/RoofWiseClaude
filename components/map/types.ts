import type { StormEvent, StormType } from '@/lib/noaa';
import type { StormClusterCell, StormOverlaySelection } from '@/lib/services/stormCluster';

export type StormMapProps = {
  events: StormEvent[];
  loading?: boolean;
  center: { lat: number; lon: number };
  zoom: number;
  /** Called when user pans/zooms — useful if we ever recrop. */
  onRegionChange?: (region: { lat: number; lon: number; zoom: number }) => void;
};

export type StormFilters = {
  state: string;
  years: 1 | 2 | 4;
  types: StormType[];
  minHail: number; // inches
  minWind: number; // mph (IEM reports gusts in MPH — see lib/noaa.ts)
};

/**
 * Props for `components/map/StormOverlay.tsx`. The selection is computed by
 * `useStormOverlaySelection` (pure `lib/services/stormCluster.ts` under the
 * hood) in the host screen so the same numbers drive both the overlay and
 * the honest "showing N of M" line.
 */
export type StormOverlayProps = {
  selection: StormOverlaySelection;
  /** Tap on an individual storm pin (mid / near zoom). */
  onSelectEvent?: (event: StormEvent) => void;
  /** Tap on a cluster glyph (far zoom) — hosts usually zoom into it. */
  onSelectCluster?: (cell: StormClusterCell) => void;
  /**
   * Event ids currently selected (the map's Select mode). A marker whose id
   * is in this set renders visibly distinct (ring + checkmark) instead of
   * its plain pin; a cluster whose every member id is in this set renders
   * the same way. Omitted/empty outside select mode.
   */
  selected?: ReadonlySet<string>;
};

export type {
  RegionLike,
  StormClusterCell,
  StormOverlaySelection,
  StormTone,
  ZoomBand,
} from '@/lib/services/stormCluster';
