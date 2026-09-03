// Tasks — "the little things" on a lead or a job (JobNimbus: "keep track of
// the little things; use them to trigger automations").
//
// A task belongs to ONE pipeline item, addressed by `itemId`: the lead id
// when the item has a lead, else the inspection id (docs/PIPELINE.md). A
// linked lead+job pair is one item, so read tasks for a pair with BOTH ids
// (`forItems([leadId, inspectionId])`) and add new ones to the lead id.
//
// Drift #5: nothing is seeded. Automations add tasks only in response to
// real events (a signed proposal, a storm match); the roofer adds the rest.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Task, TaskCreatedBy } from '../models/types';

let counter = 0;
const newId = () => `task_${Date.now()}_${counter++}`;

const DAY_MS = 24 * 60 * 60 * 1000;

export type AddTaskInput = {
  itemId: string;
  title: string;
  dueAt?: string;
  createdBy?: TaskCreatedBy;
};

type TaskState = {
  tasks: Task[];
  /**
   * Add a task. Idempotent on (itemId, title) while such a task is still
   * OPEN — a rule that fires twice, or a roofer re-tapping "add", must not
   * stack duplicates. Returns the existing open task in that case.
   */
  add: (input: AddTaskInput) => Task;
  /** Flip done / open; stamps `doneAt`. */
  toggle: (id: string) => void;
  setDone: (id: string, done: boolean) => void;
  update: (id: string, patch: Partial<Pick<Task, 'title' | 'dueAt'>>) => void;
  remove: (id: string) => void;
  /** New manual order for one item: ids first-to-last; ids not listed keep their relative order after. */
  reorder: (itemId: string, orderedIds: string[]) => void;
  /** Every task on the item(s), open first by `order`, done last by `doneAt`. */
  forItems: (itemIds: readonly (string | undefined)[]) => Task[];
  forItem: (itemId: string) => Task[];
  /** Open tasks due by the end of today (overdue included), soonest first. */
  dueToday: (now?: Date) => Task[];
  /** `{ done, total }` across the item(s) — the "4/20" on a pipeline card. */
  counts: (itemIds: readonly (string | undefined)[]) => { done: number; total: number };
};

function sortTasks(list: Task[]): Task[] {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.done) return a.order - b.order || a.createdAt.localeCompare(b.createdAt);
    return (b.doneAt ?? '').localeCompare(a.doneAt ?? '');
  });
}

/** Pure: open tasks due by the end of the local day containing `now`. */
export function tasksDueBy(tasks: readonly Task[], now: Date = new Date()): Task[] {
  const endOfDay =
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + DAY_MS - 1;
  return tasks
    .filter((t) => !t.done && t.dueAt && new Date(t.dueAt).getTime() <= endOfDay)
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
}

/** Pure: `{ done, total }` for the given item ids. */
export function taskCounts(
  tasks: readonly Task[],
  itemIds: readonly (string | undefined)[],
): { done: number; total: number } {
  const ids = new Set(itemIds.filter((x): x is string => !!x));
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    if (!ids.has(t.itemId)) continue;
    total += 1;
    if (t.done) done += 1;
  }
  return { done, total };
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: [],

      add: (input) => {
        const title = input.title.trim();
        const existing = get().tasks.find(
          (t) => t.itemId === input.itemId && !t.done && t.title.toLowerCase() === title.toLowerCase(),
        );
        if (existing) return existing;
        const siblings = get().tasks.filter((t) => t.itemId === input.itemId);
        const task: Task = {
          id: newId(),
          itemId: input.itemId,
          title,
          dueAt: input.dueAt,
          done: false,
          createdBy: input.createdBy ?? 'roofer',
          order: siblings.reduce((max, t) => Math.max(max, t.order), -1) + 1,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ tasks: [...s.tasks, task] }));
        return task;
      },

      toggle: (id) => {
        const t = get().tasks.find((x) => x.id === id);
        if (t) get().setDone(id, !t.done);
      },

      setDone: (id, done) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, done, doneAt: done ? new Date().toISOString() : undefined } : t,
          ),
        })),

      update: (id, patch) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

      remove: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      reorder: (itemId, orderedIds) =>
        set((s) => {
          const rank = new Map(orderedIds.map((id, i) => [id, i]));
          const rest = s.tasks
            .filter((t) => t.itemId === itemId && !rank.has(t.id))
            .sort((a, b) => a.order - b.order);
          rest.forEach((t, i) => rank.set(t.id, orderedIds.length + i));
          return {
            tasks: s.tasks.map((t) =>
              t.itemId === itemId && rank.has(t.id) ? { ...t, order: rank.get(t.id)! } : t,
            ),
          };
        }),

      forItems: (itemIds) => {
        const ids = new Set(itemIds.filter((x): x is string => !!x));
        return sortTasks(get().tasks.filter((t) => ids.has(t.itemId)));
      },

      forItem: (itemId) => get().forItems([itemId]),

      dueToday: (now) => tasksDueBy(get().tasks, now),

      counts: (itemIds) => taskCounts(get().tasks, itemIds),
    }),
    {
      name: 'roofwise.tasks.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ tasks: s.tasks }),
    },
  ),
);
