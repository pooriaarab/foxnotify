// Tests for the D and S rows in docs/failure-modes.md.
// Times use UTC: the TZ variable is set before the first Date call.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import {
  type NoticeEvent,
  type State,
  clear,
  decide,
  emptyState,
  flushDue,
  mute,
  parseRules,
  parseState,
  unmute,
} from "../src/index.js";

const at = (hhmm: string, day = 1) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 9, day, h, m);
};
const ev = (over: Partial<NoticeEvent> = {}): NoticeEvent => ({ kind: "task-stuck", taskId: "t1", title: "Book a table", ...over });
/** Run events in order and return the decisions and the last state. */
function run(events: [NoticeEvent, number][], rules = parseRules(), state: State = emptyState()) {
  const actions: string[] = [];
  for (const [event, now] of events) {
    const result = decide(state, event, rules, now);
    actions.push(result.decision.action);
    state = result.state;
  }
  return { actions, state };
}

describe("decisions", () => {
  const quiet = parseRules({ quietHours: { start: "22:00", end: "07:00" } });

  it("D1 holds a low-priority notice in quiet hours", () => {
    const r = decide(emptyState(), ev({ priority: "low" }), quiet, at("23:00"));
    expect(r.decision).toEqual({ action: "hold", reason: "quiet-hours" });
    expect(r.state.queue).toHaveLength(1);
  });

  it("D2 sends an urgent notice in quiet hours", () => {
    const r = decide(emptyState(), ev({ kind: "needs-approval", priority: "urgent" }), quiet, at("23:00"));
    expect(r.decision).toEqual({ action: "send" });
  });

  it("D3 shows held notices when quiet hours end", () => {
    const { state } = run([[ev({ taskId: "a" }), at("23:00")], [ev({ taskId: "b", kind: "needs-approval" }), at("02:00", 2)]], quiet);
    expect(state.flushAt).toBe(at("07:00", 2));
    expect(flushDue(state, quiet, at("06:59", 2)).notices).toHaveLength(0);
    const out = flushDue(state, quiet, at("07:00", 2));
    expect(out.notices.map((n) => n.taskId)).toEqual(["a", "b"]);
    expect(out.state.queue).toHaveLength(0);
    expect(out.state.flushAt).toBeNull();
  });

  it("D4 drops a repeat within the de-duplicate time, then sends it again", () => {
    const rules = parseRules({ dedupeMinutes: 10 });
    const { actions } = run([[ev(), at("12:00")], [ev(), at("12:05")], [ev(), at("12:11")]], rules);
    expect(actions).toEqual(["send", "drop", "send"]);
    const r = decide(emptyState(), ev({ key: "same" }), rules, at("12:00"));
    expect(decide(r.state, ev({ key: "same", taskId: "t2" }), rules, at("12:01")).decision).toEqual({ action: "drop", reason: "duplicate" });
  });

  it("D5 keeps one copy of a repeat that waits in the digest", () => {
    const { actions, state } = run([[ev({ kind: "task-done" }), at("12:00")], [ev({ kind: "task-done" }), at("12:01")]]);
    expect(actions).toEqual(["digest", "drop"]);
    expect(state.queue).toHaveLength(1);
  });

  it("D6 moves events over the rate limit to the digest", () => {
    const rules = parseRules({ rateLimit: { max: 2, perMinutes: 1 } });
    const events: [NoticeEvent, number][] = ["a", "b", "c", "d"].map((id, i) => [ev({ taskId: id }), at("12:00") + i * 1000]);
    const { actions, state } = run(events, rules);
    expect(actions).toEqual(["send", "send", "digest", "digest"]);
    expect(state.queue.map((n) => n.taskId)).toEqual(["c", "d"]);
    expect(decide(state, ev({ taskId: "e" }), rules, at("12:01") + 1000).decision).toEqual({ action: "send" });
  });

  it("D7 sends an urgent notice when the rate limit is full", () => {
    const rules = parseRules({ rateLimit: { max: 1, perMinutes: 1 } });
    const { actions } = run([[ev({ taskId: "a" }), at("12:00")], [ev({ taskId: "b", priority: "urgent" }), at("12:00")]], rules);
    expect(actions).toEqual(["send", "send"]);
  });

  it("D8 drops events from a muted task until unmute", () => {
    let state = mute(emptyState(), "t1");
    const r = decide(state, ev(), parseRules(), at("12:00"));
    expect(r.decision).toEqual({ action: "drop", reason: "muted" });
    state = unmute(r.state, "t1");
    expect(decide(state, ev(), parseRules(), at("12:00")).decision).toEqual({ action: "send" });
  });

  it("D9 sends low-priority notices together at the flush time", () => {
    const rules = parseRules({ digestMinutes: 30 });
    const { state } = run([[ev({ kind: "task-done", taskId: "a" }), at("12:00")], [ev({ kind: "schedule-missed", taskId: "b" }), at("12:10")]], rules);
    expect(state.flushAt).toBe(at("12:30"));
    expect(flushDue(state, rules, at("12:29")).notices).toHaveLength(0);
    expect(flushDue(state, rules, at("12:30")).notices.map((n) => n.taskId)).toEqual(["a", "b"]);
  });

  it("D10 moves a flush in quiet hours to the end of quiet hours", () => {
    const rules = parseRules({ digestMinutes: 60, quietHours: { start: "22:00", end: "07:00" } });
    const { state } = run([[ev({ kind: "task-done" }), at("21:30")]], rules);
    expect(state.flushAt).toBe(at("22:30"));
    const out = flushDue(state, rules, at("22:30"));
    expect(out.notices).toHaveLength(0);
    expect(out.state.flushAt).toBe(at("07:00", 2));
  });

  it("D11 does not stay closed when the clock moves back", () => {
    const rules = parseRules({ rateLimit: { max: 1, perMinutes: 1 }, dedupeMinutes: 10 });
    const later = at("12:00", 2);
    const sent = decide(emptyState(), ev(), rules, later).state;
    const back = at("12:00");
    expect(decide(sent, ev({ taskId: "x" }), rules, back).decision.action).toBe("digest");
    const fixed = decide(sent, ev({ taskId: "x" }), rules, back).state;
    expect(decide(fixed, ev({ taskId: "y" }), rules, back + 61_000).decision).toEqual({ action: "send" });
    expect(decide(fixed, ev(), rules, back + 11 * 60_000).decision).toEqual({ action: "send" });
  });

  it("D12 clear removes a waiting copy and frees the key", () => {
    const { state } = run([[ev({ kind: "task-done" }), at("12:00")]]);
    const cleared = clear(state, "task-done:t1");
    expect(cleared.queue).toHaveLength(0);
    expect(cleared.flushAt).toBeNull();
    expect(decide(cleared, ev({ kind: "task-done" }), parseRules(), at("12:01")).decision.action).toBe("digest");
  });

  it("D13 clears a flush time when the queue is empty", () => {
    const state = { ...emptyState(), flushAt: at("12:00") };
    const out = flushDue(state, parseRules(), at("12:30"));
    expect(out.notices).toHaveLength(0);
    expect(out.state.flushAt).toBeNull();
  });
});

describe("state", () => {
  it("S1 starts empty from a corrupt or newer state", () => {
    expect(parseState(null)).toEqual(emptyState());
    expect(parseState({ v: 1, seen: 5 })).toEqual(emptyState());
    expect(parseState({ ...emptyState(), v: 2 })).toEqual(emptyState());
    const good = decide(emptyState(), ev(), parseRules(), at("12:00")).state;
    expect(parseState(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it("S2 removes old keys and send times and caps the queue", () => {
    const rules = parseRules({ dedupeMinutes: 10, rateLimit: { max: 4, perMinutes: 1 } });
    const events: [NoticeEvent, number][] = Array.from({ length: 60 }, (_, i) => [ev({ kind: "task-done", taskId: `t${i}` }), at("12:00") + i]);
    const { state } = run(events, rules);
    expect(state.queue).toHaveLength(50);
    expect(state.queue[0]?.taskId).toBe("t10");
    expect(state.dropped).toBe(10);
    const later = decide(state, ev({ taskId: "new" }), rules, at("13:00")).state;
    expect(Object.keys(later.seen)).toEqual(["task-stuck:new"]);
    expect(later.sent).toEqual([at("13:00")]);
    expect(flushDue(state, rules, at("13:00")).dropped).toBe(10);
  });

  it("S3 does not change the caller's state", () => {
    const state = emptyState();
    const copy = structuredClone(state);
    decide(state, ev(), parseRules(), at("12:00"));
    decide(state, ev({ kind: "task-done" }), parseRules(), at("12:00"));
    expect(state).toEqual(copy);
  });
});
