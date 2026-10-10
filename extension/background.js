// The demo's event page. It runs the foxnotify notifier and a fake agent
// that emits events on request. Firefox unloads this page when it is idle;
// the notifier keeps its state in storage.local, so clicks and digests work
// after a wake.
import { createNotifier, previewWebhook, webhookChannel } from "../src/index.ts";

const store = browser.storage.local;
const get = async (key, fallback) => (await store.get(key))[key] ?? fallback;

// The webhook settings can change at any time, so read them on each send.
const webhook = {
  name: "webhook",
  async send(message) {
    const config = await get("demo:webhook", null);
    if (config?.enabled) await webhookChannel(config).send(message);
  },
};

// Make the notifier in the first turn of the script, so its click and alarm
// listeners exist on every wake.
const notifier = createNotifier({
  browser,
  storage: store,
  channels: [webhook],
  fallbackUrl: "approvals.html",
  rules: { quietHours: null },
});

// Count page loads, so you (and the E2E test) can see each unload and wake.
get("demo:boots", []).then((boots) => store.set({ "demo:boots": [...boots, Date.now()].slice(-20) }));

const SAMPLE = { "needs-approval": "Send the form on the shop page", "needs-sign-in": "Sign in to the shop" };

/** The fake agent: start a task in a tab, then emit events for it. */
async function emit({ taskId, kind, priority, reason }) {
  const tasks = await get("demo:tasks", {});
  const task = tasks[taskId];
  if (!task) throw new Error(`No task ${taskId}`);
  // An approval opens the approvals page. Other notices focus the task tab.
  const approvals = browser.runtime.getURL(`approvals.html#${taskId}`);
  const target = kind === "needs-approval" ? { url: approvals } : { tabId: task.tabId };
  if (kind === "needs-approval") {
    const pending = await get("demo:approvals", {});
    pending[taskId] = { taskId, title: task.title, action: SAMPLE[kind], state: "pending" };
    await store.set({ "demo:approvals": pending });
  }
  // The event carries the title and ids only. Page text never goes in.
  return notifier.notify({ kind, taskId, title: task.title, priority: priority || undefined, reason, target });
}

const handlers = {
  async "agent:start"({ title, url }) {
    const tab = await browser.tabs.create({ url, active: false });
    const tasks = await get("demo:tasks", {});
    const taskId = `t${Object.keys(tasks).length + 1}`;
    tasks[taskId] = { taskId, title, tabId: tab.id };
    await store.set({ "demo:tasks": tasks });
    return tasks[taskId];
  },
  "agent:emit": emit,
  "agent:list": async () => ({ tasks: await get("demo:tasks", {}), state: await notifier.state() }),
  "agent:mute": ({ taskId, muted }) => (muted ? notifier.mute(taskId) : notifier.unmute(taskId)),
  "approvals:list": () => get("demo:approvals", {}),
  async "approvals:answer"({ taskId, decision }) {
    const pending = await get("demo:approvals", {});
    if (pending[taskId]) pending[taskId].state = decision;
    await store.set({ "demo:approvals": pending });
    await notifier.clear(`needs-approval:${taskId}`);
    return pending[taskId];
  },
  "settings:get": async () => ({ rules: await notifier.getRules(), webhook: await get("demo:webhook", null) }),
  async "settings:save"({ rules, webhook: config }) {
    await notifier.setRules(rules);
    if (config) previewWebhook(config);
    await store.set({ "demo:webhook": config });
    return { ok: true };
  },
  "settings:preview": ({ webhook: config }) => previewWebhook(config),
};

browser.runtime.onMessage.addListener((message) => {
  const handler = handlers[message?.type];
  if (!handler) return undefined;
  return Promise.resolve(handler(message)).then(
    (value) => ({ ok: true, value: value ?? null }),
    (error) => ({ ok: false, error: error.message }),
  );
});
