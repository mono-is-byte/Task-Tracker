import { EventEmitter } from "events";

export interface ProjectEvent {
  seq: number;
  projectId: string;
  type: string;
  payload: unknown;
  at: number;
}

/** Change request Step 5: server-wide events (sidebar list refresh without reload). */
export interface GlobalEvent {
  seq: number;
  type: string;
  payload: unknown;
  at: number;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(200);
let seq = 0;

/** In-process pub/sub for realtime updates (single-process self-hosted scale). */
export function publish(projectId: string, type: string, payload: unknown): ProjectEvent {
  const evt: ProjectEvent = { seq: ++seq, projectId, type, payload, at: Date.now() };
  emitter.emit(`project:${projectId}`, evt);
  emitter.emit("project:*", evt);
  return evt;
}

export function subscribe(projectId: string, cb: (e: ProjectEvent) => void): () => void {
  const key = `project:${projectId}`;
  emitter.on(key, cb);
  return () => emitter.off(key, cb);
}

/**
 * Step 5: the global (not project-scoped) stream. Published when a project
 * moves between the active and Completed lists so the sidebar can refresh
 * itself without a full page reload.
 */
export function publishGlobal(type: string, payload: unknown): GlobalEvent {
  const evt: GlobalEvent = { seq: ++seq, type, payload, at: Date.now() };
  emitter.emit("global", evt);
  return evt;
}

export function subscribeGlobal(cb: (e: GlobalEvent) => void): () => void {
  emitter.on("global", cb);
  return () => emitter.off("global", cb);
}

export function currentSeq(): number {
  return seq;
}
