"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import ConfirmDialog from "@/components/ConfirmDialog";
import { dayKey, isWeekendDay } from "@/lib/calendar";
import {
  HOLIDAY_TYPES, HOLIDAY_TYPE_LABEL, dayKeysBetween, holidayCoversDay, parseDayKey,
  type ExceptionRow,
} from "@/lib/holidayDates";
import { IconFlag, IconPencil, IconSliders, IconSun, IconTrash } from "@/components/icons";

/**
 * "Calendar Settings" lives inside the Calendar page and manages the GLOBAL
 * holiday list + working-day exceptions (holidays are for everyone — there is
 * no project scope anywhere). Admin-only to add/edit/delete; every delete goes
 * through the shared ConfirmDialog. On any change the parent reloads the
 * calendar so the grid names and colours update.
 *
 * Holidays are date RANGES: start + optional end (same day = single-day
 * holiday); every day in between is covered, inclusive. A working-day
 * exception ("office open") is stored separately and never modifies the
 * holiday row, so removing it restores the original holiday status.
 */

export interface HolidayRow {
  id: string;
  startDate: string;
  endDate: string;
  name: string;
  description: string;
  type: string;
  canManage: boolean;
}

const inp = "rounded border p-1 text-xs dark:border-slate-700 dark:bg-slate-800";
const btn = "rounded border px-2 py-0.5 text-xs hover:bg-line dark:border-slate-700";

interface EditState {
  startDate: string;
  endDate: string;
  name: string;
  type: string;
}

function fmtDay(key: string): string {
  const d = parseDayKey(key);
  return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : key;
}

function fmtSpan(h: { startDate: string; endDate: string }): string {
  if (!h.endDate || h.endDate === h.startDate) return fmtDay(h.startDate);
  const days = dayKeysBetween(h.startDate, h.endDate).length;
  return `${fmtDay(h.startDate)} → ${fmtDay(h.endDate)}${days ? ` (${days} days)` : ""}`;
}

export default function CalendarSettings({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<HolidayRow[] | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [add, setAdd] = useState({ startDate: dayKey(new Date()), endDate: "", name: "", type: "public" });
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [deleting, setDeleting] = useState<HolidayRow | null>(null);
  const [exAdd, setExAdd] = useState({ date: dayKey(new Date()), note: "" });

  const load = useCallback(async () => {
    try {
      const d = await api<{ holidays: HolidayRow[]; exceptions: ExceptionRow[]; canManageGlobal: boolean }>("/api/holidays");
      setRows(d.holidays);
      setExceptions(d.exceptions ?? []);
      setCanManage(d.canManageGlobal === true);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load holidays.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /** Why does a date need an exception? (what removing it would restore) */
  const underlying = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of exceptions) {
      const d = parseDayKey(e.date);
      const hol = (rows ?? []).find((h) => holidayCoversDay(h, e.date));
      map.set(
        e.date,
        hol ? `was the holiday “${hol.name || "Holiday"}”` :
        d && isWeekendDay(d) ? "was a weekly holiday (Fri/Sat)" :
        "was already a working day",
      );
    }
    return map;
  }, [exceptions, rows]);

  const addRangeError = useMemo(() => {
    if (!add.startDate) return "";
    if (add.endDate && add.endDate < add.startDate) return "The end date cannot be earlier than the start date.";
    if (add.endDate && dayKeysBetween(add.startDate, add.endDate).length === 0) return "The range is too long (maximum 366 days).";
    return "";
  }, [add.startDate, add.endDate]);

  async function addHoliday() {
    setBusy("add"); setErr(""); setMsg("");
    try {
      await api("/api/holidays", {
        method: "POST",
        body: JSON.stringify({
          startDate: add.startDate,
          endDate: add.endDate || add.startDate,
          name: add.name,
          type: add.type,
        }),
      });
      const end = add.endDate || add.startDate;
      setMsg(end === add.startDate ? `Holiday added on ${fmtDay(add.startDate)}.` : `Holiday added for ${fmtSpan({ startDate: add.startDate, endDate: end })}.`);
      setAdd({ startDate: dayKey(new Date()), endDate: "", name: "", type: "public" });
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add the holiday.");
    } finally { setBusy(""); }
  }

  function startEdit(h: HolidayRow) {
    setErr("");
    setMsg("");
    setEdits((m) => ({ ...m, [h.id]: { startDate: h.startDate, endDate: h.endDate, name: h.name, type: h.type } }));
  }

  function cancelEdit(id: string) {
    setEdits((m) => { const next = { ...m }; delete next[id]; return next; });
  }

  async function saveHoliday(row: HolidayRow) {
    const edit = edits[row.id];
    if (!edit) return;
    if (edit.endDate && edit.endDate < edit.startDate) {
      setErr("The end date cannot be earlier than the start date.");
      return;
    }
    setBusy(row.id); setErr(""); setMsg("");
    try {
      // `description` is intentionally not sent: the UI no longer edits it, and
      // the API keeps the stored value when the field is omitted.
      await api(`/api/holidays?id=${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          startDate: edit.startDate,
          endDate: edit.endDate || edit.startDate,
          name: edit.name,
          type: edit.type,
        }),
      });
      setEdits((m) => { const next = { ...m }; delete next[row.id]; return next; });
      setMsg(`“${edit.name || row.name}” updated.`);
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
      setMsg(`Holiday “${deleting.name || deleting.startDate}” deleted — capacity counts those days again.`);
      setDeleting(null);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete the holiday.");
      setDeleting(null);
    } finally { setBusy(""); }
  }

  async function addException() {
    setBusy("ex-add"); setErr(""); setMsg("");
    try {
      const res = await api<{ exception: ExceptionRow }>("/api/working-days", {
        method: "POST",
        body: JSON.stringify({ date: exAdd.date, note: exAdd.note }),
      });
      setMsg(`${fmtDay(exAdd.date)} is now a working day (office open).`);
      setExAdd({ date: dayKey(new Date()), note: "" });
      void res;
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not mark the date as a working day.");
    } finally { setBusy(""); }
  }

  async function removeException(date: string) {
    setBusy(`ex-${date}`); setErr(""); setMsg("");
    try {
      await api(`/api/working-days?date=${date}`, { method: "DELETE" });
      setMsg(`${fmtDay(date)}: working-day exception removed — the original status is restored.`);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove the exception.");
    } finally { setBusy(""); }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-auto bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Calendar Settings — holidays and working days"
        className="glass-strong mt-10 max-h-[85vh] w-[52rem] max-w-full overflow-auto rounded border border-line p-4 text-sm shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-base font-bold"><IconSliders className="h-4 w-4" /> Calendar Settings</h2>
          <span className="text-xs text-muted">Holidays and working days are global (all projects).</span>
          <button onClick={onClose} className={`${btn} ml-auto`} aria-label="Close calendar settings">Close</button>
        </div>

        {msg && <p className="mb-2 rounded bg-green-50 px-2 py-1 text-xs text-green-700 dark:bg-green-950 dark:text-green-300" role="status">{msg}</p>}
        {err && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300" role="alert">{err}</p>}

        {rows !== null && !canManage && (
          <p className="mb-3 text-xs text-muted">
            You can view holidays and working days here; adding or editing needs Admin rights.
          </p>
        )}

        {/* ── Holidays (date ranges) ─────────────────────────────────────── */}
        <h3 className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
          <IconFlag className="h-3.5 w-3.5" /> Holidays (date ranges)
        </h3>
        {canManage && (
          <div className="mb-3 rounded border border-line p-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="text-xs sm:w-44">Holiday name
                <input
                  value={add.name}
                  onChange={(e) => setAdd({ ...add, name: e.target.value })}
                  placeholder="e.g. Eid holiday"
                  maxLength={120}
                  className={`${inp} mt-0.5 block w-full`}
                  aria-label="Holiday name"
                />
              </label>
              <label className="text-xs">Start date
                <input type="date" value={add.startDate} onChange={(e) => setAdd({ ...add, startDate: e.target.value })} className={`${inp} mt-0.5 block w-full`} aria-label="Holiday start date" />
              </label>
              <label className="text-xs">End date <span className="text-muted">(optional)</span>
                <input type="date" value={add.endDate} min={add.startDate || undefined} onChange={(e) => setAdd({ ...add, endDate: e.target.value })} className={`${inp} mt-0.5 block w-full`} aria-label="Holiday end date" />
              </label>
              <label className="text-xs">Type
                <select value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value })} className={`${inp} mt-0.5 block w-full`} aria-label="Holiday type">
                  {HOLIDAY_TYPES.map((t) => <option key={t} value={t}>{HOLIDAY_TYPE_LABEL[t]}</option>)}
                </select>
              </label>
              <button
                onClick={() => void addHoliday()}
                disabled={!add.name.trim() || !add.startDate || busy === "add" || Boolean(addRangeError)}
                className="tt-btn text-xs"
                title={addRangeError || "Adds every date in the range"}
              >
                Add holiday
              </button>
            </div>
            {addRangeError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{addRangeError}</p>}
            {add.endDate === "" && add.startDate && (
              <p className="mt-1 text-[11px] text-muted">Leave the end date empty for a single-day holiday.</p>
            )}
          </div>
        )}

        {rows === null && !err && <p className="text-xs">Loading holidays…</p>}
        {rows && rows.length === 0 && <p className="text-xs text-muted">No holidays yet.</p>}
        {rows && rows.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-2 font-semibold">Dates</th>
                <th className="py-1 pr-2 font-semibold">Name</th>
                <th className="py-1 pr-2 font-semibold">Type</th>
                <th className="py-1 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const edit = edits[h.id];
                const invalidRange = Boolean(edit && edit.endDate && edit.endDate < edit.startDate);
                return (
                  <tr key={h.id} className="border-t border-line">
                    <td className="py-1 pr-2 align-top">
                      {edit ? (
                        <>
                          <span className="flex items-center gap-1">
                            <input type="date" value={edit.startDate} onChange={(e) => setEdits((m) => ({ ...m, [h.id]: { ...edit, startDate: e.target.value } }))} className={inp} aria-label={`${h.name} start date`} />
                            <span className="text-muted">→</span>
                            <input type="date" value={edit.endDate} min={edit.startDate} onChange={(e) => setEdits((m) => ({ ...m, [h.id]: { ...edit, endDate: e.target.value } }))} className={inp} aria-label={`${h.name} end date`} />
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted">{fmtSpan(edit)}</span>
                          {invalidRange && <span className="mt-0.5 block text-[11px] text-red-600 dark:text-red-400">The end date is before the start date.</span>}
                        </>
                      ) : (
                        <span className="font-mono">{fmtSpan(h)}</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 align-top">
                      {edit ? (
                        <input value={edit.name} maxLength={120} placeholder="(holiday)" onChange={(e) => setEdits((m) => ({ ...m, [h.id]: { ...edit, name: e.target.value } }))} className={`${inp} w-40`} aria-label={`${h.startDate} holiday name`} />
                      ) : (
                        <span className="inline-flex items-center gap-1"><IconFlag className="h-3 w-3" /> {h.name || "(holiday)"}</span>
                      )}
                    </td>
                    <td className="py-1 pr-2 align-top">
                      {edit ? (
                        <select value={edit.type} onChange={(e) => setEdits((m) => ({ ...m, [h.id]: { ...edit, type: e.target.value } }))} className={inp} aria-label={`${h.name} type`}>
                          {HOLIDAY_TYPES.map((t) => <option key={t} value={t}>{HOLIDAY_TYPE_LABEL[t]}</option>)}
                        </select>
                      ) : (
                        <span className="text-muted">{HOLIDAY_TYPE_LABEL[h.type] ?? h.type}</span>
                      )}
                    </td>
                    <td className="py-1 align-top">
                      {h.canManage && (
                        <span className="flex items-center justify-end gap-1">
                          {edit ? (
                            <>
                              <button onClick={() => void saveHoliday(h)} disabled={busy === h.id || invalidRange} className="tt-btn text-xs" title="Save the changes to this holiday">Save</button>
                              <button onClick={() => cancelEdit(h.id)} disabled={busy === h.id} className={btn} title="Cancel editing (nothing is saved)">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(h)} className={btn} title="Edit this holiday"><IconPencil className="h-3 w-3" /> Edit</button>
                              <button onClick={() => setDeleting(h)} className="rounded border px-2 py-0.5 text-xs text-red-600 dark:border-slate-700 dark:text-red-400" title="Delete this holiday" aria-label={`Delete ${h.name || h.startDate}`}>
                                <IconTrash className="h-3 w-3" />
                              </button>
                            </>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* ── Working-day exceptions ─────────────────────────────────────── */}
        <h3 className="mb-1 mt-4 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
          <IconSun className="h-3.5 w-3.5" /> Working-day exceptions (office open)
        </h3>
        <p className="mb-2 text-[11px] text-muted">
          An exception overrides the weekly holiday (Fri/Sat) and any configured holiday for that date. The holiday
          itself is kept — removing the exception restores it.
        </p>
        {canManage && (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded border border-line p-2">
            <label className="text-xs">Date
              <input type="date" value={exAdd.date} onChange={(e) => setExAdd({ ...exAdd, date: e.target.value })} className={`${inp} mt-0.5 block`} aria-label="Working-day exception date" />
            </label>
            <label className="text-xs">Note <span className="text-muted">(optional)</span>
              <input value={exAdd.note} onChange={(e) => setExAdd({ ...exAdd, note: e.target.value })} maxLength={300} placeholder="e.g. Month-end closing" className={`${inp} mt-0.5 block w-52`} aria-label="Working-day exception note" />
            </label>
            <button onClick={() => void addException()} disabled={!exAdd.date || busy === "ex-add"} className="tt-btn text-xs" title="Mark this date as a working day">
              <IconSun className="h-3.5 w-3.5" /> Mark as working day
            </button>
          </div>
        )}
        {exceptions.length === 0 ? (
          <p className="text-xs text-muted">No working-day exceptions.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-2 font-semibold">Date</th>
                <th className="py-1 pr-2 font-semibold">Note</th>
                <th className="py-1 pr-2 font-semibold">Overrides</th>
                <th className="py-1 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {exceptions.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-1 pr-2 font-mono">{fmtDay(e.date)}</td>
                  <td className="py-1 pr-2 text-muted">{e.note || "—"}</td>
                  <td className="py-1 pr-2 text-muted">{underlying.get(e.date) ?? "—"}</td>
                  <td className="py-1">
                    {canManage && (
                      <span className="flex justify-end">
                        <button
                          onClick={() => void removeException(e.date)}
                          disabled={busy === `ex-${e.date}`}
                          className={btn}
                          title="Remove the exception and restore the original holiday status"
                        >
                          Restore holiday
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canManage && rows && rows.length > 0 && (
          <p className="mt-3 flex items-center gap-1 text-[11px] text-muted">
            <IconPencil className="h-3 w-3" /> Click <span className="font-semibold">Edit</span> on a row to change its dates, name or type — Save stores it, Cancel leaves the holiday untouched.
          </p>
        )}
      </div>

      {deleting && (
        // Keeps the confirm dialog's backdrop clicks from closing the settings modal too.
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            title={`Delete holiday “${deleting.name || deleting.startDate}”?`}
            body={`${fmtSpan(deleting)} (all projects) — capacity calculations will count ${deleting.endDate && deleting.endDate !== deleting.startDate ? "these days" : "this day"} again.`}
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
