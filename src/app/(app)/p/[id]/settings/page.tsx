"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/client";
import { useProject } from "@/hooks/useProject";
import { memberLabel } from "@/lib/memberLabel";
import ConfirmDialog from "@/components/ConfirmDialog";

export default function SettingsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { data: lookups, refresh } = useProject(projectId);
  const [msg, setMsg] = useState("");

  const [hours, setHours] = useState("8");
  const [banner, setBanner] = useState("");
  const [accent, setAccent] = useState("#4f46e5");
  const [viewersCanComment, setViewersCanComment] = useState(false);
  const [wip, setWip] = useState<Record<string, string>>({});

  const [wf, setWf] = useState<{
    statuses: { id: string; name: string; category: string; color: string; timerRole: string }[];
    transitions: { id: string; fromId: string; toId: string; roleIds: string; from: { name: string }; to: { name: string } }[];
    roles: { id: string; name: string }[];
    issueTypes: { id: string; name: string }[];
    /** Step 1: distinct designations users already have (autocomplete hints). */
    designationHints: string[];
    /** Step 1: free-text designations suggested per status. */
    designationTags: Record<string, string[]>;
  } | null>(null);
  const [newStatus, setNewStatus] = useState({ name: "", category: "todo", color: "#64748b" });
  const [newTrans, setNewTrans] = useState({ fromId: "", toId: "", roleIds: [] as string[] });
  /** Step 1: free-text chip drafts, per status. */
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({});

  const [rules, setRules] = useState<{ id: string; name: string; trigger: string; enabled: boolean; condition: unknown; action: unknown }[]>([]);
  // Simplified rule builder: a status-change trigger, an optional status condition, and an assign/notify action.
  const [newRule, setNewRule] = useState({ toStatusId: "", kind: "notify", memberId: "", notifyTarget: "assignee" });

  // Phase 3: deleting a column that still holds tasks → prompt where to move them.
  const [pendingDelete, setPendingDelete] = useState<{ refId: string; name: string; message: string } | null>(null);
  const [moveTo, setMoveTo] = useState("");
  // Phase 2: every destructive action goes through the one ConfirmDialog.
  const [confirmStatus, setConfirmStatus] = useState<{ id: string; name: string } | null>(null);
  const [confirmRule, setConfirmRule] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadAll() {
    // Each section loads independently: a 403 on a section the role cannot
    // manage (e.g. Automation for Developers) must not blank the others.
    const [w, r] = await Promise.allSettled([
      api<NonNullable<typeof wf>>(`/api/projects/${projectId}/workflow`),
      api<{ rules: { id: string; name: string; trigger: string; enabled: boolean; condition: unknown; action: unknown }[] }>(`/api/projects/${projectId}/automation`),
    ]);
    if (w.status === "fulfilled") setWf(w.value);
    if (r.status === "fulfilled") setRules(r.value.rules);
    const hardFailure = [w, r].find(
      (x): x is PromiseRejectedResult =>
        x.status === "rejected" &&
        !((x.reason as Error & { status?: number }).status === 403), // 403 = section this role can't manage; render its gated state instead
    );
    if (hardFailure && hardFailure.status === "rejected") {
      setMsg(hardFailure.reason instanceof Error ? hardFailure.reason.message : "Load failed.");
    }
  }

  useEffect(() => {
    if (lookups) {
      setHours(String(lookups.project.hoursPerDay));
      setBanner(lookups.project.bannerNote ?? "");
      setAccent((lookups.project.settings.accent as string) ?? "#4f46e5");
      setViewersCanComment((lookups.project.settings.viewersCanComment as boolean) ?? false);
      setWip(Object.fromEntries(Object.entries((lookups.project.settings.wipLimits ?? {}) as Record<string, number>).map(([k, v]) => [k, String(v)])));
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookups?.project.id]);

  if (!lookups) return <p className="text-sm">Loading…</p>;

  async function saveGeneral() {
    try {
      const wipLimits: Record<string, number> = {};
      for (const [k, v] of Object.entries(wip)) {
        if (v !== "") wipLimits[k] = Number(v);
      }
      await api(`/api/projects/${projectId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ hoursPerDay: Number(hours), bannerNote: banner || null, accent, viewersCanComment, wipLimits }),
      });
      setMsg("Settings saved.");
      refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    }
  }

  const box = "tt-card p-3";
  const inp = "rounded border p-1 text-xs dark:border-slate-700 dark:bg-slate-800";
  const btn = "rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white";
  const canWf = lookups.membership.isSuperAdmin || lookups.membership.perms.manage_workflow === true;
  const canAuto = lookups.membership.isSuperAdmin || lookups.membership.perms.manage_automation === true;

  /** Readable names for the timer roles (colour + text, never colour alone). */
  const TIMER_ROLE_LABEL: Record<string, string> = {
    NONE: "None — no timer",
    TRACK: "Track — Start / Stop buttons",
    FINAL: "Final — Done (total only)",
  };

  async function swapStatusPositions(aIdx: number, bIdx: number) {
    const list = wf?.statuses ?? [];
    const a = list[aIdx];
    const b = list[bIdx];
    if (!a || !b) return;
    try {
      await api(`/api/projects/${projectId}/workflow`, { method: "PATCH", body: JSON.stringify({ kind: "status", refId: a.id, position: bIdx }) });
      await api(`/api/projects/${projectId}/workflow`, { method: "PATCH", body: JSON.stringify({ kind: "status", refId: b.id, position: aIdx }) });
      loadAll(); refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Reorder failed."); }
  }

  /** Step 1: persist a status's free-text designation suggestion chips. */
  async function saveDesignationTags(statusId: string, next: string[]) {
    try {
      await api(`/api/projects/${projectId}/workflow`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "status", refId: statusId, designationTags: next }),
      });
      setWf((w) => (w ? { ...w, designationTags: { ...w.designationTags, [statusId]: next } } : w));
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save the suggestion list."); }
  }

  /** Step 4: which part the column plays in the cumulative timer (Admin/PM). */
  async function saveTimerRole(statusId: string, timerRole: string) {
    try {
      await api(`/api/projects/${projectId}/workflow`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "status", refId: statusId, timerRole }),
      });
      loadAll();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not change the timer role."); }
  }

  /** Add the typed chip (Enter / comma / +): any text is allowed. */
  function addDesignationTag(statusId: string) {
    const raw = tagDraft[statusId] ?? "";
    const text = raw.trim().replace(/\s+/g, " ");
    setTagDraft((d) => ({ ...d, [statusId]: "" }));
    if (!text) return;
    const cur = wf?.designationTags?.[statusId] ?? [];
    if (cur.some((x) => x.toLowerCase() === text.toLowerCase())) return;
    void saveDesignationTags(statusId, [...cur, text]);
  }

  /** Delete a status column (confirmed via ConfirmDialog); if it still has tasks the move-tasks dialog opens. */
  async function deleteStatus(s: { id: string; name: string }) {
    try {
      await api(`/api/projects/${projectId}/workflow?kind=status&refId=${s.id}`, { method: "DELETE" });
      loadAll(); refresh();
    } catch (e) {
      const err = e instanceof Error ? e.message : "Delete failed.";
      const status = (e as { status?: number }).status;
      if (status === 400 && /still has \d+ task/.test(err)) {
        // Column has tasks — ask where to move them, retry with moveToId.
        const others = (wf?.statuses ?? []).filter((o) => o.id !== s.id);
        setMoveTo(others[0]?.id ?? "");
        setPendingDelete({ refId: s.id, name: s.name, message: err });
      } else {
        setMsg(err);
      }
    }
  }

  function categoryLabel(c: string): string {
    return c === "todo" ? "To Do" : c === "inprogress" ? "In Progress" : c === "done" ? "Done" : c;
  }

  function fieldLabel(f: string): string {
    const s = f.replace(/([A-Z])/g, " $1").toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Plain-English description of a stored rule (existing/advanced rules render readably too). */
  const describeRule = (r: { trigger: string; condition: unknown; action: unknown }): string => {
    const cond = (r.condition ?? {}) as Record<string, unknown>;
    const act = (r.action ?? {}) as Record<string, unknown>;
    const when =
      r.trigger === "status_changed" ? "When status changes" :
      r.trigger === "task_created" ? "When a task is created" :
      r.trigger === "task_assigned" ? "When a task is assigned" :
      `When ${r.trigger}`;
    const conds: string[] = [];
    if (typeof cond.toStatus === "string") conds.push(`to “${cond.toStatus}”`);
    if (typeof cond.toCategory === "string") {
      const label = categoryLabel(cond.toCategory);
      conds.push(`to ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label} status`);
    }
    if ("startDate" in cond && cond.startDate === null) conds.push("with no start date");
    if (cond.hasAssignee === true) conds.push("with an assignee");
    if (cond.hasAssignee === false) conds.push("without an assignee");
    const acts: string[] = [];
    const set = (act.set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      if (field === "assigneeId") {
        const name = lookups.members.find((mem) => mem.userId === value)?.name;
        acts.push(name ? `assign to ${name}` : "assign to a member");
      } else if (value === "today") acts.push(`set ${fieldLabel(field)} to today`);
      else if (value === "null") acts.push(`clear ${fieldLabel(field)}`);
      else acts.push(`set ${fieldLabel(field)} to ${String(value)}`);
    }
    const notify = act.notify as { user?: string } | undefined;
    if (notify?.user === "assignee") acts.push("notify the assignee");
    else if (notify?.user === "testedBy") acts.push("notify the tester");
    else if (notify?.user) acts.push(`notify ${notify.user}`);
    return `${when}${conds.length ? " " + conds.join(" and ") : ""} → ${acts.length ? acts.join(" and ") : "no extra action"}`;
  };

  /** Simple rule builder: status-change trigger + optional status condition + assign/notify action. */
  const saveRule = async () => {
    const status = lookups.statuses.find((s) => s.id === newRule.toStatusId);
    const target = lookups.members.find((mem) => mem.userId === newRule.memberId);
    if (newRule.kind === "assign" && !target) { setMsg("Pick a member to assign."); return; }
    const condition = status ? { toStatus: status.name } : {};
    const action = newRule.kind === "assign"
      ? { set: { assigneeId: newRule.memberId } }
      : { notify: { user: newRule.notifyTarget, title: "Automation rule", body: "Task status changed." } };
    const name = newRule.kind === "assign"
      ? `Status change → assign to ${target?.name ?? "member"}`
      : `Status change → notify ${newRule.notifyTarget === "testedBy" ? "the tester" : "the assignee"}`;
    try {
      await api(`/api/projects/${projectId}/automation`, {
        method: "POST",
        body: JSON.stringify({
          name: status ? `${name} (${status.name})` : name,
          trigger: "status_changed", condition, action,
        }),
      });
      setNewRule({ toStatusId: "", kind: "notify", memberId: "", notifyTarget: "assignee" });
      loadAll();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Create failed."); }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <p className="text-xs text-slate-500 lg:col-span-2">{msg}</p>

      <section className={box}>
        <h3 className="mb-2 font-bold">General</h3>
        <label className="mb-1 block text-xs">Working hours per day (Est. Days = Est. Hours ÷ this)
          <input type="number" min={1} max={24} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} className={`${inp} ml-1 w-20`} />
        </label>
        <label className="mb-1 block text-xs">Banner note
          <input value={banner} onChange={(e) => setBanner(e.target.value)} className={`${inp} ml-1 w-full`} />
        </label>
        <label className="mb-1 block text-xs">Accent colour
          <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="ml-1" />
        </label>
        <label className="mb-2 flex items-center gap-1 text-xs">
          <input type="checkbox" checked={viewersCanComment} onChange={(e) => setViewersCanComment(e.target.checked)} />
          Viewers may comment
        </label>
        <h4 className="mb-1 text-xs font-bold">WIP limits per status</h4>
        {lookups.statuses.map((s) => (
          <label key={s.id} className="mb-1 block text-xs">{s.name}
            <input value={wip[s.id] ?? ""} onChange={(e) => setWip({ ...wip, [s.id]: e.target.value })}
              placeholder="∞" type="number" min={0} className={`${inp} ml-1 w-16`} />
          </label>
        ))}
        <button onClick={saveGeneral} className={btn}>Save general</button>
      </section>

      <section className={box}>
        <h3 className="mb-2 font-bold">Statuses</h3>
        <p className="mb-1 text-[11px] text-slate-500">
          {canWf
            ? "Statuses are ordered — members may only move a task forward; Admin/PM may move to any status. The timer role decides which columns offer Start/Stop (Track), show only the total (Final — Done), or no timer at all (None)."
            : "Read-only — only Admin/PM can edit the workflow."}
        </p>
        <ul className="mb-2 text-xs">
          {(wf?.statuses ?? []).map((s, i) => (
            <li key={s.id} className="mb-2 flex flex-col gap-1 border-b pb-1 dark:border-slate-800">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name} <span className="text-slate-500">({s.category})</span>
                <span className="ml-1 text-slate-400">#{i + 1}</span>
                {canWf && (
                  <>
                    <button
                      onClick={() => void swapStatusPositions(i, i - 1)}
                      disabled={i === 0}
                      className="ml-auto rounded border px-1 disabled:opacity-40" title="Move up">↑</button>
                    <button
                      onClick={() => void swapStatusPositions(i, i + 1)}
                      disabled={i === (wf?.statuses.length ?? 0) - 1}
                      className="rounded border px-1 disabled:opacity-40" title="Move down">↓</button>
                    <button
                      onClick={() => setConfirmStatus({ id: s.id, name: s.name })}
                      className="rounded border px-1">Delete</button>
                  </>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-1 text-[10px]">
                <span className="text-slate-500">Timer role:</span>
                {canWf ? (
                  <select
                    value={s.timerRole}
                    onChange={(e) => void saveTimerRole(s.id, e.target.value)}
                    className={`${inp} py-0.5`}
                    title="None = no timer; Track = manual Start/Stop buttons; Final = Done (total time, read-only)"
                  >
                    <option value="NONE">None — no timer</option>
                    <option value="TRACK">Track — Start / Stop</option>
                    <option value="FINAL">Final — Done</option>
                  </select>
                ) : (
                  <span className="text-slate-400">{TIMER_ROLE_LABEL[s.timerRole] ?? s.timerRole}</span>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-1 text-[10px]">
                <span className="text-slate-500">Suggest designations:</span>
                {(wf?.designationTags?.[s.id] ?? []).map((text) => (
                  <span key={text} className="inline-flex items-center gap-1 rounded-full border border-indigo-500 bg-indigo-50 px-2 py-0.5 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
                    {text}
                    {canWf && (
                      <button
                        onClick={() => void saveDesignationTags(s.id, (wf?.designationTags?.[s.id] ?? []).filter((x) => x !== text))}
                        className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-300"
                        title={`Remove “${text}”`}
                      >×</button>
                    )}
                  </span>
                ))}
                {canWf && (
                  <>
                    <input
                      list={`des-hints-${s.id}`}
                      value={tagDraft[s.id] ?? ""}
                      onChange={(e) => setTagDraft((d) => ({ ...d, [s.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addDesignationTag(s.id); }
                      }}
                      onBlur={() => { if ((tagDraft[s.id] ?? "").trim()) addDesignationTag(s.id); }}
                      placeholder="type a title + Enter"
                      className={`${inp} w-40 py-0.5`}
                    />
                    <datalist id={`des-hints-${s.id}`}>
                      {(wf?.designationHints ?? []).map((h) => <option key={h} value={h} />)}
                    </datalist>
                    <button onClick={() => addDesignationTag(s.id)} className="rounded border px-1 dark:border-slate-700" title="Add">+</button>
                  </>
                )}
                {(wf?.designationTags?.[s.id] ?? []).length === 0 && !canWf && (
                  <span className="text-slate-400">none</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {canWf && (
          <div className="flex gap-1">
            <input value={newStatus.name} onChange={(e) => setNewStatus({ ...newStatus, name: e.target.value })} placeholder="Name" className={inp} />
            <select value={newStatus.category} onChange={(e) => setNewStatus({ ...newStatus, category: e.target.value })} className={inp}>
              <option value="todo">To Do</option>
              <option value="inprogress">In Progress</option>
              <option value="done">Done</option>
            </select>
            <input type="color" value={newStatus.color} onChange={(e) => setNewStatus({ ...newStatus, color: e.target.value })} />
            <button
              onClick={async () => {
                try {
                  await api(`/api/projects/${projectId}/workflow`, { method: "POST", body: JSON.stringify(newStatus) });
                  setNewStatus({ name: "", category: "todo", color: "#64748b" });
                  loadAll(); refresh();
                } catch (e) { setMsg(e instanceof Error ? e.message : "Create failed."); }
              }}
              className={btn}>Add</button>
          </div>
        )}

        <h3 className="mb-1 mt-3 font-bold">Transitions (from → to, per role)</h3>
        <p className="mb-1 text-[11px] text-slate-500">Empty roles = every project role may use it. Admin/PM may always move to any status.</p>
        <ul className="mb-2 max-h-40 overflow-auto text-xs">
          {(wf?.transitions ?? []).map((t) => (
            <li key={t.id} className="mb-1 flex items-center gap-1 font-mono">
              {t.from.name} → {t.to.name}
              <span className="text-slate-500">{JSON.parse(t.roleIds).length === 0 ? "(all roles)" : ""}</span>
              {canWf && (
                <button
                  onClick={async () => {
                    await api(`/api/projects/${projectId}/workflow?kind=transition&refId=${t.id}`, { method: "DELETE" });
                    loadAll();
                  }}
                  className="ml-auto rounded border px-1">✕</button>
              )}
            </li>
          ))}
        </ul>
        {canWf && (
          <div className="flex flex-wrap gap-1">
            <select value={newTrans.fromId} onChange={(e) => setNewTrans({ ...newTrans, fromId: e.target.value })} className={inp}>
              <option value="">From…</option>
              {(wf?.statuses ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={newTrans.toId} onChange={(e) => setNewTrans({ ...newTrans, toId: e.target.value })} className={inp}>
              <option value="">To…</option>
              {(wf?.statuses ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button
              onClick={async () => {
                try {
                  await api(`/api/projects/${projectId}/workflow?kind=transition`, {
                    method: "POST",
                    body: JSON.stringify({ fromId: newTrans.fromId, toId: newTrans.toId, roleIds: newTrans.roleIds }),
                  });
                  setNewTrans({ fromId: "", toId: "", roleIds: [] });
                  loadAll();
                } catch (e) { setMsg(e instanceof Error ? e.message : "Create failed."); }
              }}
              className={btn}>Add transition</button>
          </div>
        )}
      </section>

      <section className={box}>
        <h3 className="mb-2 font-bold">Priorities & issue types</h3>
        <p className="mb-1 text-xs text-slate-500">Read-only — existing priorities and issue types keep working.</p>
        <ul className="mb-2 text-xs">
          {lookups.priorities.map((p) => <li key={p.id}>● <span style={{ color: p.color }}>{p.name}</span> (level {p.level})</li>)}
        </ul>
        <ul className="text-xs">
          {lookups.issueTypes.map((t) => <li key={t.id}>{t.name}</li>)}
        </ul>
      </section>

      <section className={box}>
        <h3 className="mb-2 font-bold">Automation rules</h3>
        <ul className="mb-2 max-h-44 overflow-auto text-xs">
          {rules.map((r) => (
            <li key={r.id} className="mb-1 flex items-start gap-1">
              <input type="checkbox" checked={r.enabled} className="mt-0.5" onChange={async (e) => {
                await api(`/api/projects/${projectId}/automation?ruleId=${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: e.target.checked }) });
                loadAll();
              }} />
              <span className="min-w-0 flex-1"><strong>{r.name}</strong> <span className="text-slate-500">— {describeRule(r)}</span></span>
              <button onClick={() => setConfirmRule({ id: r.id, name: r.name })} className="rounded border px-1" title="Delete rule">✕</button>
            </li>
          ))}
          {rules.length === 0 && <li className="text-slate-500">No automation rules yet.</li>}
        </ul>
        {canAuto && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-slate-500">When a task status changes</span>
            <select value={newRule.toStatusId} onChange={(e) => setNewRule({ ...newRule, toStatusId: e.target.value })} className={inp}>
              <option value="">to any status</option>
              {lookups.statuses.map((s) => <option key={s.id} value={s.id}>to “{s.name}”</option>)}
            </select>
            <select value={newRule.kind} onChange={(e) => setNewRule({ ...newRule, kind: e.target.value })} className={inp}>
              <option value="assign">assign to</option>
              <option value="notify">notify</option>
            </select>
            {newRule.kind === "assign" ? (
              <select value={newRule.memberId} onChange={(e) => setNewRule({ ...newRule, memberId: e.target.value })} className={inp}>
                <option value="">pick a member…</option>
                {lookups.members.map((mem) => <option key={mem.userId} value={mem.userId}>{memberLabel(mem)}</option>)}
              </select>
            ) : (
              <select value={newRule.notifyTarget} onChange={(e) => setNewRule({ ...newRule, notifyTarget: e.target.value })} className={inp}>
                <option value="assignee">the assignee</option>
                <option value="testedBy">the tester</option>
              </select>
            )}
            <button onClick={saveRule} className={btn}>Save rule</button>
          </div>
        )}
      </section>

      {confirmStatus && (
        <ConfirmDialog
          title={`Delete status "${confirmStatus.name}"?`}
          body="Tasks in this column are kept — if any remain you will be asked which column to move them to."
          confirmLabel="Delete column"
          onCancel={() => setConfirmStatus(null)}
          onConfirm={() => { const s = confirmStatus; setConfirmStatus(null); void deleteStatus(s); }}
        />
      )}

      {confirmRule && (
        <ConfirmDialog
          title={`Delete rule “${confirmRule.name}”?`}
          body="The rule stops applying to future status changes. Past activity is not affected."
          confirmLabel="Delete rule"
          busy={deleting}
          onCancel={() => setConfirmRule(null)}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await api(`/api/projects/${projectId}/automation?ruleId=${confirmRule.id}`, { method: "DELETE" });
              setConfirmRule(null);
              loadAll();
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Delete failed.");
              setConfirmRule(null);
            } finally { setDeleting(false); }
          }}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded border border-line bg-surface p-4 shadow-lg">
            <h4 className="mb-1 text-sm font-bold">Remove column “{pendingDelete.name}”?</h4>
            <p className="mb-2 text-xs text-slate-500">{pendingDelete.message}</p>
            <label className="mb-3 block text-xs">
              Move its tasks to
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={`${inp} ml-1`}>
                {(wf?.statuses ?? []).filter((o) => o.id !== pendingDelete.refId).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingDelete(null)} className="rounded border px-2 py-1 text-xs dark:border-slate-700">Cancel</button>
              <button
                onClick={async () => {
                  if (!moveTo) return;
                  try {
                    await api(`/api/projects/${projectId}/workflow?kind=status&refId=${pendingDelete.refId}&moveToId=${encodeURIComponent(moveTo)}`, { method: "DELETE" });
                    setPendingDelete(null);
                    setMsg("Column removed and its tasks moved.");
                    loadAll(); refresh();
                  } catch (e) {
                    setMsg(e instanceof Error ? e.message : "Delete failed.");
                    setPendingDelete(null);
                  }
                }}
                className={btn}
              >
                Move tasks &amp; delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
