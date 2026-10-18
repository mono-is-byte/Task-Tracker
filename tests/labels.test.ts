import { describe, expect, it } from "vitest";
import { labelKey, memberLabel, rolesWithoutDesignation, userOptionLabel } from "../src/lib/memberLabel";

/**
 * The user-picker label contract (item 2): "Name - Designation", designation
 * resolved from Roles & Permissions, no duplicate titles, no placeholder text.
 */
describe("memberLabel — 'Name - Designation'", () => {
  it("shows the designation after the name", () => {
    expect(memberLabel({ name: "Monowarul Islam", designationName: "Project Manager" }))
      .toBe("Monowarul Islam - Project Manager");
  });

  it("falls back to project role names when the user has no designation", () => {
    expect(memberLabel({ name: "Rahim Ahmed", roleNames: ["Developer"] })).toBe("Rahim Ahmed - Developer");
    expect(memberLabel({ name: "Rahim Ahmed", roleNames: ["Developer", "QA / Tester"] }))
      .toBe("Rahim Ahmed - Developer, QA / Tester");
    expect(memberLabel({ name: "Rahim Ahmed", roleName: "Developer" })).toBe("Rahim Ahmed - Developer");
  });

  it("never repeats a project role that is the same as the designation (casing/whitespace tolerated)", () => {
    // The reported duplicate: "Md. Saju Ahmed - Developer (Developer)".
    expect(memberLabel({
      name: "Md. Saju Ahmed",
      designationName: "Developer",
      roleNames: ["developer", " Developer "],
      roleName: "Developer",
    })).toBe("Md. Saju Ahmed - Developer");
  });

  it("collapses duplicate project roles within the fallback list", () => {
    expect(memberLabel({ name: "X", roleNames: ["Developer", "developer ", "developer"] }))
      .toBe("X - Developer");
  });

  it("normalizes inner whitespace and trims around the separator", () => {
    expect(memberLabel({ name: "Karim Hasan", designationName: "  Project   Manager " }))
      .toBe("Karim Hasan - Project Manager");
  });

  it("falls back to the bare name — never 'undefined'/'null' text", () => {
    expect(memberLabel({ name: "No Title" })).toBe("No Title");
    expect(memberLabel({ name: "No Title", designationName: null, roleNames: [] })).toBe("No Title");
    expect(memberLabel({ name: "No Title", designationName: "   ", roleNames: ["  "] })).toBe("No Title");
  });

  it("keeps users with the same designation distinct — one label per person", () => {
    const rows = [
      { userId: "u1", name: "Monowarul Islam", designationName: "Project Manager" },
      { userId: "u2", name: "Abdul Karim", designationName: "Project Manager" },
      { userId: "u3", name: "Nusrat Jahan", designationName: "Developer" },
    ];
    const labels = rows.map((m) => memberLabel(m));
    expect(labels).toEqual([
      "Monowarul Islam - Project Manager",
      "Abdul Karim - Project Manager",
      "Nusrat Jahan - Developer",
    ]);
    expect(new Set(labels).size).toBe(rows.length);
  });
});

describe("userOptionLabel — picker variant", () => {
  it("appends '(inactive)' for deactivated accounts only", () => {
    expect(userOptionLabel({ name: "A", designationName: "QA", active: false })).toBe("A - QA (inactive)");
    expect(userOptionLabel({ name: "A", designationName: "QA", active: true })).toBe("A - QA");
    expect(userOptionLabel({ name: "A", designationName: "QA" })).toBe("A - QA");
  });
});

describe("rolesWithoutDesignation — chip de-duplication", () => {
  it("drops role names that merely repeat the designation", () => {
    expect(rolesWithoutDesignation(["Developer", "QA"], "developer")).toEqual(["QA"]);
    expect(rolesWithoutDesignation([" Developer "], "Developer")).toEqual([]);
    expect(rolesWithoutDesignation(["Developer"], null)).toEqual(["Developer"]);
  });

  it("labelKey folds case and whitespace", () => {
    expect(labelKey("  Project   Manager ")).toBe("project manager");
    expect(labelKey("QA")).toBe(labelKey(" qa "));
  });
});
