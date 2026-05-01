import type { StormEvent, StormType } from '@/lib/noaa';

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
  minWind: number; // knots
};
