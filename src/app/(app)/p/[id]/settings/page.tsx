"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/client";
import { useProject } from "@/hooks/useProject";
import ConfirmDialog from "@/components/ConfirmDialog";
import { memberLabel, userOptionLabel } from "@/lib/memberLabel";
import { CLEAR_ISSUE_TYPE } from "@/lib/lookups";
import { IconTrash, IconX } from "@/components/icons";

/**
 * One-click starter statuses — the same column set the demo boards use, so a
 * fresh project can be set up in a few clicks instead of typing every name.
 * Chips add immediately; existing names are disabled.
 */
const STATUS_PRESETS: { name: string; category: "todo" | "inprogress" | "done"; color: string }[] = [
  { name: "To Do", category: "todo", color: "#64748b" },
  { name: "In Progress", category: "inprogress", color: "#3b82f6" },
  { name: "Development Done", category: "inprogress", color: "#8b5cf6" },
  { name: "In Testing", category: "inprogress", color: "#f59e0b" },
  { name: "Re-open", category: "inprogress", color: "#ef4444" },
  { name: "Done", category: "done", color: "#22c55e" },
];

/** Common flows, resolved by status NAME; only offered when both exist. */
const FLOW_PRESETS: [string, string][] = [
  ["To Do", "In Progress"],
  ["In Progress", "Development Done"],
  ["Development Done", "In Testing"],
  ["In Testing", "Done"],
  ["In Testing", "Re-open"],
  ["Re-open", "In Progress"],
  ["In Progress", "Done"],
];

export default function SettingsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const { data: lookups, refresh } = useProject(projectId);
  const [msg, setMsg] = useState("");

  const [hours, setHours] = useState("8");
  const [banner, setBanner] = useState("");
  const [accent, setAccent] = useState("#4f46e5");
  const [viewersCanComment, setViewersCanComment] = useState(false);

  const [wf, setWf] = useState<{
    statuses: { id: string; name: string; category: string; color: string; timerRole: string }[];
    transitions: { id: string; fromId: string; toId: string; roleIds: string; from: { name: string }; to: { name: string } }[];
    roles: { id: string; name: string }[];
    issueTypes: { id: string; name: string }[];
    /** Phase 1: role ids suggested per status (never free text). */
    designationRoleIds: Record<string, string[]>;
  } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [newTrans, setNewTrans] = useState({ fromId: "", toId: "", roleIds: [] as string[] });
  /** Transition row being re-roled inline (null = no row in edit mode). */
  const [transEdit, setTransEdit] = useState<{ id: string; roleIds: string[] } | null>(null);
  const [transBusy, setTransBusy] = useState(false);

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

  // Change request: Priorities & issue types are editable lookups. Their busy /
  // notice / confirmation state is kept separate from the page-level message so
  // a failed lookup write never hides the rest of the settings page.
  const [newPrio, setNewPrio] = useState({ name: "", level: "3", color: "#94a3b8" });
  const [prioEdit, setPrioEdit] = useState<{ id: string; name: string; level: string; color: string } | null>(null);
  const [newType, setNewType] = useState({ name: "", color: "#6366f1" });
  const [typeEdit, setTypeEdit] = useState<{ id: string; name: string; color: string } | null>(null);
  const [lookupBusy, setLookupBusy] = useState("");
  const [lookupMsg, setLookupMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmLookup, setConfirmLookup] = useState<{ kind: "priority" | "type"; id: string; name: string } | null>(null);
  const [pendingLookup, setPendingLookup] = useState<{ kind: "priority" | "type"; id: string; name: string; message: string } | null>(null);
  const [moveLookupTo, setMoveLookupTo] = useState("");

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
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookups?.project.id]);

  if (!lookups) return <p className="text-sm">Loading…</p>;

  async function saveGeneral() {
    try {
      await api(`/api/projects/${projectId}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ hoursPerDay: Number(hours), bannerNote: banner || null, accent, viewersCanComment }),
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

  /** Phase 1: persist a status's suggested-role ids (Settings > Statuses). */
  async function saveDesignationRoles(statusId: string, next: string[]) {
    try {
      await api(`/api/projects/${projectId}/workflow`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "status", refId: statusId, designationRoleIds: next }),
      });
      setWf((w) => (w ? { ...w, designationRoleIds: { ...w.designationRoleIds, [statusId]: next } } : w));
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

  /** Parse a transition's stored role list defensively (legacy rows may hold junk). */
  function transitionRoleIds(t: { roleIds: string }): string[] {
    try {
      const parsed = JSON.parse(t.roleIds);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch { return []; }
  }

  function transitionRoleNames(t: { roleIds: string }): string {
    const ids = transitionRoleIds(t);
    if (ids.length === 0) return "All roles";
    return ids.map((rid) => (wf?.roles ?? []).find((r) => r.id === rid)?.name ?? "—").join(", ");
  }

  /** Add a transition: client-side guards for missing/equal/duplicate pairs, then POST. */
  async function addTransition() {
    const { fromId, toId, roleIds } = newTrans;
    if (!fromId || !toId) { setMsg("Pick both a From and a To status."); return; }
    if (fromId === toId) { setMsg("A transition must go from one status to a different status."); return; }
    if ((wf?.transitions ?? []).some((t) => t.fromId === fromId && t.toId === toId)) {
      setMsg("That transition already exists."); return;
    }
    setMsg("");
    try {
      await api(`/api/projects/${projectId}/workflow?kind=transition`, {
        method: "POST",
        body: JSON.stringify({ fromId, toId, roleIds }),
      });
      setNewTrans({ fromId: "", toId: "", roleIds: [] });
      setTransEdit(null);
      setMsg("Transition added.");
      loadAll();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Create failed."); }
  }

  /** Create a status with client-side validation (empty / duplicate names). */
  async function createStatus(name: string, category: string, color: string) {
    const clean = name.trim();
    if (!clean) { setMsg("Pick a preset status below."); return; }
    if ((wf?.statuses ?? []).some((s) => s.name.toLowerCase() === clean.toLowerCase())) {
      setMsg(`Status “${clean}” already exists.`);
      return;
    }
    setMsg("");
    setStatusBusy(true);
    try {
      await api(`/api/projects/${projectId}/workflow`, {
        method: "POST",
        body: JSON.stringify({ name: clean, category, color }),
      });
      setMsg(`Status “${clean}” added.`);
      await loadAll();
      refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add the status.");
    } finally { setStatusBusy(false); }
  }

  /** Preset chip: add one starter status (existing names are disabled in the UI). */
  async function addStatusPreset(p: (typeof STATUS_PRESETS)[number]) {
    await createStatus(p.name, p.category, p.color);
  }

  /** Add every starter status this project is still missing, in one go. */
  async function addAllStatusPresets() {
    const missing = STATUS_PRESETS.filter(
      (p) => !(wf?.statuses ?? []).some((s) => s.name.toLowerCase() === p.name.toLowerCase()),
    );
    if (missing.length === 0) { setMsg("Every preset status is already there."); return; }
    setMsg("");
    setStatusBusy(true);
    try {
      for (const p of missing) {
        await api(`/api/projects/${projectId}/workflow`, {
          method: "POST",
          body: JSON.stringify({ name: p.name, category: p.category, color: p.color }),
        });
      }
      setMsg(`Added ${missing.length} preset status(es).`);
      await loadAll();
      refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add the preset statuses.");
    } finally { setStatusBusy(false); }
  }

  /** Flow presets that can be created right now (both status names exist). */
  const flowPresets = FLOW_PRESETS.flatMap(([from, to]) => {
    const f = (wf?.statuses ?? []).find((s) => s.name === from);
    const t = (wf?.statuses ?? []).find((s) => s.name === to);
    if (!f || !t) return [];
    return [{ fromId: f.id, toId: t.id, label: `${f.name} → ${t.name}` }];
  });

  async function addFlow(fromId: string, toId: string) {
    setMsg("");
    setTransBusy(true);
    try {
      await api(`/api/projects/${projectId}/workflow?kind=transition`, {
        method: "POST",
        body: JSON.stringify({ fromId, toId, roleIds: [] }),
      });
      setNewTrans({ fromId: "", toId: "", roleIds: [] });
      setTransEdit(null);
      setMsg("Transition added.");
      await loadAll();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add the transition.");
    } finally { setTransBusy(false); }
  }

  /** Add every preset flow that is not defined yet. */
  async function addAllFlows() {
    const missing = flowPresets.filter(
      (p) => !(wf?.transitions ?? []).some((t) => t.fromId === p.fromId && t.toId === p.toId),
    );
    if (missing.length === 0) { setMsg("Every preset flow is already there."); return; }
    setMsg("");
    setTransBusy(true);
    try {
      for (const p of missing) {
        await api(`/api/projects/${projectId}/workflow?kind=transition`, {
          method: "POST",
          body: JSON.stringify({ fromId: p.fromId, toId: p.toId, roleIds: [] }),
        });
      }
      setMsg(`Added ${missing.length} preset transition(s).`);
      await loadAll();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add the preset flows.");
    } finally { setTransBusy(false); }
  }

  /** Save the allowed-role list of an existing transition (PATCH kind=transition). */
  async function saveTransitionRoles() {
    if (!transEdit) return;
    setMsg("");
    setTransBusy(true);
    try {
      await api(`/api/projects/${projectId}/workflow`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "transition", refId: transEdit.id, roleIds: transEdit.roleIds }),
      });
      setTransEdit(null);
      setMsg("Transition roles saved.");
      loadAll();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally { setTransBusy(false); }
  }

  async function deleteTransition(id: string) {
    setMsg("");
    try {
      await api(`/api/projects/${projectId}/workflow?kind=transition&refId=${id}`, { method: "DELETE" });
      setTransEdit((cur) => (cur?.id === id ? null : cur));
      setMsg("Transition removed.");
      loadAll();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Delete failed."); }
  }

  /**
   * Priorities & issue types (change request): create / edit / delete via
   * /api/projects/:id/settings (manage_workflow). The lists themselves come
   * from the shared lookups, so `refresh()` is all the UI needs after a write.
   */
  function lookupMessage(text: string, ok: boolean) {
    setLookupMsg({ text, ok });
  }

  async function createPriority() {
    const name = newPrio.name.trim();
    const level = Number(newPrio.level);
    if (!name) return lookupMessage("Enter a priority name.", false);
    if (!Number.isInteger(level) || level < 0 || level > 99) {
      return lookupMessage("Priority level must be a whole number between 0 and 99.", false);
    }
    setLookupBusy("new-priority");
    setLookupMsg(null);
    try {
      await api(`/api/projects/${projectId}/lookups?kind=priority`, {
        method: "POST",
        body: JSON.stringify({ name, level, color: newPrio.color }),
      });
      setNewPrio({ name: "", level: "3", color: "#94a3b8" });
      lookupMessage(`Priority “${name}” added.`, true);
      refresh();
    } catch (e) {
      lookupMessage(e instanceof Error ? e.message : "Could not add the priority.", false);
    } finally { setLookupBusy(""); }
  }

  async function savePriority() {
    if (!prioEdit) return;
    const name = prioEdit.name.trim();
    const level = Number(prioEdit.level);
    if (!name) return lookupMessage("Enter a priority name.", false);
    if (!Number.isInteger(level) || level < 0 || level > 99) {
      return lookupMessage("Priority level must be a whole number between 0 and 99.", false);
    }
    setLookupBusy(prioEdit.id);
    setLookupMsg(null);
    try {
      await api(`/api/projects/${projectId}/lookups`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "priority", refId: prioEdit.id, name, level, color: prioEdit.color }),
      });
      setPrioEdit(null);
      lookupMessage(`Priority “${name}” saved.`, true);
      refresh();
    } catch (e) {
      lookupMessage(e instanceof Error ? e.message : "Could not save the priority.", false);
    } finally { setLookupBusy(""); }
  }

  async function createType() {
    const name = newType.name.trim();
    if (!name) return lookupMessage("Enter an issue type name.", false);
    setLookupBusy("new-type");
    setLookupMsg(null);
    try {
      await api(`/api/projects/${projectId}/lookups?kind=type`, {
        method: "POST",
        body: JSON.stringify({ name, color: newType.color }),
      });
      setNewType({ name: "", color: "#6366f1" });
      lookupMessage(`Issue type “${name}” added.`, true);
      refresh();
    } catch (e) {
      lookupMessage(e instanceof Error ? e.message : "Could not add the issue type.", false);
    } finally { setLookupBusy(""); }
  }

  async function saveType() {
    if (!typeEdit) return;
    const name = typeEdit.name.trim();
    if (!name) return lookupMessage("Enter an issue type name.", false);
    setLookupBusy(typeEdit.id);
    setLookupMsg(null);
    try {
      await api(`/api/projects/${projectId}/lookups`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "type", refId: typeEdit.id, name, color: typeEdit.color }),
      });
      setTypeEdit(null);
      lookupMessage(`Issue type “${name}” saved.`, true);
      refresh();
    } catch (e) {
      lookupMessage(e instanceof Error ? e.message : "Could not save the issue type.", false);
    } finally { setLookupBusy(""); }
  }

  /** Delete (confirmed first); a used option answers code "in_use" → ask where its tasks go. */
  async function deleteLookup(target: { kind: "priority" | "type"; id: string; name: string }) {
    setLookupMsg(null);
    try {
      const d = await api<{ deleted: boolean; moved: number }>(
        `/api/projects/${projectId}/lookups?kind=${target.kind}&refId=${target.id}`,
        { method: "DELETE" },
      );
      lookupMessage(
        `${target.kind === "priority" ? "Priority" : "Issue type"} “${target.name}” deleted${d.moved ? ` — ${d.moved} task(s) moved` : ""}.`,
        true,
      );
      refresh();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "in_use") {
        const others = target.kind === "priority"
          ? (lookups?.priorities ?? []).filter((p) => p.id !== target.id)
          : (lookups?.issueTypes ?? []).filter((t) => t.id !== target.id);
        setMoveLookupTo(others[0]?.id ?? (target.kind === "priority" ? "" : CLEAR_ISSUE_TYPE));
        setPendingLookup({ ...target, message: err.message });
      } else {
        lookupMessage(err.message, false);
      }
    }
  }

  async function confirmMoveLookup() {
    if (!pendingLookup || !moveLookupTo) return;
    setLookupBusy("move");
    setLookupMsg(null);
    try {
      const d = await api<{ deleted: boolean; moved: number }>(
        `/api/projects/${projectId}/lookups?kind=${pendingLookup.kind}&refId=${pendingLookup.id}&moveToId=${encodeURIComponent(moveLookupTo)}`,
        { method: "DELETE" },
      );
      lookupMessage(
        `${pendingLookup.kind === "priority" ? "Priority" : "Issue type"} “${pendingLookup.name}” deleted${d.moved ? ` — ${d.moved} task(s) moved` : ""}.`,
        true,
      );
      setPendingLookup(null);
      refresh();
    } catch (e) {
      lookupMessage(e instanceof Error ? e.message : "Delete failed.", false);
      setPendingLookup(null);
    } finally { setLookupBusy(""); }
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

      {/* Top row: compact General (right) and Transitions (left) cards. On small
          screens General stacks above Transitions. */}
      <div className="grid gap-3 lg:col-span-2 lg:grid-cols-2">
        <section className={`${box} lg:order-2`}>
          <h3 className="mb-1 text-sm font-bold">General</h3>
          <p className="mb-2 text-[11px] text-slate-500">Project-wide preferences, saved with the button below.</p>
          <div className="flex flex-col gap-3 text-xs">
            <label className="block">
              <span className="font-medium">Working hours per day</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Estimated days are calculated from estimated hours using this value — e.g. 24 h ≈ 3 days at 8 h/day.
              </span>
              <input
                type="number" min={1} max={24} step={0.5} value={hours}
                onChange={(e) => setHours(e.target.value)} className={`${inp} mt-1 w-24`}
              />
            </label>
            <label className="block">
              <span className="font-medium">Banner note</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">Shown to everyone at the top of every page in this project.</span>
              <textarea
                value={banner} onChange={(e) => setBanner(e.target.value)} rows={2}
                placeholder="e.g. Tasks time may change depending on meeting, emergency support"
                className={`${inp} mt-1 w-full`}
              />
            </label>
            <label className="block">
              <span className="font-medium">Accent colour</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">Used for the project key and active accents.</span>
              <span className="mt-1 flex items-center gap-2">
                <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="Accent colour" />
                <span className="font-mono text-[11px] text-slate-500">{accent.toUpperCase()}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox" checked={viewersCanComment}
                onChange={(e) => setViewersCanComment(e.target.checked)} className="mt-0.5"
              />
              <span>
                <span className="font-medium">Viewers may comment</span>
                <span className="block text-[11px] text-slate-500">When off, view-only members can read tasks but not comment.</span>
              </span>
            </label>
          </div>
          <button onClick={saveGeneral} className={`${btn} mt-3`}>Save general</button>
        </section>

        <section className={`${box} lg:order-1`}>
          <h3 className="mb-1 text-sm font-bold">Transitions (from → to, per role)</h3>
          <p className="mb-2 text-[11px] text-slate-500">Only transitions listed here are allowed. Empty roles = every project role may use it. Project Manager and Super Admin may move to any status.</p>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="border-b border-line pb-1 font-semibold">From</th>
                <th className="border-b border-line pb-1 font-semibold">To</th>
                <th className="border-b border-line pb-1 font-semibold">Allowed roles</th>
                {canWf && <th className="w-16 border-b border-line pb-1"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {(wf?.transitions ?? []).map((t) => (
                transEdit?.id === t.id ? (
                  <tr key={t.id}>
                    <td colSpan={canWf ? 4 : 3} className="border-b border-line py-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium">{t.from.name} → {t.to.name}</span>
                        <span className="text-slate-500">Allowed roles:</span>
                        {(wf?.roles ?? []).map((r) => (
                          <label key={r.id} className="flex items-center gap-1 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={transEdit.roleIds.includes(r.id)}
                              onChange={(e) => setTransEdit({
                                id: transEdit.id,
                                roleIds: e.target.checked
                                  ? [...transEdit.roleIds, r.id]
                                  : transEdit.roleIds.filter((x) => x !== r.id),
                              })}
                            />
                            {r.name}
                          </label>
                        ))}
                        <span className="text-[10px] text-slate-500">(none = all roles)</span>
                        <span className="ml-auto flex shrink-0 gap-1">
                          <button onClick={() => void saveTransitionRoles()} disabled={transBusy} className={`${btn} disabled:opacity-50`}>
                            {transBusy ? "Saving…" : "Save"}
                          </button>
                          <button onClick={() => setTransEdit(null)} className="rounded border border-line px-2 py-0.5">Cancel</button>
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={t.id}>
                    <td className="border-b border-line py-1 pr-2">{t.from.name}</td>
                    <td className="border-b border-line py-1 pr-2">{t.to.name}</td>
                    <td className="border-b border-line py-1 pr-2 text-slate-500">{transitionRoleNames(t)}</td>
                    {canWf && (
                      <td className="border-b border-line py-1">
                        <span className="flex justify-end gap-1">
                          <button
                            onClick={() => setTransEdit({ id: t.id, roleIds: transitionRoleIds(t) })}
                            className="rounded border border-line px-1.5 py-0.5 text-[11px]"
                            title={`Edit the roles allowed to use ${t.from.name} → ${t.to.name}`}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void deleteTransition(t.id)}
                            className="rounded border border-line px-1 py-0.5 text-slate-500 hover:bg-line hover:text-red-600"
                            title={`Delete ${t.from.name} → ${t.to.name}`}
                            aria-label={`Delete transition ${t.from.name} to ${t.to.name}`}
                          ><IconX className="h-3 w-3" /></button>
                        </span>
                      </td>
                    )}
                  </tr>
                )
              ))}
              {(wf?.transitions ?? []).length === 0 && (
                <tr><td colSpan={canWf ? 4 : 3} className="py-1 text-slate-500">No transitions yet.</td></tr>
              )}
            </tbody>
          </table>
          {canWf && (
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-slate-500">Preset flows:</span>
              {flowPresets.length === 0 && (
                <span className="text-slate-500">add statuses first — presets appear here.</span>
              )}
              {flowPresets.map((p) => {
                const exists = (wf?.transitions ?? []).some((t) => t.fromId === p.fromId && t.toId === p.toId);
                return (
                  <button
                    key={p.label}
                    type="button"
                    disabled={exists || transBusy}
                    onClick={() => void addFlow(p.fromId, p.toId)}
                    title={exists ? `${p.label} already exists` : `Add ${p.label}`}
                    className="rounded-full border border-line px-2 py-0.5 disabled:opacity-40"
                  >
                    {exists ? `✓ ${p.label}` : `+ ${p.label}`}
                  </button>
                );
              })}
              {flowPresets.length > 0 && (
                <button
                  type="button"
                  disabled={transBusy}
                  onClick={() => void addAllFlows()}
                  className="ml-1 rounded-full border border-indigo-500 px-2 py-0.5 font-medium text-indigo-600 disabled:opacity-40 dark:text-indigo-300"
                >
                  + Add all missing
                </button>
              )}
            </div>
          )}
          {canWf && (
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3 text-xs">
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px] text-slate-500">From</span>
                <select value={newTrans.fromId} onChange={(e) => setNewTrans({ ...newTrans, fromId: e.target.value })} className={inp}>
                  <option value="">From…</option>
                  {(wf?.statuses ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[11px] text-slate-500">To</span>
                <select value={newTrans.toId} onChange={(e) => setNewTrans({ ...newTrans, toId: e.target.value })} className={inp}>
                  <option value="">To…</option>
                  {(wf?.statuses ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <fieldset className="flex min-w-0 flex-col gap-0.5">
                <legend className="text-[11px] text-slate-500">Allowed roles — none = all roles</legend>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {(wf?.roles ?? []).map((r) => (
                    <label key={r.id} className="flex items-center gap-1 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={newTrans.roleIds.includes(r.id)}
                        onChange={(e) => setNewTrans({
                          ...newTrans,
                          roleIds: e.target.checked
                            ? [...newTrans.roleIds, r.id]
                            : newTrans.roleIds.filter((x) => x !== r.id),
                        })}
                      />
                      {r.name}
                    </label>
                  ))}
                </span>
              </fieldset>
              <button onClick={() => void addTransition()} className={btn}>Add transition</button>
            </div>
          )}
        </section>
      </div>

      <section className={box}>
        <h3 className="mb-1 text-sm font-bold">Statuses</h3>
        <p className="mb-2 text-[11px] text-slate-500">
          {canWf
            ? "The only allowed status moves are the Transitions defined in this project — there is no automatic “forward” rule. Project Manager and Super Admin may move to any status. The timer role decides which columns offer Start/Stop (Track), show only the total (Final — Done), or no timer at all (None)."
            : "Read-only — only Admin/PM can edit the workflow."}
        </p>
        <ul className="mb-2 text-xs">
          {(wf?.statuses ?? []).map((s, i) => (
            <li key={s.id} className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-1 dark:border-slate-800">
              <span className="flex w-full items-center gap-1">
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
                {(wf?.designationRoleIds?.[s.id] ?? []).map((roleId) => {
                  const name = (wf?.roles ?? []).find((r) => r.id === roleId)?.name ?? "—";
                  return (
                    <span key={roleId} className="inline-flex items-center gap-1 rounded-full border border-indigo-500 bg-indigo-50 px-2 py-0.5 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
                      {name}
                      {canWf && (
                        <button
                          onClick={() => void saveDesignationRoles(s.id, (wf?.designationRoleIds?.[s.id] ?? []).filter((x) => x !== roleId))}
                          className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-300"
                          title={`Remove “${name}”`}
                        >×</button>
                      )}
                    </span>
                  );
                })}
                {canWf && (
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      void saveDesignationRoles(s.id, [...(wf?.designationRoleIds?.[s.id] ?? []), v]);
                    }}
                    className={`${inp} py-0.5`}
                    title="Add a role to this status's suggested list"
                  >
                    <option value="">+ role…</option>
                    {(wf?.roles ?? [])
                      .filter((r) => !(wf?.designationRoleIds?.[s.id] ?? []).includes(r.id))
                      .map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}
                {(wf?.designationRoleIds?.[s.id] ?? []).length === 0 && !canWf && (
                  <span className="text-slate-400">none</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {canWf && (
          <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-slate-500">Preset statuses:</span>
            {STATUS_PRESETS.map((p) => {
              const exists = (wf?.statuses ?? []).some((s) => s.name.toLowerCase() === p.name.toLowerCase());
              return (
                <button
                  key={p.name}
                  type="button"
                  disabled={exists || statusBusy}
                  onClick={() => void addStatusPreset(p)}
                  title={exists ? `${p.name} already exists` : `Add “${p.name}” (${p.category})`}
                  className="rounded-full border border-line px-2 py-0.5 disabled:opacity-40"
                >
                  {exists ? `✓ ${p.name}` : `+ ${p.name}`}
                </button>
              );
            })}
            <button
              type="button"
              disabled={statusBusy}
              onClick={() => void addAllStatusPresets()}
              className="ml-1 rounded-full border border-indigo-500 px-2 py-0.5 font-medium text-indigo-600 disabled:opacity-40 dark:text-indigo-300"
            >
              + Add all missing
            </button>
          </div>
        )}

      </section>

      <div className="flex flex-col gap-3">
        <section className={box}>
          <h3 className="mb-1 text-sm font-bold">Priorities &amp; issue types</h3>
          <p className="mb-2 text-[11px] text-slate-500">
            {canWf
              ? "Tasks reference these by id — renaming or recolouring updates every task that uses them. Deleting asks where its tasks should move first."
              : "Read-only — only Admin/PM can manage priorities and issue types."}
          </p>
          {lookupMsg && (
            <p
              role="status"
              className={`mb-2 rounded px-2 py-1 text-xs ${lookupMsg.ok
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}
            >
              {lookupMsg.text}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <h4 className="mb-1 text-xs font-bold uppercase text-muted">Priorities</h4>
              <ul className="mb-2 flex flex-col gap-1 text-xs">
                {lookups.priorities.map((p) => (
                  <li key={p.id} className="rounded border border-line px-2 py-1">
                    {prioEdit?.id === p.id ? (
                      <span className="flex flex-wrap items-center gap-1">
                        <input
                          type="color" value={prioEdit.color} aria-label="Priority colour" className="shrink-0"
                          onChange={(e) => setPrioEdit({ ...prioEdit, color: e.target.value })}
                        />
                        <input
                          value={prioEdit.name} aria-label="Priority name"
                          onChange={(e) => setPrioEdit({ ...prioEdit, name: e.target.value })}
                          className={`${inp} min-w-0 flex-1`}
                        />
                        <input
                          type="number" min={0} max={99} value={prioEdit.level} aria-label="Priority level"
                          title="Level — higher sorts first" className={`${inp} w-12 shrink-0`}
                          onChange={(e) => setPrioEdit({ ...prioEdit, level: e.target.value })}
                        />
                        <span className="ml-auto flex shrink-0 gap-1">
                          <button
                            onClick={() => void savePriority()}
                            disabled={lookupBusy === p.id}
                            className={`${btn} disabled:opacity-50`}
                          >
                            {lookupBusy === p.id ? "Saving…" : "Save"}
                          </button>
                          <button onClick={() => setPrioEdit(null)} className="rounded border border-line px-2 py-1 text-xs">Cancel</button>
                        </span>
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-line" style={{ background: p.color }} aria-hidden />
                        <span className="font-medium">{p.name}</span>
                        <span className="text-slate-500" title="Higher level sorts first">level {p.level}</span>
                        {canWf && (
                          <>
                            <button
                              onClick={() => setPrioEdit({ id: p.id, name: p.name, level: String(p.level), color: p.color })}
                              className="ml-auto rounded border border-line px-2 py-0.5"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setConfirmLookup({ kind: "priority", id: p.id, name: p.name })}
                              className="rounded border border-line px-2 py-0.5 text-muted hover:bg-line hover:text-red-600"
                              aria-label={`Delete priority ${p.name}`}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </li>
                ))}
                {lookups.priorities.length === 0 && <li className="text-slate-500">No priorities yet.</li>}
              </ul>
              {canWf && (
                <div className="flex items-center gap-1 text-xs">
                  <input
                    type="color" value={newPrio.color} aria-label="New priority colour" className="shrink-0"
                    onChange={(e) => setNewPrio({ ...newPrio, color: e.target.value })}
                  />
                  <input
                    value={newPrio.name} placeholder="New priority" aria-label="New priority name"
                    onChange={(e) => setNewPrio({ ...newPrio, name: e.target.value })}
                    className={`${inp} min-w-0 flex-1`}
                  />
                  <input
                    type="number" min={0} max={99} value={newPrio.level} title="Level — higher sorts first"
                    aria-label="New priority level" className={`${inp} w-12 shrink-0`}
                    onChange={(e) => setNewPrio({ ...newPrio, level: e.target.value })}
                  />
                  <button onClick={() => void createPriority()} disabled={lookupBusy === "new-priority"} className={`${btn} shrink-0 disabled:opacity-50`}>
                    {lookupBusy === "new-priority" ? "Adding…" : "Add"}
                  </button>
                </div>
              )}
            </div>
            <div>
              <h4 className="mb-1 text-xs font-bold uppercase text-muted">Issue types</h4>
              <ul className="mb-2 flex flex-col gap-1 text-xs">
                {lookups.issueTypes.map((t) => (
                  <li key={t.id} className="rounded border border-line px-2 py-1">
                    {typeEdit?.id === t.id ? (
                      <span className="flex flex-wrap items-center gap-1">
                        <input
                          type="color" value={typeEdit.color} aria-label="Issue type colour" className="shrink-0"
                          onChange={(e) => setTypeEdit({ ...typeEdit, color: e.target.value })}
                        />
                        <input
                          value={typeEdit.name} aria-label="Issue type name"
                          onChange={(e) => setTypeEdit({ ...typeEdit, name: e.target.value })}
                          className={`${inp} min-w-0 flex-1`}
                        />
                        <span className="ml-auto flex shrink-0 gap-1">
                          <button
                            onClick={() => void saveType()}
                            disabled={lookupBusy === t.id}
                            className={`${btn} disabled:opacity-50`}
                          >
                            {lookupBusy === t.id ? "Saving…" : "Save"}
                          </button>
                          <button onClick={() => setTypeEdit(null)} className="rounded border border-line px-2 py-1 text-xs">Cancel</button>
                        </span>
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-line" style={{ background: t.color }} aria-hidden />
                        <span className="font-medium">{t.name}</span>
                        {canWf && (
                          <>
                            <button
                              onClick={() => setTypeEdit({ id: t.id, name: t.name, color: t.color })}
                              className="ml-auto rounded border border-line px-2 py-0.5"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setConfirmLookup({ kind: "type", id: t.id, name: t.name })}
                              className="rounded border border-line px-2 py-0.5 text-muted hover:bg-line hover:text-red-600"
                              aria-label={`Delete issue type ${t.name}`}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </li>
                ))}
                {lookups.issueTypes.length === 0 && <li className="text-slate-500">No issue types yet.</li>}
              </ul>
              {canWf && (
                <div className="flex items-center gap-1 text-xs">
                  <input
                    type="color" value={newType.color} aria-label="New issue type colour" className="shrink-0"
                    onChange={(e) => setNewType({ ...newType, color: e.target.value })}
                  />
                  <input
                    value={newType.name} placeholder="New issue type" aria-label="New issue type name"
                    onChange={(e) => setNewType({ ...newType, name: e.target.value })}
                    className={`${inp} min-w-0 flex-1`}
                  />
                  <button onClick={() => void createType()} disabled={lookupBusy === "new-type"} className={`${btn} shrink-0 disabled:opacity-50`}>
                    {lookupBusy === "new-type" ? "Adding…" : "Add"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className={`${box} lg:flex-1`}>
          <h3 className="mb-1 text-sm font-bold">Automation rules</h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Rules run automatically when a task changes status — assign the task to someone, or notify the assignee or the tester.
          </p>
          <ul className="mb-2 max-h-44 overflow-auto text-xs">
            {rules.map((r) => (
              <li key={r.id} className="mb-1 flex items-start gap-1">
                <input type="checkbox" checked={r.enabled} className="mt-0.5" onChange={async (e) => {
                  await api(`/api/projects/${projectId}/automation?ruleId=${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: e.target.checked }) });
                  loadAll();
                }} />
                <span className="min-w-0 flex-1"><strong>{r.name}</strong> <span className="text-slate-500">— {describeRule(r)}</span></span>
                <button onClick={() => setConfirmRule({ id: r.id, name: r.name })} className="rounded border px-1 py-0.5 text-muted hover:bg-line hover:text-red-600" title={`Delete rule “${r.name}”`} aria-label={`Delete rule ${r.name}`}><IconTrash className="h-3 w-3" /></button>
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
                  <option value="">pick a user…</option>
                  {lookups.members.map((mem) => <option key={mem.userId} value={mem.userId}>{userOptionLabel(mem)}</option>)}
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
      </div>

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

      {confirmLookup && (
        <ConfirmDialog
          title={`Delete ${confirmLookup.kind === "priority" ? "priority" : "issue type"} “${confirmLookup.name}”?`}
          body={confirmLookup.kind === "priority"
            ? "Tasks using it are kept — you will be asked which priority they should move to."
            : "Tasks using it are kept — you will be asked which issue type they should move to (or none)."}
          confirmLabel="Delete"
          onCancel={() => setConfirmLookup(null)}
          onConfirm={() => { const c = confirmLookup; setConfirmLookup(null); void deleteLookup(c); }}
        />
      )}

      {pendingLookup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="glass-strong w-96 rounded border border-line p-4 shadow-lg">
            <h4 className="mb-1 text-sm font-bold">
              Move tasks off “{pendingLookup.name}”
            </h4>
            <p className="mb-2 text-xs text-slate-500">{pendingLookup.message}</p>
            <label className="mb-3 block text-xs">
              Move its tasks to
              <select value={moveLookupTo} onChange={(e) => setMoveLookupTo(e.target.value)} className={`${inp} ml-1`}>
                {pendingLookup.kind === "priority" ? (
                  lookups.priorities.filter((p) => p.id !== pendingLookup.id).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))
                ) : (
                  <>
                    <option value={CLEAR_ISSUE_TYPE}>No issue type (clear)</option>
                    {lookups.issueTypes.filter((t) => t.id !== pendingLookup.id).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </>
                )}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingLookup(null)} className="rounded border border-line px-2 py-1 text-xs">Cancel</button>
              <button onClick={() => void confirmMoveLookup()} disabled={lookupBusy === "move"} className={`${btn} disabled:opacity-50`}>
                {lookupBusy === "move" ? "Moving…" : "Move tasks & delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="glass-strong w-96 rounded border border-line p-4 shadow-lg">
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
