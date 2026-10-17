"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import ConfirmDialog from "@/components/ConfirmDialog";

/**
 * "Calendar Settings" lives inside the Calendar page and manages the GLOBAL
 * holiday list (item 1: holidays are for everyone — no project scope anywhere).
 * Admin-only to add/edit/delete; every delete goes through the shared
 * ConfirmDialog. On any change the parent reloads the calendar so the grid
 * names update.
 */

export interface HolidayRow {
  id: string;
  date: string;
  name: string;
  canManage: boolean;
}

const inp = "rounded border p-1 text-xs dark:border-slate-700 dark:bg-slate-800";
const btn = "rounded border px-2 py-0.5 text-xs hover:bg-line dark:border-slate-700";

export default function CalendarSettings({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<HolidayRow[] | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [add, setAdd] = useState({ date: "", name: "" });
  const [edits, setEdits] = useState<Record<string, { date: string; name: string }>>({});
  const [deleting, setDeleting] = useState<HolidayRow | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ holidays: HolidayRow[]; canManageGlobal: boolean }>("/api/holidays");
      setRows(d.holidays);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load holidays.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const canAdd = rows !== null && rows[0]?.canManage === true;

  async function addHoliday() {
    setBusy("add"); setErr(""); setMsg("");
    try {
      await api("/api/holidays", {
        method: "POST",
        body: JSON.stringify({ date: add.date, name: add.name }),
      });
      setMsg("Holiday added.");
      setAdd({ date: "", name: "" });
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the holiday.");
    } finally { setBusy(""); }
  }

  async function saveHoliday(row: HolidayRow) {
    const edit = edits[row.id];
    if (!edit) return;
    setBusy(row.id); setErr(""); setMsg("");
    try {
      await api(`/api/holidays?id=${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ date: edit.date, name: edit.name }),
      });
      setEdits((m) => { const next = { ...m }; delete next[row.id]; return next; });
      setMsg(`Holiday on ${row.date} updated.`);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update the holiday.");
    } finally { setBusy(""); }
  }

  async function deleteHoliday() {
    if (!deleting) return;
    setBusy("delete"); setErr("");
    try {
      await api(`/api/holidays?id=${deleting.id}`, { method: "DELETE" });
      setMsg(`Holiday “${deleting.name || deleting.date}” deleted — capacity counts this day again.`);
      setDeleting(null);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete the holiday.");
      setDeleting(null);
    } finally { setBusy(""); }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-auto bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Calendar Settings — holidays"
        className="mt-10 max-h-[80vh] w-[46rem] max-w-full overflow-auto rounded border border-line bg-surface p-4 text-sm shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-base font-bold">⚙ Calendar Settings</h2>
          <span className="text-xs text-muted">Holidays (all projects) — capacity excludes these days.</span>
          <button onClick={onClose} className={`${btn} ml-auto`}>Close</button>
        </div>

        {msg && <p className="mb-2 rounded bg-green-50 px-2 py-1 text-xs text-green-700 dark:bg-green-950 dark:text-green-300">{msg}</p>}
        {err && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{err}</p>}

        {rows !== null && !canAdd && (
          <p className="mb-3 text-xs text-muted">
            You can view holidays here; adding or editing needs Admin rights.
          </p>
        )}
        {canAdd && (
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="text-xs">Date
              <input type="date" value={add.date} onChange={(e) => setAdd({ ...add, date: e.target.value })} className={`${inp} mt-0.5 block`} />
            </label>
            <label className="text-xs">Name
              <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="e.g. Eid holiday" maxLength={120} className={`${inp} mt-0.5 block w-44`} />
            </label>
            <button onClick={() => void addHoliday()} disabled={!add.date || busy === "add"} className="tt-btn text-xs">
              Add holiday
            </button>
          </div>
        )}

        {rows === null && !err && <p className="text-xs">Loading holidays…</p>}
        {rows && rows.length === 0 && <p className="text-xs text-muted">No holidays yet.</p>}
        {rows && rows.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-2 font-semibold">Date</th>
                <th className="py-1 font-semibold">Name</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const edit = edits[h.id] ?? { date: h.date, name: h.name };
                return (
                  <tr key={h.id} className="border-t border-line">
                    <td className="py-1 pr-2 align-top">
                      {h.canManage ? (
                        <input type="date" value={edit.date}
                          onChange={(e) => setEdits((m) => ({ ...m, [h.id]: { ...edit, date: e.target.value } }))}
                          className={inp} />
                      ) : (
                        <span className="font-mono">{h.date}</span>
                      )}
                    </td>
                    <td className="py-1">
                      <span className="flex items-center gap-2">
                        {h.canManage ? (
                          <input value={edit.name} maxLength={120} placeholder="(holiday)"
                            onChange={(e) => setEdits((m) => ({ ...m, [h.id]: { ...edit, name: e.target.value } }))}
                            className={`${inp} w-52`} />
                        ) : (
                          h.name || "(holiday)"
                        )}
                        {h.canManage && (
                          <span className="ml-auto flex gap-1">
                            <button onClick={() => void saveHoliday(h)} disabled={!edits[h.id] || busy === h.id} className={btn}>Save</button>
                            <button onClick={() => setDeleting(h)} className="rounded border px-2 py-0.5 text-xs text-red-600 dark:border-slate-700 dark:text-red-400">Delete</button>
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {deleting && (
        // Keeps the confirm dialog's backdrop clicks from closing the settings modal too.
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            title={`Delete holiday “${deleting.name || deleting.date}”?`}
            body={`${deleting.date} (all projects) — capacity calculations will count this day again.`}
            confirmLabel="Delete holiday"
            busy={busy === "delete"}
            onCancel={() => setDeleting(null)}
            onConfirm={() => void deleteHoliday()}
          />
        </div>
      )}
    </div>
  );
}
