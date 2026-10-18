/**
 * Pure helpers behind the Project Reports. Kept out of the page so the
 * grouping rules of the QA queue (which tasks count, how testers are grouped
 * and ordered) are unit-tested (tests/reports.test.ts).
 */

/** The status name the QA queue looks for (case/space-insensitive). */
export const QA_STATUS_NAME = "In Testing";

export function isInTesting(statusName: string | null | undefined): boolean {
  // Case- and whitespace-insensitive: admins sometimes rename the status with
  // different casing/spacing, and the queue must keep matching it.
  return (statusName ?? "").trim().replace(/\s+/g, " ").toLowerCase() === QA_STATUS_NAME.toLowerCase();
}

export interface QaTask {
  id: string;
  key: string;
  title: string;
  testedById: string | null;
  testedBy: { name: string } | null;
  status: { name: string };
}

export interface QaGroup {
  /** null = tasks in testing without a tester. */
  testerId: string | null;
  tester: string;
  count: number;
  tasks: QaTask[];
}

/**
 * QA queue: every task whose CURRENT status is "In Testing", grouped by its
 * assigned tester (unassigned ones land in a final "(no tester)" group).
 * Groups are ordered by queue size, then by name, so the biggest backlog is on
 * top; tasks keep their incoming (status/position) order inside a group.
 */
export function qaQueueByTester(tasks: readonly QaTask[]): QaGroup[] {
  const map = new Map<string, QaGroup>();
  for (const t of tasks) {
    if (!isInTesting(t.status?.name)) continue;
    const testerId = t.testedById ?? null;
    const tester = t.testedBy?.name ?? "(no tester)";
    // Keyed by id so two testers who share a name stay separate groups.
    const key = testerId ?? tester;
    const g = map.get(key) ?? { testerId, tester, count: 0, tasks: [] };
    g.count += 1;
    g.tasks.push(t);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tester.localeCompare(b.tester));
}

/** Total number of tasks waiting in the QA queue. */
export function qaQueueSize(groups: readonly QaGroup[]): number {
  return groups.reduce((n, g) => n + g.count, 0);
}
