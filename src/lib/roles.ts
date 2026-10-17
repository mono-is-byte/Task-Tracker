import { ACTIONS, type Action, type FieldRule } from "./permissions";

export function sanitizePerms(input: Record<string, boolean>): Record<Action, boolean> {
  const out: Record<string, boolean> = {};
  for (const a of ACTIONS) out[a] = input[a] === true;
  return out as Record<Action, boolean>;
}

export function sanitizeFields(input: Record<string, string>): Record<string, FieldRule> {
  const out: Record<string, FieldRule> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === "hidden" || v === "readonly" || v === "editable") out[k] = v;
  }
  return out;
}
