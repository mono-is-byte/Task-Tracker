"use client";

import { useState } from "react";
import { buildDashboardPdf } from "@/lib/pdf";
import { IconDownload } from "@/components/icons";
import type { DashboardSummary } from "@/lib/dashboard";

/**
 * Change request: the Dashboard downloads the entire page as PDF or Excel
 * (CSV is gone).
 *
 * PDF  — built client-side from the data the page already rendered, with the
 *        shared jspdf helpers (same pipeline as Reports and Calendar). Because
 *        it is data-driven it always contains every section, including the ones
 *        below the fold, and flows over as many A4 pages as needed.
 * Excel — the genuine .xlsx workbook comes from /api/dashboard/export, which
 *        re-validates the viewer's project scope server-side and returns one
 *        worksheet per dashboard section.
 */

export interface DashboardExportRow {
  key: string;
  title: string;
  status: string;
  priority: string;
  due: string;
}

export interface DashboardExportActivity {
  key: string;
  title: string;
  action: string;
  actor: string;
  when: string;
}

interface Props {
  /** Validated project id ("" = all projects) — used for the export URL. */
  scopeId: string;
  /** Short file-name scope: a project key or "all". */
  scopeKey: string;
  /** Human label shown in the PDF header. */
  scopeLabel: string;
  summary: DashboardSummary;
  assigned: DashboardExportRow[];
  qaQueue: DashboardExportRow[];
  overdue: DashboardExportRow[];
  recent: DashboardExportActivity[];
  projects: { key: string; name: string }[];
}

export default function DashboardExport(props: Props) {
  const [busy, setBusy] = useState<"" | "pdf" | "xlsx">("");
  const [err, setErr] = useState("");

  async function downloadPdf() {
    setErr("");
    setBusy("pdf");
    try {
      const doc = await buildDashboardPdf({
        scopeLabel: props.scopeLabel,
        generatedAt: new Date(),
        summary: props.summary,
        assigned: props.assigned,
        qaQueue: props.qaQueue,
        overdue: props.overdue,
        recent: props.recent,
        projects: props.projects,
      });
      doc.save(`dashboard-${props.scopeKey}.pdf`);
    } catch {
      setErr("PDF export failed — please try again.");
    } finally {
      setBusy("");
    }
  }

  async function downloadXlsx() {
    setErr("");
    setBusy("xlsx");
    let objectUrl = "";
    try {
      const res = await fetch(
        `/api/dashboard/export?format=xlsx${props.scopeId ? `&project=${encodeURIComponent(props.scopeId)}` : ""}`,
      );
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `dashboard-${props.scopeKey}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setErr("Excel export failed — please try again.");
    } finally {
      // Clean up the object URL once the download has started.
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      setBusy("");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="tt-btn"
        onClick={() => void downloadPdf()}
        disabled={busy !== ""}
        title="Download the entire dashboard (all sections, multiple pages) as a PDF"
      >
        <IconDownload className="h-3.5 w-3.5" />
        {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
      </button>
      <button
        type="button"
        className="tt-btn"
        onClick={() => void downloadXlsx()}
        disabled={busy !== ""}
        title="Download the dashboard's data as a real Excel workbook (one sheet per section)"
      >
        <IconDownload className="h-3.5 w-3.5" />
        {busy === "xlsx" ? "Preparing Excel…" : "Download Excel"}
      </button>
      {err && (
        <span className="text-xs text-red-600 dark:text-red-400" role="alert">
          {err}
        </span>
      )}
    </span>
  );
}
