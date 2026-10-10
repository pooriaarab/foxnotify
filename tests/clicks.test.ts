// Tests for the C rows in docs/failure-modes.md.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { createNotifier } from "../src/index.js";
import { fakeBrowser, memoryStorage } from "./fake-browser.js";

const NOON = Date.UTC(2026, 9, 1, 12, 0);

function setup(options: { rules?: Parameters<typeof createNotifier>[0]["rules"] } = {}) {
  const { browser, fake } = fakeBrowser();
  const storage = memoryStorage();
  const clock = { now: NOON };
  const make = () => createNotifier({ browser, storage, now: () => clock.now, fallbackUrl: "approvals.html", ...options });
  return { browser, fake, storage, clock, make, notifier: make() };
}

const approval = { kind: "needs-approval" as const, taskId: "t1", title: "Send the invoice", target: { tabId: 1 } };

describe("clicks", () => {
  it("C1 routes a click after the event page unloads", async () => {
    const { fake, make, notifier } = setup();
    await notifier.notify(approval);
    fake.unload();
    const next = make();
    await next.ready;
    expect(fake.focusedWindow).toBe(2);
    await fake.click("fnt:needs-approval:t1");
    expect(fake.tabs[0]?.active).toBe(true);
    expect(fake.focusedWindow).toBe(1);
  });

  it("C2 opens the target URL, else the fallback page, when the tab is gone", async () => {
    const { fake, notifier } = setup();
    await notifier.notify({ ...approval, target: { tabId: 99, url: "moz-extension://test/approvals.html#t1" } });
    expect(await notifier.click("fnt:needs-approval:t1")).toBe("url");
    expect(fake.created).toEqual(["moz-extension://test/approvals.html#t1"]);
    await notifier.notify({ ...approval, taskId: "t2", target: { tabId: 99 } });
    expect(await notifier.click("fnt:needs-approval:t2")).toBe("url");
    expect(fake.created.at(-1)).toBe("moz-extension://test/approvals.html");
  });

  it("C2 focuses a tab that already shows the target URL", async () => {
    const { fake, notifier } = setup();
    await notifier.notify({ ...approval, target: { url: "http://127.0.0.1/b" } });
    expect(await notifier.click("fnt:needs-approval:t1")).toBe("tab");
    expect(fake.created).toEqual([]);
    expect(fake.focusedWindow).toBe(2);
  });

  it("C3 makes the tab active without a windows API", async () => {
    const { browser, fake, notifier } = setup();
    browser.windows = undefined;
    fake.tabs[0]!.active = false;
    fake.tabs.push({ id: 3, windowId: 1, active: true, url: "http://127.0.0.1/c" });
    await notifier.notify(approval);
    expect(await notifier.click("fnt:needs-approval:t1")).toBe("tab");
    expect(fake.tabs[0]?.active).toBe(true);
    expect(fake.tabs[2]?.active).toBe(false);
  });

  it("C5 ignores a notification id that it did not make", async () => {
    const { fake, notifier } = setup();
    expect(await notifier.click("other-id")).toBe("ignored");
    expect(await notifier.click("fnt:needs-approval:none")).toBe("ignored");
    expect(fake.created).toEqual([]);
  });

  it("C6 removes click entries on click and close and keeps 50", async () => {
    const { fake, storage, notifier } = setup({ rules: { rateLimit: { max: 100, perMinutes: 1 } } });
    for (let i = 0; i < 60; i++) await notifier.notify({ ...approval, taskId: `t${i}` });
    const clicks = () => Object.keys(storage.data.get("fnt:clicks") as object);
    expect(clicks()).toHaveLength(50);
    expect(clicks()).not.toContain("fnt:needs-approval:t0");
    await fake.click("fnt:needs-approval:t59");
    await fake.close("fnt:needs-approval:t58");
    expect(clicks()).toHaveLength(48);
  });

  it("C7 shows a digest of one as that notice, with its target", async () => {
    const { fake, clock, notifier } = setup();
    await notifier.notify({ ...approval, kind: "task-done", target: { tabId: 1 } });
    clock.now = NOON + 60 * 60_000;
    const out = await notifier.flush();
    expect(out.notices).toHaveLength(1);
    expect([...fake.shown.keys()]).toEqual(["fnt:task-done:t1"]);
    expect(await notifier.click("fnt:task-done:t1")).toBe("tab");
  });

  it("C8 keeps the target of a notice that replaces an old one", async () => {
    const { browser, fake, notifier } = setup({ rules: { dedupeMinutes: 0 } });
    const create = browser.notifications.create;
    // Firefox closes the old notice when a new one takes its id.
    browser.notifications.create = async (id, opts) => {
      const replacing = fake.shown.has(id);
      const out = await create(id, opts);
      if (replacing) await fake.close(id);
      return out;
    };
    await notifier.notify(approval);
    await notifier.notify(approval);
    expect(await notifier.click("fnt:needs-approval:t1")).toBe("tab");
  });
});
