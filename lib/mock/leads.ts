export type Lead = {
  id: string;
  name: string;
  address: string;
  stage: 'New' | 'Contacted' | 'Proposal' | 'Won' | 'Lost';
  value: number;
  lat: number;
  lon: number;
  storm?: 'hail' | 'wind';
  contactedDaysAgo?: number;
};

export const leads: Lead[] = [
  { id: 'l1', name: 'Sarah Jenkins', address: '123 Oak Street, Springfield', stage: 'New', value: 8400, lat: 39.8014, lon: -89.6437, storm: 'hail' },
  { id: 'l2', name: 'Mike Johnson', address: '445 Pine Lane, Springfield', stage: 'Contacted', value: 12200, lat: 39.7995, lon: -89.6502, contactedDaysAgo: 2 },
  { id: 'l3', name: 'Carla Reyes', address: '88 Elm Court, Springfield', stage: 'Contacted', value: 6700, lat: 39.81, lon: -89.65, storm: 'wind' },
  { id: 'l4', name: 'David Park', address: '901 Birch Drive, Springfield', stage: 'Proposal', value: 22500, lat: 39.788, lon: -89.66, storm: 'hail' },
  { id: 'l5', name: 'Linda Chen', address: '64 Cedar Avenue, Springfield', stage: 'Proposal', value: 19800, lat: 39.82, lon: -89.62 },
  { id: 'l6', name: 'Westside Library', address: '12 Library Way, Springfield', stage: 'Won', value: 48000, lat: 39.795, lon: -89.67 },
  { id: 'l7', name: 'Smith Residence', address: '212 Chestnut Pl, Springfield', stage: 'Won', value: 14250, lat: 39.806, lon: -89.643 },
  { id: 'l8', name: 'Hank Doyle', address: '5 Maple Park, Springfield', stage: 'Lost', value: 9800, lat: 39.793, lon: -89.638 },
];

export const leadKpis = {
  active: 12,
  newToday: 2,
  inspectionsToday: 3,
  jobsInProgress: 5,
  revenueWonThisMonth: 42500,
  revenueDelta: 0.15,
  stormImpactedProperties: 4,
};

export const pipelineStages: { stage: Lead['stage']; tone: 'brand' | 'accent' | 'success' | 'danger' | 'info' | 'neutral' }[] = [
  { stage: 'New', tone: 'brand' },
  { stage: 'Contacted', tone: 'accent' },
  { stage: 'Proposal', tone: 'success' },
  { stage: 'Won', tone: 'success' },
  { stage: 'Lost', tone: 'danger' },
];
