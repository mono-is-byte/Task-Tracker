import type { jsPDF } from "jspdf";
import type { DashboardSummary } from "./dashboard";
import { occursOn } from "./calendar";

/**
 * Phase 5: client-side PDF exports (single PDF library: jspdf, dynamically
 * imported so it stays out of the main bundle). A small drawing context
 * tracks the cursor and inserts page breaks automatically ("correct page
 * breaks" = every block checks `ensure()` before drawing).
 */

export interface PdfCtx {
  doc: jsPDF;
  y: number;
  margin: number;
}

export async function openPdf(orientation: "portrait" | "landscape" = "portrait"): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  return new jsPDF({ orientation, unit: "mm", format: "a4" });
}

export function ctx(doc: jsPDF, margin = 14): PdfCtx {
  return { doc, y: margin, margin };
}

export function pageWidth(c: PdfCtx): number {
  return c.doc.internal.pageSize.getWidth() - c.margin * 2;
}

function bottom(c: PdfCtx): number {
  return c.doc.internal.pageSize.getHeight() - c.margin;
}

/** Add a page when the next `height` mm would overflow the current one. */
export function ensure(c: PdfCtx, height: number): void {
  if (c.y + height > bottom(c)) {
    c.doc.addPage();
    c.y = c.margin;
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const n = parseInt(v.slice(0, 6), 16);
  if (Number.isNaN(n)) return [100, 100, 100];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function setTextColor(c: PdfCtx, hex?: string): void {
  if (hex) c.doc.setTextColor(...hexToRgb(hex));
  else c.doc.setTextColor(40, 40, 40);
}

/** One text line with automatic page break. Returns the y after drawing. */
export function text(
  c: PdfCtx,
  str: string,
  opts: { size?: number; bold?: boolean; color?: string; gap?: number; x?: number; width?: number } = {},
): void {
  const size = opts.size ?? 9;
  ensure(c, size * 0.5 + 2);
  c.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
  c.doc.setFontSize(size);
  setTextColor(c, opts.color);
  const lines = opts.width ? c.doc.splitTextToSize(str, opts.width) : [str];
  const x = opts.x ?? c.margin;
  for (const line of lines) {
    ensure(c, size * 0.5 + 2);
    c.doc.text(line, x, c.y + size * 0.35);
    c.y += size * 0.55 + 1.2;
  }
  if (opts.gap !== undefined) c.y += opts.gap;
}

/** Section header with a rule under it. */
export function section(c: PdfCtx, title: string): void {
  ensure(c, 12);
  c.y += 3;
  text(c, title, { size: 11, bold: true });
  c.doc.setDrawColor(180, 180, 180);
  c.doc.line(c.margin, c.y - 1.5, c.margin + pageWidth(c), c.y - 1.5);
  c.y += 1;
}

/** Horizontal bar row: label | colored bar | value. */
export function barRow(
  c: PdfCtx,
  label: string,
  value: number,
  max: number,
  color: string,
  suffix = "",
): void {
  ensure(c, 5.5);
  const w = pageWidth(c);
  const labelW = 50;
  const valueW = 28;
  const barW = w - labelW - valueW;
  const y0 = c.y;

  c.doc.setFont("helvetica", "normal");
  c.doc.setFontSize(8);
  setTextColor(c);
  const labelLines = c.doc.splitTextToSize(label, labelW - 2);
  c.doc.text(labelLines[0] + (labelLines.length > 1 ? "…" : ""), c.margin, y0 + 2.8);

  c.doc.setFillColor(226, 232, 240);
  c.doc.rect(c.margin + labelW, y0 + 0.6, barW, 3.4, "F");
  c.doc.setFillColor(...hexToRgb(color));
  c.doc.rect(c.margin + labelW, y0 + 0.6, barW * (max > 0 ? Math.min(1, value / max) : 0), 3.4, "F");

  setTextColor(c);
  c.doc.text(`${value}${suffix}`, c.margin + w, y0 + 2.8, { align: "right" });
  c.y += 5.5;
}

/** Simple bordered table with its own page breaks (header repeats per page). */
export function table(
  c: PdfCtx,
  cols: { header: string; w: number; align?: "left" | "right" }[],
  rows: string[][],
): void {
  const rowH = 5.5;
  const drawHeader = () => {
    ensure(c, rowH + 1);
    let x = c.margin;
    c.doc.setFont("helvetica", "bold");
    c.doc.setFontSize(8);
    setTextColor(c);
    c.doc.setFillColor(241, 245, 249);
    c.doc.rect(c.margin, c.y, pageWidth(c), rowH, "F");
    for (const col of cols) {
      c.doc.text(col.header, col.align === "right" ? x + col.w - 2 : x + 2, c.y + 3.7);
      x += col.w;
    }
    c.y += rowH;
  };
  drawHeader();
  c.doc.setFont("helvetica", "normal");
  c.doc.setFontSize(7.5);
  setTextColor(c);
  for (const row of rows) {
    if (c.y + rowH > bottom(c)) {
      c.doc.addPage();
      c.y = c.margin;
      c.doc.setFont("helvetica", "normal");
      c.doc.setFontSize(7.5);
      drawHeader();
      c.doc.setFont("helvetica", "normal");
      c.doc.setFontSize(7.5);
    }
    let x = c.margin;
    cols.forEach((col, i) => {
      const raw = row[i] ?? "";
      const lines = c.doc.splitTextToSize(raw, col.w - 4);
      const cell = lines[0] + (lines.length > 1 ? "…" : "");
      c.doc.text(cell, col.align === "right" ? x + col.w - 2 : x + 2, c.y + 3.7);
      x += col.w;
    });
    c.y += rowH;
  }
  c.y += 1;
}

/** Footer on every page: label on the left, "Page i / n" on the right. */
export function footer(c: PdfCtx, label: string): void {
  const pages = c.doc.getNumberOfPages();
  const y = c.doc.internal.pageSize.getHeight() - c.margin / 2;
  for (let i = 1; i <= pages; i++) {
    c.doc.setPage(i);
    c.doc.setFont("helvetica", "normal");
    c.doc.setFontSize(7);
    setTextColor(c, "#94a3b8");
    c.doc.text(label, c.margin, y);
    c.doc.text(`Page ${i} / ${pages}`, c.doc.internal.pageSize.getWidth() - c.margin, y, { align: "right" });
  }
}

/* ── Reports PDF (project reports page) ───────────────────────────────── */

export interface ReportPdfInput {
  project: { key: string; name: string };
  generatedAt: Date;
  summary: { total: number; open: number; done: number; overdue: number; points: number; est: number; logged: number; rd: number };
  statusDist: { name: string; count: number; color: string }[];
  perAssignee: { name: string; n: number; pts: number; hrs: number }[];
  perTester: { name: string; n: number }[];
  overdue: { key: string; title: string; endDate: string | null }[];
}

export async function buildReportPdf(input: ReportPdfInput): Promise<jsPDF> {
  const doc = await openPdf("portrait");
  const c = ctx(doc, 16);

  // Header
  text(c, "TASKTRACKER", { size: 8, color: "#94a3b8", gap: 1 });
  text(c, `${input.project.key} — Project Reports`, { size: 16, bold: true, gap: 0.5 });
  text(c, input.project.name, { size: 10, color: "#64748b", gap: 0.5 });
  text(c, `Generated ${input.generatedAt.toLocaleString()}`, { size: 8, color: "#94a3b8" });

  section(c, "Summary");
  const half = pageWidth(c) / 2;
  const pairs: [string, string][] = [
    ["Total tasks", String(input.summary.total)],
    ["Open / Done", `${input.summary.open} / ${input.summary.done}`],
    ["Overdue", String(input.summary.overdue)],
    ["Story points", String(input.summary.points)],
    ["Estimated hours", `${input.summary.est}h`],
    ["Logged hours", `${input.summary.logged}h`],
    ["Unestimated R&D", `${input.summary.rd}h`],
  ];
  for (const [k, v] of pairs) {
    ensure(c, 5.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTextColor(c, "#64748b");
    doc.text(k, c.margin, c.y + 3.2);
    setTextColor(c);
    doc.setFont("helvetica", "bold");
    doc.text(v, c.margin + half, c.y + 3.2);
    c.y += 5.5;
  }

  const maxOf = (xs: number[]) => Math.max(1, ...xs);

  if (input.statusDist.length) {
    section(c, "Status distribution");
    const max = maxOf(input.statusDist.map((s) => s.count));
    for (const s of input.statusDist) barRow(c, s.name, s.count, max, s.color);
  }

  if (input.perAssignee.length) {
    section(c, "Open tasks per assignee");
    const max = maxOf(input.perAssignee.map((a) => a.n));
    for (const a of input.perAssignee) barRow(c, `${a.name} (${a.pts}p/${a.hrs}h)`, a.n, max, "#3b82f6");
  }

  if (input.perTester.length) {
    section(c, "QA queue — In Testing per tester");
    const max = maxOf(input.perTester.map((t) => t.n));
    for (const t of input.perTester) barRow(c, t.name, t.n, max, "#a855f7");
  }

  section(c, `Overdue tasks (${input.overdue.length})`);
  if (input.overdue.length === 0) {
    text(c, "Nothing overdue.", { size: 8, color: "#64748b" });
  } else {
    table(
      c,
      [{ header: "Key", w: 30 }, { header: "Title", w: pageWidth(c) - 30 - 26 }, { header: "Due", w: 26 }],
      input.overdue.map((t) => [t.key, t.title, t.endDate ? t.endDate.slice(0, 10) : "—"]),
    );
  }

  footer(c, `TaskTracker · ${input.project.key} · ${input.generatedAt.toLocaleDateString()}`);
  return doc;
}

/* ── Calendar PDF ─────────────────────────────────────────────────────── */

export interface CalendarPdfInput {
  title: string;
  subtitle: string;
  generatedAt: Date;
  /** 42 (month) or 7 (week) cells, Sunday first. */
  cells: { dayKey: string; inMonth: boolean }[];
  holidays: { date: string; name: string }[];
  tasks: { key: string; title: string; startDate: string | null; endDate: string | null; statusColor: string }[];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function buildCalendarPdf(input: CalendarPdfInput): Promise<jsPDF> {
  const doc = await openPdf("landscape");
  const c = ctx(doc, 10);

  text(c, `Calendar — ${input.title}`, { size: 14, bold: true, gap: 0.5 });
  text(c, input.subtitle, { size: 8, color: "#64748b", gap: 0.5 });
  text(c, `Generated ${input.generatedAt.toLocaleString()} · tasks shown from start → due`, { size: 7, color: "#94a3b8" });

  const w = pageWidth(c);
  const colW = w / 7;
  const rows = Math.ceil(input.cells.length / 7);
  const headerH = 6;

  // Day-of-week header
  ensure(c, headerH);
  doc.setFillColor(241, 245, 249);
  doc.rect(c.margin, c.y, w, headerH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setTextColor(c, "#64748b");
  DAY_NAMES.forEach((d, i) => doc.text(d, c.margin + i * colW + 2, c.y + 4));
  c.y += headerH;

  const gridH = bottom(c) - c.y;
  const cellH = gridH / rows;

  input.cells.forEach((cell, i) => {
    const cx = c.margin + (i % 7) * colW;
    const cy = c.y + Math.floor(i / 7) * cellH;

    // cell background + border
    doc.setFillColor(255, 255, 255);
    doc.rect(cx, cy, colW, cellH, "F");
    if (!cell.inMonth) {
      doc.setFillColor(248, 250, 252);
      doc.rect(cx, cy, colW, cellH, "F");
    }
    doc.setDrawColor(203, 213, 225);
    doc.rect(cx, cy, colW, cellH);

    // day number
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTextColor(c, cell.inMonth ? undefined : "#94a3b8");
    doc.text(cell.dayKey.slice(8), cx + 2, cy + 4);

    let ty = cy + 7;
    const maxLines = Math.max(0, Math.floor((cellH - 8) / 3.4));

    // holidays (amber)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    for (const h of input.holidays.filter((h) => h.date === cell.dayKey)) {
      if (ty > cy + cellH - 3) break;
      setTextColor(c, "#b45309");
      const lines = doc.splitTextToSize(`● ${h.name}`, colW - 4);
      doc.text(lines[0] + (lines.length > 1 ? "…" : ""), cx + 2, ty);
      ty += 3.4;
    }

    // tasks (status color square + KEY title)
    const dayTasks = input.tasks.filter((t) => occursOn(t.startDate, t.endDate, cell.dayKey));
    doc.setFontSize(6);
    dayTasks.slice(0, Math.max(0, maxLines - (ty > cy + 7 ? 1 : 0))).forEach((t) => {
      doc.setFillColor(...hexToRgb(t.statusColor));
      doc.rect(cx + 2, ty - 1.8, 2, 2, "F");
      setTextColor(c);
      const lines = doc.splitTextToSize(`${t.key} ${t.title}`, colW - 8);
      doc.text(lines[0] + (lines.length > 1 ? "…" : ""), cx + 5, ty);
      ty += 3.4;
    });
    if (dayTasks.length > Math.max(0, maxLines - (ty > cy + 7 ? 1 : 0))) {
      setTextColor(c, "#64748b");
      doc.text(`+${dayTasks.length - maxLines + 1} more`, cx + 5, ty);
    }
  });

  footer(c, `TaskTracker · Calendar · ${input.generatedAt.toLocaleDateString()}`);
  return doc;
}

/* ── Dashboard PDF ────────────────────────────────────────────────────── */

export interface DashboardPdfInput {
  /** "All projects" or "LVM · Letter View Management". */
  scopeLabel: string;
  generatedAt: Date;
  summary: DashboardSummary;
  assigned: { key: string; title: string; status: string; priority: string }[];
  qaQueue: { key: string; title: string; status: string; priority: string }[];
  overdue: { key: string; title: string; due: string }[];
  recent: { key: string; title: string; action: string; actor: string; when: string }[];
  projects: { key: string; name: string }[];
}

/**
 * Change request: "Download the entire dashboard as PDF" — built from the same
 * data the page renders (KPI numbers, section lists and chart datasets), so
 * everything below the fold is included by construction and every block flows
 * across as many A4 pages as it needs (the shared ctx handles page breaks).
 */
export async function buildDashboardPdf(input: DashboardPdfInput): Promise<jsPDF> {
  const doc = await openPdf("portrait");
  const c = ctx(doc, 16);

  text(c, "TASKTRACKER", { size: 8, color: "#94a3b8", gap: 1 });
  text(c, "Dashboard", { size: 16, bold: true, gap: 0.5 });
  text(c, input.scopeLabel, { size: 10, color: "#64748b", gap: 0.5 });
  text(c, `Generated ${input.generatedAt.toLocaleString()}`, { size: 8, color: "#94a3b8" });

  const s = input.summary;
  const half = pageWidth(c) / 2;
  const pairs = (items: [string, string][]) => {
    for (const [k, v] of items) {
      ensure(c, 5.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setTextColor(c, "#64748b");
      doc.text(k, c.margin, c.y + 3.2);
      setTextColor(c);
      doc.setFont("helvetica", "bold");
      doc.text(v, c.margin + half, c.y + 3.2);
      c.y += 5.5;
    }
  };

  section(c, "Key numbers");
  pairs([
    ["Total tasks", String(s.totals.all)],
    ["Completed", `${s.totals.done} (${s.completionPct}%)`],
    ["In progress", String(s.totals.inProgress)],
    ["Pending", String(s.totals.pending)],
    ["Overdue", String(s.totals.overdue)],
    ["Open tasks", String(s.totals.open)],
    ["My open tasks", String(s.myOpen)],
    ["My overdue tasks", String(s.myOverdue)],
    ["Projects in view", String(s.projectCount)],
  ]);

  section(c, "Completion & timers");
  pairs([
    ["Completion rate", `${s.completionPct}%`],
    ["Done of all", `${s.totals.done} of ${s.totals.all}`],
    ["Timers running", String(s.runningNow)],
    ["Timers overdue", String(s.timerOverdue)],
  ]);

  const maxOf = (xs: number[]) => Math.max(1, ...xs);

  if (s.byStatus.length) {
    section(c, "Tasks by status");
    const max = maxOf(s.byStatus.map((x) => x.count));
    for (const x of s.byStatus) barRow(c, x.name, x.count, max, x.color);
  }

  if (s.byPriority.length) {
    section(c, "Tasks by priority");
    const max = maxOf(s.byPriority.map((x) => x.count));
    for (const x of s.byPriority) barRow(c, x.name, x.count, max, x.color);
  }

  if (s.perMember.length) {
    section(c, "Open tasks per member");
    const max = maxOf(s.perMember.map((x) => x.count));
    for (const x of s.perMember) barRow(c, x.name, x.count, max, "#3b82f6");
  }

  const taskCols = [
    { header: "Key", w: 26 },
    { header: "Title", w: pageWidth(c) - 26 - 30 - 26 },
    { header: "Status", w: 30 },
    { header: "Priority", w: 26 },
  ];
  const taskRow = (t: { key: string; title: string; status: string; priority: string }) =>
    [t.key, t.title, t.status, t.priority];

  section(c, `Assigned to me (${input.assigned.length})`);
  if (input.assigned.length === 0) text(c, "Nothing assigned to you right now.", { size: 8, color: "#64748b" });
  else table(c, taskCols, input.assigned.map(taskRow));

  section(c, `Waiting for my testing (${input.qaQueue.length})`);
  if (input.qaQueue.length === 0) text(c, "No task is waiting for your testing.", { size: 8, color: "#64748b" });
  else table(c, taskCols, input.qaQueue.map(taskRow));

  section(c, `Overdue (${input.overdue.length})`);
  if (input.overdue.length === 0) text(c, "Nothing overdue — nice.", { size: 8, color: "#64748b" });
  else {
    table(
      c,
      [{ header: "Key", w: 30 }, { header: "Title", w: pageWidth(c) - 30 - 26 }, { header: "Due", w: 26 }],
      input.overdue.map((t) => [t.key, t.title, t.due]),
    );
  }

  section(c, `Recently changed (${input.recent.length})`);
  if (input.recent.length === 0) text(c, "No activity yet.", { size: 8, color: "#64748b" });
  else {
    table(
      c,
      [
        { header: "Key", w: 26 },
        { header: "Task", w: pageWidth(c) - 26 - 28 - 30 - 26 },
        { header: "Change", w: 28 },
        { header: "By", w: 30 },
        { header: "When", w: 26 },
      ],
      input.recent.map((a) => [a.key, a.title, a.action, a.actor, a.when]),
    );
  }

  if (input.projects.length) {
    section(c, `Projects (${input.projects.length})`);
    table(
      c,
      [{ header: "Key", w: 30 }, { header: "Name", w: pageWidth(c) - 30 }],
      input.projects.map((p) => [p.key, p.name]),
    );
  }

  footer(c, `TaskTracker · Dashboard · ${input.generatedAt.toLocaleDateString()}`);
  return doc;
}
