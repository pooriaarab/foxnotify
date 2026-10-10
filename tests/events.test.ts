// Tests for the E and R rows in docs/failure-modes.md.
// Times use UTC: the TZ variable is set before the first Date call.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { type NoticeEvent, FoxnotifyError, cleanTitle, isQuiet, parseRules, toNotice } from "../src/index.js";

const at = (hhmm: string, day = 1) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Date.UTC(2026, 9, day, h, m);
};
const ev = (over: Partial<NoticeEvent> = {}): NoticeEvent => ({ kind: "task-stuck", taskId: "t1", title: "Book a table", ...over });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof FoxnotifyError ? error.code : `other: ${String(error)}`;
  }
  return "no error";
};

describe("events and text", () => {
  it("E1 refuses an unknown kind, an empty task id or an empty title", () => {
    const rules = parseRules();
    expect(code(() => toNotice(ev({ kind: "nope" as never }), rules, 0))).toBe("invalid-event");
    expect(code(() => toNotice(ev({ taskId: "" }), rules, 0))).toBe("invalid-event");
    expect(code(() => toNotice(ev({ title: "  \n " }), rules, 0))).toBe("invalid-event");
  });

  it("E2 hides secrets in the title", () => {
    expect(cleanTitle("Log in with code 482913")).toBe("Log in with code [hidden]");
    expect(cleanTitle("Pay with 4242 4242 4242 4242 now")).toBe("Pay with [hidden] now");
    expect(cleanTitle("Use key sk-ant-api03-AbCdEf1234567890xyz")).toBe("Use key [hidden]");
    expect(cleanTitle("Email sam@example.com about rent")).toBe("Email [hidden] about rent");
    expect(cleanTitle("Open https://shop.example.com/cart?token=abc123&x=1 and pay")).toBe("Open shop.example.com and pay");
    expect(cleanTitle("Book a table for 4 at 19:30")).toBe("Book a table for 4 at 19:30");
  });

  it("E3 makes one short line", () => {
    expect(cleanTitle("Book\na\ttable\u0007 now")).toBe("Book a table now");
    const long = cleanTitle("word ".repeat(100));
    expect(long.length).toBe(80);
    expect(long.endsWith("…")).toBe(true);
  });

  it("E4 refuses a priority that does not exist", () => {
    expect(code(() => toNotice(ev({ priority: "max" as never }), parseRules(), 0))).toBe("invalid-event");
  });

  it("E5 refuses a key that is not a non-empty string", () => {
    expect(code(() => toNotice(ev({ key: 123 as never }), parseRules(), 0))).toBe("invalid-event");
    expect(code(() => toNotice(ev({ key: "" }), parseRules(), 0))).toBe("invalid-event");
    expect(toNotice(ev({ key: "mine" }), parseRules(), 0).key).toBe("mine");
  });
});

describe("rules", () => {
  it("R1 refuses bad rules", () => {
    expect(code(() => parseRules({ quietHours: { start: "25:00", end: "07:00" } }))).toBe("invalid-rules");
    expect(code(() => parseRules({ quietHours: { start: "22:00", end: "7" } }))).toBe("invalid-rules");
    expect(code(() => parseRules({ quietHours: { start: "22:00", end: "07:00", bypass: "max" as never } }))).toBe("invalid-rules");
    expect(code(() => parseRules({ priorities: { "task-done": "max" as never } }))).toBe("invalid-rules");
    expect(code(() => parseRules({ rateLimit: { max: 0, perMinutes: 1 } }))).toBe("invalid-rules");
    expect(code(() => parseRules({ digestMinutes: 0 }))).toBe("invalid-rules");
    expect(code(() => parseRules({ dedupeMinutes: -1 }))).toBe("invalid-rules");
  });

  it("R2 judges quiet hours that cross midnight", () => {
    const rules = parseRules({ quietHours: { start: "22:00", end: "07:00" } });
    expect(isQuiet(rules, at("23:30"))).toBe(true);
    expect(isQuiet(rules, at("06:59"))).toBe(true);
    expect(isQuiet(rules, at("07:00"))).toBe(false);
    expect(isQuiet(rules, at("21:59"))).toBe(false);
    expect(isQuiet(rules, at("22:00"))).toBe(true);
  });

  it("R3 has no quiet hours when start equals end", () => {
    const rules = parseRules({ quietHours: { start: "22:00", end: "22:00" } });
    expect(isQuiet(rules, at("22:00"))).toBe(false);
    expect(isQuiet(rules, at("03:00"))).toBe(false);
  });

  it("R4 takes the event priority, then the rules, then the kind default", () => {
    const rules = parseRules({ priorities: { "task-done": "high" } });
    expect(toNotice(ev({ kind: "task-done" }), rules, 0).priority).toBe("high");
    expect(toNotice(ev({ kind: "task-done", priority: "urgent" }), rules, 0).priority).toBe("urgent");
    expect(toNotice(ev({ kind: "task-done" }), parseRules(), 0).priority).toBe("low");
    expect(toNotice(ev({ kind: "needs-approval" }), parseRules(), 0).priority).toBe("high");
  });
});
