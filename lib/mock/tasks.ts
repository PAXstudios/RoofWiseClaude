export type Task = {
  id: string;
  title: string;
  due: string;
  done: boolean;
  context?: string;
};

export const tasks: Task[] = [
  { id: 't1', title: 'Send insurance scope to Park Townhomes', due: 'Today', done: false, context: '901 Birch Dr' },
  { id: 't2', title: 'Upload drone imagery — Smith Residence', due: 'Today', done: true, context: '212 Chestnut Pl' },
  { id: 't3', title: 'Confirm Tuesday inspection — Reyes', due: 'Tomorrow', done: false, context: '88 Elm Ct' },
  { id: 't4', title: 'Review AI hail labels (3 pending)', due: 'Today', done: false, context: 'Training queue' },
];
