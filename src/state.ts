import { KINDS, type Notice, type NoticeEvent, type NoticeKind, type Rules, isNum, isPriority, isQuiet, isRecord, quietEndsAt, rank, toNotice } from "./rules.js";

export type Decision =
  | { action: "send" }
  | { action: "digest"; reason: "low-priority" | "rate-limit" }
  | { action: "hold"; reason: "quiet-hours" }
  | { action: "drop"; reason: "duplicate" | "muted" };

export interface State {
  v: 1;
  /** Key to the time it was last sent or queued. */
  seen: Record<string, number>;
  /** Times of notices sent at once, for the rate limit. */
  sent: number[];
  /** Held and digest notices, oldest first. */
  queue: Notice[];
  /** Notices that the queue cap dropped since the last flush. */
  dropped: number;
  muted: string[];
  /** When the queue shows next, or null for an empty queue. */
  flushAt: number | null;
}

const QUEUE_MAX = 50;

export const emptyState = (): State => ({ v: 1, seen: {}, sent: [], queue: [], dropped: 0, muted: [], flushAt: null });


/** Read a stored state. A corrupt or newer state gives an empty state. */
export function parseState(value: unknown): State {
  if (!isRecord(value) || value.v !== 1) return emptyState();
  const { seen, sent, queue, dropped, muted, flushAt } = value;
  const ok =
    isRecord(seen) &&
    Object.values(seen).every(isNum) &&
    Array.isArray(sent) &&
    sent.every(isNum) &&
    Array.isArray(queue) &&
    queue.every((n) => isRecord(n) && typeof n.key === "string" && KINDS.includes(n.kind as NoticeKind) && isPriority(n.priority) && isNum(n.at)) &&
    isNum(dropped) &&
    Array.isArray(muted) &&
    muted.every((m) => typeof m === "string") &&
    (flushAt === null || isNum(flushAt));
  return ok ? (structuredClone(value) as unknown as State) : emptyState();
}

/** Remove old keys and send times. A time in the future (the clock moved back) counts as now. */
function prune(state: State, rules: Rules, now: number): void {
  for (const [key, t] of Object.entries(state.seen)) {
    const time = Math.min(t, now);
    if (now - time >= rules.dedupeMs) delete state.seen[key];
    else state.seen[key] = time;
  }
  state.sent = state.sent.map((t) => Math.min(t, now)).filter((t) => now - t < rules.rateLimit.perMs);
}

function enqueue(state: State, notice: Notice, flushAt: number): void {
  state.queue.push(notice);
  const extra = state.queue.length - QUEUE_MAX;
  if (extra > 0) {
    state.queue.splice(0, extra);
    state.dropped += extra;
  }
  state.flushAt = state.flushAt === null ? flushAt : Math.min(state.flushAt, flushAt);
}

/** Decide what to do with one event. Returns a new state; the given one does not change. */
export function decide(given: State, event: NoticeEvent, rules: Rules, now: number): { decision: Decision; notice: Notice; state: State } {
  const notice = toNotice(event, rules, now);
  const state = structuredClone(given);
  prune(state, rules, now);
  const done = (decision: Decision) => ({ decision, notice, state });
  if (state.muted.includes(notice.taskId)) return done({ action: "drop", reason: "muted" });
  if (notice.key in state.seen || state.queue.some((n) => n.key === notice.key)) return done({ action: "drop", reason: "duplicate" });
  state.seen[notice.key] = now;
  const urgent = notice.priority === "urgent";
  if (isQuiet(rules, now) && rank(notice.priority) < rank(rules.quietHours?.bypass ?? "urgent")) {
    enqueue(state, notice, quietEndsAt(rules, now) ?? now);
    return done({ action: "hold", reason: "quiet-hours" });
  }
  if (notice.priority === "low") {
    enqueue(state, notice, now + rules.digestMs);
    return done({ action: "digest", reason: "low-priority" });
  }
  if (!urgent && state.sent.length >= rules.rateLimit.max) {
    enqueue(state, notice, now + rules.digestMs);
    return done({ action: "digest", reason: "rate-limit" });
  }
  state.sent.push(now);
  return done({ action: "send" });
}

/**
 * Take the queued notices when the flush time has come. During quiet hours
 * nothing comes out, and the flush time moves to the end of quiet hours.
 */
export function flushDue(given: State, rules: Rules, now: number): { notices: Notice[]; dropped: number; state: State } {
  const state = structuredClone(given);
  if (state.queue.length === 0) state.flushAt = null;
  if (state.flushAt === null || now < state.flushAt) return { notices: [], dropped: 0, state };
  if (isQuiet(rules, now)) {
    state.flushAt = quietEndsAt(rules, now);
    return { notices: [], dropped: 0, state };
  }
  const notices = state.queue;
  const dropped = state.dropped;
  state.queue = [];
  state.dropped = 0;
  state.flushAt = null;
  return { notices, dropped, state };
}

/** Forget a key: remove its waiting copy, so the key can notify again. */
export function clear(given: State, key: string): State {
  const state = structuredClone(given);
  delete state.seen[key];
  state.queue = state.queue.filter((n) => n.key !== key);
  if (state.queue.length === 0) state.flushAt = null;
  return state;
}

export function mute(given: State, taskId: string): State {
  const state = structuredClone(given);
  if (!state.muted.includes(taskId)) state.muted.push(taskId);
  return state;
}

export function unmute(given: State, taskId: string): State {
  const state = structuredClone(given);
  state.muted = state.muted.filter((id) => id !== taskId);
  return state;
}
