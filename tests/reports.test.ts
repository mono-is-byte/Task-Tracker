import { describe, expect, it } from "vitest";
import { isInTesting, qaQueueByTester, qaQueueSize, QA_STATUS_NAME } from "../src/lib/reports";

interface Input {
  id: string;
  key: string;
  title: string;
  testedById: string | null;
  testedBy: { name: string } | null;
  status: { name: string };
}

const task = (id: string, status: string, tester?: { id: string; name: string } | null): Input => ({
  id,
  key: `P-${id}`,
  title: `Task ${id}`,
  testedById: tester?.id ?? null,
  testedBy: tester ? { name: tester.name } : null,
  status: { name: status },
});

describe("QA queue grouping", () => {
  it("only counts tasks whose current status is In Testing", () => {
    const groups = qaQueueByTester([
      task("1", QA_STATUS_NAME, { id: "u1", name: "Ada" }),
      task("2", "Done", { id: "u1", name: "Ada" }),
      task("3", "in testing", { id: "u2", name: "Bob" }),
      task("4", "In  Testing", { id: "u2", name: "Bob" }),
    ]);
    expect(qaQueueSize(groups)).toBe(3);
    expect(groups.map((g) => g.tester).sort()).toEqual(["Ada", "Bob"]);
    expect(groups.find((g) => g.tester === "Bob")?.count).toBe(2);
  });

  it("groups per tester, orders by queue size and keeps task details", () => {
    const groups = qaQueueByTester([
      task("1", "In Testing", { id: "a", name: "Ada" }),
      task("2", "In Testing", { id: "b", name: "Bob" }),
      task("3", "In Testing", { id: "b", name: "Bob" }),
    ]);
    expect(groups.map((g) => [g.tester, g.count])).toEqual([["Bob", 2], ["Ada", 1]]);
    expect(groups[0].testerId).toBe("b");
    expect(groups[0].tasks.map((t) => t.key)).toEqual(["P-2", "P-3"]);
    expect(groups[0].tasks[0].title).toBe("Task 2");
  });

  it("puts untested tasks in their own group, not silently in a tester's queue", () => {
    const groups = qaQueueByTester([task("1", "In Testing")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ tester: "(no tester)", testerId: null, count: 1 });
  });

  it("returns nothing when the queue is empty or statuses are missing", () => {
    expect(qaQueueByTester([])).toEqual([]);
    expect(qaQueueByTester([{ ...task("1", ""), status: { name: "" } }])).toEqual([]);
    expect(qaQueueSize([])).toBe(0);
  });

  it("matches the status name case- and space-insensitively", () => {
    expect(isInTesting("In Testing")).toBe(true);
    expect(isInTesting(" in testing ")).toBe(true);
    expect(isInTesting("Testing")).toBe(false);
    expect(isInTesting(null)).toBe(false);
  });
});
