/**
 * PHASE 11.3 — one numbered list of every task note.
 *
 * Comments, remarks and feedback are all rows of `Comment.kind` (there are no
 * separate Task text columns). Board cards, the Table column, the task drawer
 * and the Excel export all call this helper, so the numbers always match.
 *
 * Order = createdAt ascending (the DB rows all have a timestamp). Ties are
 * broken comment → remark → feedback, then by id so the order is stable.
 */

export const NOTE_KINDS = ["comment", "remark", "feedback"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

const KIND_RANK: Record<NoteKind, number> = { comment: 0, remark: 1, feedback: 2 };

export interface NoteSource {
  id: string;
  kind: string;
  body: string;
  createdAt: string | Date;
  author?: { id?: string; name?: string; deletedAt?: string | Date | null } | null;
}

export interface TaskNote {
  id: string;
  /** 1-based position shared by Board, Table and Task detail. */
  n: number;
  type: NoteKind;
  text: string;
  author: string;
  authorDeleted: boolean;
  createdAt: string;
}

function isNoteKind(kind: string): kind is NoteKind {
  return (NOTE_KINDS as readonly string[]).includes(kind);
}

export function buildTaskNotes(comments: NoteSource[] | null | undefined): TaskNote[] {
  const time = (v: string | Date) => {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  return (comments ?? [])
    .filter((c) => isNoteKind(c.kind) && typeof c.body === "string" && c.body.trim() !== "")
    .slice()
    .sort((a, b) => {
      const dt = time(a.createdAt) - time(b.createdAt);
      if (dt !== 0) return dt;
      const kind = KIND_RANK[a.kind as NoteKind] - KIND_RANK[b.kind as NoteKind];
      if (kind !== 0) return kind;
      return a.id.localeCompare(b.id);
    })
    .map((c, i) => ({
      id: c.id,
      n: i + 1,
      type: c.kind as NoteKind,
      text: c.body,
      author: c.author?.name ?? "Unknown",
      authorDeleted: Boolean(c.author?.deletedAt),
      createdAt: new Date(c.createdAt).toISOString(),
    }));
}

/** "1. text" / "2. text" lines for the export cell and tooltips. */
export function notesAsLines(notes: TaskNote[]): string[] {
  return notes.map((notee) => `${notee.n}. ${notee.text.replace(/\s*\n\s*/g, " ")}`);
}

/** Visible notes after the role's field rules (hidden remarks/feedback vanish). */
export function filterVisibleNotes<T extends { kind: string }>(
  comments: T[] | null | undefined,
  rules: Record<string, string> | null | undefined,
): T[] {
  return (comments ?? []).filter((c) => {
    if (c.kind !== "remark" && c.kind !== "feedback") return true;
    return rules?.[c.kind] !== "hidden";
  });
}
