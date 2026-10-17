import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  canDo,
  canEditTask,
  DEFAULT_ROLES,
  fieldRule,
  isTransitionAllowed,
  mergeRoles,
  parseFieldRules,
  parsePerms,
  type Membership,
} from "../src/lib/permissions";

function member(over: Partial<Membership>): Membership {
  return {
    id: "m", projectId: "p", userId: "u", roleIds: ["r"], roleNames: ["Developer"], roleName: "Developer",
    isSuperAdmin: false, perms: {}, fieldRules: {},
    ...over,
  };
}

describe("default role matrix", () => {
  it("defines all four project roles plus documented actions", () => {
    expect(Object.keys(DEFAULT_ROLES).sort()).toEqual(
      ["Developer", "Project Manager", "QA / Tester", "Viewer / Stakeholder"].sort(),
    );
    expect(ACTIONS).toContain("manage_epics");
    expect(ACTIONS).toContain("change_status");
  });
  it("manager can do everything, viewer almost nothing", () => {
    const pm = DEFAULT_ROLES["Project Manager"].permissions;
    for (const a of ACTIONS) expect(pm[a]).toBe(true);
    const viewer = DEFAULT_ROLES["Viewer / Stakeholder"].permissions;
    expect(viewer.view_project).toBe(true);
    expect(viewer.create_task).toBeFalsy();
    expect(viewer.delete_task).toBeFalsy();
  });
  it("developer cannot edit all tasks or estimates", () => {
    const dev = DEFAULT_ROLES.Developer.permissions;
    expect(dev.edit_task_own).toBe(true);
    expect(dev.edit_estimates).toBeFalsy();
  });
  it("field rules: QA edits feedback/testedBy, dev edits branch/remarks", () => {
    expect(DEFAULT_ROLES["QA / Tester"].fieldRules.feedback).toBe("editable");
    expect(DEFAULT_ROLES["QA / Tester"].fieldRules.testedBy).toBe("editable");
    expect(DEFAULT_ROLES["QA / Tester"].fieldRules.estHours).toBe("readonly");
    expect(DEFAULT_ROLES.Developer.fieldRules.gitBranch).toBe("editable");
    expect(DEFAULT_ROLES.Developer.fieldRules.remarks).toBe("editable");
  });
});

describe("canDo / fieldRule", () => {
  it("reads permission maps with safe defaults", () => {
    expect(canDo({ create_task: true }, "create_task")).toBe(true);
    expect(canDo({}, "create_task")).toBe(false);
    expect(fieldRule({ status: "editable" }, "status")).toBe("editable");
    expect(fieldRule({}, "status")).toBe("readonly");
    expect(parsePerms("not-json")).toEqual({});
    expect(parseFieldRules(null)).toEqual({});
  });
});

describe("canEditTask", () => {
  it("edit_task_all covers everything incl. superadmin", () => {
    expect(canEditTask(member({ perms: { edit_task_all: true } }), "other", "u")).toBe(true);
    expect(canEditTask(member({ isSuperAdmin: true, perms: {} }), "other", "u")).toBe(true);
  });
  it("edit_task_own covers own + unassigned (pick up) only", () => {
    const m = member({ perms: { edit_task_own: true } });
    expect(canEditTask(m, "u", "u")).toBe(true);
    expect(canEditTask(m, null, "u")).toBe(true);
    expect(canEditTask(m, "other", "u")).toBe(false);
  });
});

describe("isTransitionAllowed", () => {
  it("empty role list = any project role", () => {
    const t = { fromId: "a", toId: "b", roleIds: [], issueTypeIds: [] };
    expect(isTransitionAllowed(t, "dev-role", false)).toBe(true);
  });
  it("restricts to listed roles unless superadmin", () => {
    const t = { fromId: "a", toId: "b", roleIds: ["qa"], issueTypeIds: [] };
    expect(isTransitionAllowed(t, "dev", false)).toBe(false);
    expect(isTransitionAllowed(t, "qa", false)).toBe(true);
    expect(isTransitionAllowed(t, "dev", true)).toBe(true);
  });
  it("restricts by issue type when configured", () => {
    const t = { fromId: "a", toId: "b", roleIds: [], issueTypeIds: ["bug"] };
    expect(isTransitionAllowed(t, "dev", false, "bug")).toBe(true);
    expect(isTransitionAllowed(t, "dev", false, "task")).toBe(false);
    expect(isTransitionAllowed(t, "dev", false, null)).toBe(true);
  });
  it("multi-role member passes if ANY held role is allowed", () => {
    const t = { fromId: "a", toId: "b", roleIds: ["qa"], issueTypeIds: [] };
    expect(isTransitionAllowed(t, ["dev", "qa"], false)).toBe(true);
    expect(isTransitionAllowed(t, ["dev", "viewer"], false)).toBe(false);
  });
});

describe("mergeRoles (multi-role union)", () => {
  const devRole = {
    id: "r-dev", name: "Developer",
    permissions: JSON.stringify({ view_project: true, create_task: true, edit_task_own: true }),
    fieldRules: JSON.stringify({ gitBranch: "editable", estHours: "readonly" }),
  };
  const qaRole = {
    id: "r-qa", name: "QA / Tester",
    permissions: JSON.stringify({ view_project: true, change_status: true }),
    fieldRules: JSON.stringify({ feedback: "editable", estHours: "editable" }),
  };

  it("unions permissions across roles", () => {
    const merged = mergeRoles([devRole, qaRole]);
    expect(merged.perms.create_task).toBe(true);
    expect(merged.perms.change_status).toBe(true);
    expect(merged.perms.view_project).toBe(true);
    expect(merged.perms.delete_task).toBeUndefined();
    expect(merged.roleIds).toEqual(["r-dev", "r-qa"]);
    expect(merged.roleName).toBe("Developer, QA / Tester");
  });

  it("field rules take the MOST permissive value", () => {
    const merged = mergeRoles([devRole, qaRole]);
    // QA's editable beats Dev's readonly
    expect(fieldRule(merged.fieldRules, "estHours")).toBe("editable");
    // unique fields survive
    expect(fieldRule(merged.fieldRules, "gitBranch")).toBe("editable");
    expect(fieldRule(merged.fieldRules, "feedback")).toBe("editable");
    // unset fields default to readonly
    expect(fieldRule(merged.fieldRules, "priority")).toBe("readonly");
  });

  it("mergeRoles never elevates a role that did not grant a perm", () => {
    const viewer = { id: "r-v", name: "Viewer", permissions: JSON.stringify({ view_project: true }), fieldRules: "{}" };
    const merged = mergeRoles([viewer]);
    expect(canDo(merged.perms, "create_task")).toBe(false);
    expect(canDo(merged.perms, "view_project")).toBe(true);
  });
});

describe("Designation is a label only (no permission effect)", () => {
  it("a designation never adds permissions — perms come only from roles", () => {
    // Simulate a user whose Designation says 'Project Manager' but whose only role is Viewer.
    const viewer = DEFAULT_ROLES["Viewer / Stakeholder"];
    const merged = mergeRoles([{ id: "r-v", name: "Viewer / Stakeholder", permissions: JSON.stringify(viewer.permissions), fieldRules: JSON.stringify(viewer.fieldRules) }]);
    expect(canDo(merged.perms, "delete_task")).toBe(false);
    expect(canDo(merged.perms, "create_task")).toBe(false);
    expect(canDo(merged.perms, "view_project")).toBe(true);
  });
});
