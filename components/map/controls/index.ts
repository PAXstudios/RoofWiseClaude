// The shared map control system — one grammar for every map screen:
//
//   ControlRail  top-right stack of round glass buttons, tucks to a chevron
//   RailButton   the 56pt unit (glass idle, royal ramp active, badge, hold)
//   SummaryChip  top-left echo of the active layers/filters; opens the sheet
//   LayersSheet  every layer, filter and toggle, in sections (BottomSheet)
//   MapDrawer    bottom panel with peek / half / full detents + sticky CTA
//   LegendStrip  the slim key the rail's legend button toggles
//
// Per-screen memory (tucked, detent, satellite) lives in
// lib/stores/mapChromeStore.ts.

export { ControlRail, useMapPanTuck, type RailItem } from './ControlRail';
export { RailButton, RAIL_BUTTON_SIZE, type RailButtonProps } from './RailButton';
export { SummaryChip } from './SummaryChip';
export { LayersSheet, type LayersOption, type LayersRow, type LayersSection } from './LayersSheet';
export { MapDrawer, type DrawerDetent } from './MapDrawer';
export { LegendStrip, type LegendItem } from './LegendStrip';
