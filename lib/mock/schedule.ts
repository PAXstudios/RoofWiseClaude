export type ScheduleItem = {
  id: string;
  time: string;
  meridiem: 'AM' | 'PM';
  title: string;
  address: string;
  contactName: string;
  contactInitials?: string;
  priority?: 'High Priority' | 'Routine' | 'Follow-up';
  active?: boolean;
};

export const schedule: ScheduleItem[] = [
  {
    id: 's1',
    time: '09:00',
    meridiem: 'AM',
    title: 'Roof Inspection',
    address: '123 Oak Street, Springfield',
    contactName: 'Sarah Jenkins',
    priority: 'High Priority',
    active: true,
  },
  {
    id: 's2',
    time: '11:30',
    meridiem: 'AM',
    title: 'Drone Imagery',
    address: '212 Chestnut Pl, Springfield',
    contactName: 'Field Crew B',
    contactInitials: 'FB',
    priority: 'Routine',
  },
  {
    id: 's3',
    time: '01:00',
    meridiem: 'PM',
    title: 'Estimate Review',
    address: '445 Pine Lane, Springfield',
    contactName: 'Mike Johnson',
    contactInitials: 'MJ',
    priority: 'Follow-up',
  },
  {
    id: 's4',
    time: '03:30',
    meridiem: 'PM',
    title: 'Insurance Adjuster Walk',
    address: '901 Birch Drive, Springfield',
    contactName: 'David Park',
    contactInitials: 'DP',
    priority: 'High Priority',
  },
];
