import { describe, expect, it } from "vitest";
import { ctx, ensure, openPdf, buildReportPdf, buildCalendarPdf, hexToRgb } from "../src/lib/pdf";
import { dayKey, monthGrid } from "../src/lib/calendar";

describe("pdf drawing context", () => {
  it("openPdf produces a valid PDF document", async () => {
    const doc = await openPdf("portrait");
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(500);
  });

  it("ensure() inserts page breaks when content overflows", async () => {
    const doc = await openPdf("portrait");
    const c = ctx(doc, 14);
    for (let i = 0; i < 120; i++) {
      ensure(c, 10); // 120 × 10mm ≫ one A4 page
      doc.setFontSize(9);
      doc.text(`line ${i}`, c.margin, c.y);
      c.y += 10;
    }
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it("hexToRgb handles short, full and invalid hex", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
    expect(hexToRgb("4f46e5")).toEqual([79, 70, 229]);
    expect(hexToRgb("nope")).toEqual([100, 100, 100]);
  });
});

describe("buildReportPdf", () => {
  const base = {
    project: { key: "PRJ", name: "Test Project" },
    generatedAt: new Date("2026-10-15T10:00:00Z"),
    summary: { total: 3, open: 2, done: 1, overdue: 0, est: 12, logged: 9, rd: 1.5 },
    statusDist: [{ name: "To Do", count: 2, color: "#888888" }, { name: "Done", count: 1, color: "#22c55e" }],
    perAssignee: [{ name: "Alice", n: 2, pts: 5, hrs: 8 }],
    perTester: [{ name: "Bob", n: 1 }],
    overdue: [] as { key: string; title: string; endDate: string | null }[],
  };

  it("generates a valid report with page breaks for long tables", async () => {
    const doc = await buildReportPdf({
      ...base,
      overdue: Array.from({ length: 120 }, (_, i) => ({ key: `PRJ-${i}`, title: `Overdue task ${i}`, endDate: "2026-01-02" })),
    });
    // 120 overdue rows cannot fit one page → pagination kicked in
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(String(doc.output()).slice(0, 5)).toBe("%PDF-");
  });

  it("handles empty sections without crashing", async () => {
    const doc = await buildReportPdf({
      ...base,
      summary: { total: 0, open: 0, done: 0, overdue: 0, est: 0, logged: 0, rd: 0 },
      statusDist: [], perAssignee: [], perTester: [], overdue: [],
    });
    expect(doc.getNumberOfPages()).toBe(1);
    expect(String(doc.output()).slice(0, 5)).toBe("%PDF-");
  });
});

describe("buildCalendarPdf", () => {
  it("renders a full month grid with tasks and holidays on one landscape page", async () => {
    const cells = monthGrid(new Date(2026, 9, 15)).map((d) => ({ dayKey: dayKey(d), inMonth: d.getMonth() === 9 }));
    expect(cells).toHaveLength(42);
    const doc = await buildCalendarPdf({
      title: "October 2026",
      subtitle: "All projects · Anyone",
      generatedAt: new Date("2026-10-15T10:00:00Z"),
      cells,
      holidays: [{ date: "2026-10-05", name: "Holiday" }],
      tasks: [
        { key: "PRJ-1", title: "A very long task title ".repeat(12), startDate: "2026-10-01", endDate: "2026-10-05", statusColor: "#4f46e5" },
        { key: "PRJ-2", title: "Single-day task", startDate: null, endDate: "2026-10-20", statusColor: "#22c55e" },
      ],
    });
    expect(doc.getNumberOfPages()).toBe(1);
    expect(String(doc.output()).slice(0, 5)).toBe("%PDF-");
  });
});
