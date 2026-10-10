// Tests for the N rows in docs/failure-modes.md.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { type Channel, type Message, FoxnotifyError, createNotifier } from "../src/index.js";
import { fakeBrowser, memoryStorage } from "./fake-browser.js";

const NOON = Date.UTC(2026, 9, 1, 12, 0);

function setup(options: { channels?: Channel[]; rules?: Parameters<typeof createNotifier>[0]["rules"] } = {}) {
  const { browser, fake } = fakeBrowser();
  const storage = memoryStorage();
  const clock = { now: NOON };
  const make = () => createNotifier({ browser, storage, now: () => clock.now, ...options });
  return { browser, fake, storage, clock, make, notifier: make() };
}

const approval = { kind: "needs-approval" as const, taskId: "t1", title: "Send the invoice", target: { tabId: 1 } };

function recorder(name = "rec", fail = false) {
  const got: Message[] = [];
  const channel: Channel = {
    name,
    send: async (message) => {
      if (fail) throw new Error("down");
      got.push(message);
    },
  };
  return { got, channel };
}

describe("notifier", () => {
  it("N1 runs calls at the same time one after the other", async () => {
    const { notifier } = setup({ rules: { rateLimit: { max: 4, perMinutes: 1 } } });
    const results = await Promise.all(["a", "b", "c", "d", "e"].map((id) => notifier.notify({ ...approval, taskId: id })));
    expect(results.map((r) => r.decision.action)).toEqual(["send", "send", "send", "send", "digest"]);
    expect((await notifier.state()).sent).toHaveLength(4);
  });

  it("N2 sets the flush alarm again on load and flushes a past flush time", async () => {
    const { fake, clock, make, notifier } = setup({ rules: { digestMinutes: 30 } });
    await notifier.notify({ ...approval, kind: "task-done" });
    expect(fake.alarms.get("fnt:flush")).toBe(NOON + 30 * 60_000);
    fake.alarms.clear();
    fake.unload();
    await make().ready;
    expect(fake.alarms.get("fnt:flush")).toBe(NOON + 30 * 60_000);
    fake.alarms.clear();
    fake.unload();
    clock.now = NOON + 31 * 60_000;
    await make().ready;
    expect([...fake.shown.values()].map((n) => n.title)).toEqual(["Task done"]);
    expect(fake.alarms.has("fnt:flush")).toBe(false);
  });

  it("N2 shows the digest when the alarm fires", async () => {
    const { fake, clock, notifier } = setup({ rules: { digestMinutes: 30 } });
    await notifier.notify({ ...approval, kind: "task-done" });
    await notifier.notify({ ...approval, kind: "schedule-missed", taskId: "t2", title: "Check prices" });
    clock.now = NOON + 30 * 60_000;
    await fake.alarm("fnt:flush");
    const shown = [...fake.shown.values()];
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe("2 updates from your agent");
    expect(shown[0]?.message).toBe("Task done: Send the invoice\nSchedule missed: Check prices");
  });

  it("N3 keeps going when notifications.create throws", async () => {
    const rec = recorder();
    const { fake, notifier } = setup({ channels: [rec.channel] });
    fake.failCreate = true;
    const result = await notifier.notify(approval);
    expect(result.errors).toEqual([{ channel: "desktop", message: "notifications are off" }]);
    expect(result.delivered).toEqual(["rec"]);
    expect(rec.got).toHaveLength(1);
    expect(Object.keys((await notifier.state()).seen)).toEqual(["needs-approval:t1"]);
  });

  it("N4 keeps going when a channel throws", async () => {
    const bad = recorder("bad", true);
    const good = recorder("good");
    const { fake, notifier } = setup({ channels: [bad.channel, good.channel] });
    const result = await notifier.notify(approval);
    expect(result.delivered).toEqual(["desktop", "good"]);
    expect(result.errors).toEqual([{ channel: "bad", message: "down" }]);
    expect(fake.shown.size).toBe(1);
  });

  it("N5 clear closes the notice and removes a queued copy", async () => {
    const { fake, notifier } = setup();
    await notifier.notify(approval);
    await notifier.notify({ ...approval, kind: "task-done", taskId: "t9" });
    await notifier.clear("needs-approval:t1");
    await notifier.clear("task-done:t9");
    expect(fake.shown.size).toBe(0);
    expect((await notifier.state()).queue).toHaveLength(0);
    expect(fake.alarms.has("fnt:flush")).toBe(false);
  });

  it("N6 saves rules, reads them on each notify, and keeps them on bad input", async () => {
    const { fake, make, notifier } = setup();
    await notifier.setRules({ priorities: { "task-done": "high" } });
    fake.unload();
    const next = make();
    expect((await next.notify({ ...approval, kind: "task-done" })).decision.action).toBe("send");
    await expect(next.setRules({ digestMinutes: 0 })).rejects.toBeInstanceOf(FoxnotifyError);
    expect(await next.getRules()).toEqual({ priorities: { "task-done": "high" } });
  });

  it("N7 builds the text from the kind and the cleaned title only", async () => {
    const { fake, notifier } = setup();
    const event = { ...approval, title: "Pay rent\ncode 551234", detail: "PAGE TEXT: secret" };
    await notifier.notify(event as typeof approval);
    expect(fake.shown.get("fnt:needs-approval:t1")).toEqual({
      title: "Approval needed",
      message: "Pay rent code [hidden]: an action waits for you. Click to review it.",
    });
  });

  it("N8 closes a notice that was cleared while it was on its way", async () => {
    const { fake, notifier } = setup();
    const sending = notifier.notify(approval);
    await notifier.clear("needs-approval:t1");
    await sending;
    expect(fake.shown.size).toBe(0);
  });

  it("refuses a bad event and keeps the state", async () => {
    const { notifier } = setup();
    await expect(notifier.notify({ ...approval, kind: "nope" as never })).rejects.toMatchObject({ code: "invalid-event" });
    expect((await notifier.state()).seen).toEqual({});
  });
});
