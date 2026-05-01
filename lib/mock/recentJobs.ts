export type JobStatus = 'Done' | 'Active' | 'Scheduled' | 'Needs Review';

export type RecentJob = {
  id: string;
  property: string;
  address: string;
  status: JobStatus;
  subtitle: string;
  photoUrl: string;
};

// Royalty-free residential roof photos hosted on Unsplash. We pin specific
// asset IDs and a width param so the gallery is deterministic across builds.
const u = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=900&q=80&auto=format&fit=crop`;

export const recentJobs: RecentJob[] = [
  {
    id: 'rj1',
    property: 'Westside Library',
    address: '12 Library Way, Springfield',
    status: 'Done',
    subtitle: 'Completed Yesterday',
    photoUrl: u('1568605114967-8130f3a36994'),
  },
  {
    id: 'rj2',
    property: 'Smith Residence',
    address: '212 Chestnut Pl, Springfield',
    status: 'Active',
    subtitle: 'In Progress',
    photoUrl: u('1572120360610-d971b9d7767c'),
  },
  {
    id: 'rj3',
    property: 'Park Townhomes',
    address: '901 Birch Drive, Springfield',
    status: 'Needs Review',
    subtitle: 'AI flagged 3 hail strikes',
    photoUrl: u('1564013799919-ab600027ffc6'),
  },
  {
    id: 'rj4',
    property: 'Reyes Property',
    address: '88 Elm Court, Springfield',
    status: 'Scheduled',
    subtitle: 'Inspection Tue 9am',
    photoUrl: u('1570129477492-45c003edd2be'),
  },
  {
    id: 'rj5',
    property: 'Doyle Cottage',
    address: '5 Maple Park, Springfield',
    status: 'Done',
    subtitle: 'Completed 3 days ago',
    photoUrl: u('1605276374104-dee2a0ed3cd6'),
  },
  {
    id: 'rj6',
    property: 'Chen Estate',
    address: '64 Cedar Avenue, Springfield',
    status: 'Active',
    subtitle: 'Tear-off underway',
    photoUrl: u('1583608205776-bfd35f0d9f83'),
  },
];

export const statusTone: Record<JobStatus, 'success' | 'accent' | 'info' | 'warn'> = {
  Done: 'success',
  Active: 'accent',
  Scheduled: 'info',
  'Needs Review': 'warn',
};
