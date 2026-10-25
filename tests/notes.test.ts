import { describe, it, expect } from "vitest";
import { buildTaskNotes, noteText, notesAsLines } from "../src/lib/notes";

const base = { author: { name: "Ann", deletedAt: null } };

describe("task notes: solved marker", () => {
  it("keeps numbering stable and exposes solved as a flag, not as body text", () => {
    const notes = buildTaskNotes([
      { id: "b", kind: "remark", body: "second", createdAt: "2026-10-01T10:01:00Z", solvedAt: "2026-10-02T09:00:00Z", ...base },
      { id: "a", kind: "comment", body: "first", createdAt: "2026-10-01T10:00:00Z", solvedAt: null, ...base },
    ]);
    expect(notes.map((n) => n.text)).toEqual(["first", "second"]);
    expect(notes.map((n) => n.n)).toEqual([1, 2]);
    expect(notes.map((n) => n.solved)).toEqual([false, true]);
  });

  it("adds ' (solved)' only for display helpers, never to the editable text", () => {
    const [open, solved] = buildTaskNotes([
      { id: "a", kind: "comment", body: "open one", createdAt: "2026-10-01T10:00:00Z", ...base },
      { id: "b", kind: "feedback", body: "done one", createdAt: "2026-10-01T10:01:00Z", solvedAt: "2026-10-02T09:00:00Z", ...base },
    ]);
    expect(noteText(open)).toBe("open one");
    expect(noteText(solved)).toBe("done one (solved)");
    expect(solved.text).toBe("done one");
    expect(notesAsLines([open, solved])).toEqual(["1. open one", "2. done one (solved)"]);
  });
});
