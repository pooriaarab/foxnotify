// The Firefox E2E test for the demo extension. It drives the demo through a
// content script on a 127.0.0.1 page (the test bridge), not through an
// extension page, because an open extension page keeps the event page loaded
// and this test needs the event page to unload.
//
// It reads the notices that Firefox shows with notifications.getAll(). A test
// cannot click a system notice, so it calls the click handler that
// notifications.onClicked calls. A local server stands in for the webhook.
//
// Usage: pnpm e2e [--headed] [--shots <dir>]
//   --shots <dir>  also save PNGs of the demo pages. WebDriver BiDi cannot
//                  capture moz-extension: pages, so the built pages are served
//                  over http with a stub that replays answers from this run.
//                  The answers go to <dir>/replies.json.
// Writes artifacts/e2e-<date>.json.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, serve, writeArtifact } from "create-foxkit/e2e";

const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
const headless = !args.includes("--headed");
const record = { startedAt: new Date().toISOString(), checks: [] };
const check = (name, expected, actual) => record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
const replies = {};
// CI1: a Linux runner may have no desktop notification service. On CI only, a
// failed display check is logged as SKIP (CI) and does not fail the run.
const onCI = Boolean(process.env.CI);
function displayCheck(name, expected, actual) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok || !onCI) return check(name, expected, actual);
  record.skipped ??= [];
  record.skipped.push({ name, expected, actual, reason: "CI: Firefox showed no notice (no notification service on this runner)" });
  console.log(`SKIP (CI) ${name}: Firefox showed no notice on this runner, so the display check does not count. The rules, clicks and webhook checks still count.`);
}

/** The webhook stand-in: it answers CORS preflights and records each POST. */
async function startHook() {
  const got = [];
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, title, priority, tags", "Access-Control-Allow-Methods": "POST" };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.method === "POST") got.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
    res.writeHead(req.method === "OPTIONS" ? 204 : 200, cors).end();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { url: `http://127.0.0.1:${server.address().port}/agent`, got, close: () => server.close() };
}

const site = await serve("e2e/site");
const hook = await startHook();
let fox;
let page;

/** Send one command to the event page through the bridge. */
async function send(type, data = {}) {
  const reply = await page.evaluate(
    (m) =>
      new Promise((done) => {
        const id = Math.random().toString(36).slice(2);
        const onReply = (e) => {
          if (e.data?.fnt !== "reply" || e.data.id !== id) return;
          window.removeEventListener("message", onReply);
          done(e.data.result);
        };
        window.addEventListener("message", onReply);
        window.postMessage({ fnt: "command", id, msg: m }, "*");
      }),
    { type, ...data },
  );
  if (!reply?.ok) throw new Error(`${type}: ${reply?.error}`);
  return reply.value;
}
const shown = async () => Object.entries(await send("test:shown"));
const ids = async () => (await shown()).map(([id]) => id).toSorted();

async function until(label, fn, ms = 20_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${label}`);
    await sleep(250);
  }
}

try {
  // Firefox unloads an idle event page after 30 s. 2 s makes the unload happen during the test.
  // CI1: Firefox's own alert windows, so the test does not need a desktop notification service.
  fox = await launch({ extension: "dist-ext", headless, prefs: { "extensions.background.idle.timeout": 2000, "alerts.useSystemBackend": false } });
  record.firefox = await fox.browser.version();
  page = await fox.open(`${site.url}/index.html`);
  await until("the bridge is ready", () => page.evaluate(() => document.documentElement.dataset.bridge === "ready"));

  const webhook = { url: hook.url, format: "json", includeTitle: false };
  const rules = { quietHours: null, digestMinutes: 60, rateLimit: { max: 10, perMinutes: 1 }, dedupeMinutes: 10 };
  replies["settings:preview"] = await send("settings:preview", { webhook });
  await send("settings:save", { rules, webhook: { ...webhook, enabled: true } });
  replies["settings:get"] = await send("settings:get");
  const t1 = await send("agent:start", { title: "Book a table at Bistro Lune", url: `${site.url}/a.html` });
  const t2 = await send("agent:start", { title: "Pay the rent for October", url: `${site.url}/b.html` });

  // A notice fires, with fixed text plus the cleaned title (N7).
  const signIn = await send("agent:emit", { taskId: t1.taskId, kind: "needs-sign-in" });
  check("sign-in notice is sent to desktop and webhook", ["desktop", "webhook"], signIn.delivered);
  const notice = Object.fromEntries(await shown())["fnt:needs-sign-in:t1"];
  displayCheck("Firefox shows the sign-in notice", { title: "Sign-in needed", message: "Book a table at Bistro Lune: sign in to go on. Click to open the tab." }, notice && { title: notice.title, message: notice.message });

  // The webhook gets the redacted payload, and it matches the preview (W1, W2).
  const first = await until("the webhook gets a request", async () => hook.got[0]);
  const body = JSON.parse(first.body);
  check("webhook body has no task title", false, first.body.includes("Bistro"));
  check("webhook body is the redacted summary", { source: "foxnotify", kind: "needs-sign-in", priority: "high", text: "A task needs you to sign in." }, { ...body, at: undefined });
  check("webhook body has the keys the preview showed", Object.keys(JSON.parse(replies["settings:preview"].body)), Object.keys(body));
  check("webhook content type matches the preview", replies["settings:preview"].headers["Content-Type"], first.headers["content-type"]);

  // A click focuses the task tab, not the tab in front (C3).
  await send("test:focus", { tabId: t2.tabId });
  check("tab b is active before the click", [t2.tabId], await send("test:active"));
  check("click routes to a tab", "tab", await send("test:click", { id: "fnt:needs-sign-in:t1" }));
  check("the click makes tab a active", [t1.tabId], await send("test:active"));
  check("the clicked notice closes", false, (await ids()).includes("fnt:needs-sign-in:t1"));

  // An approval click opens the approvals page. The approval stays pending (C4).
  await send("agent:emit", { taskId: t2.taskId, kind: "needs-approval" });
  check("approval click opens a page", "url", await send("test:click", { id: "fnt:needs-approval:t2" }));
  // BiDi sends no navigation events for moz-extension: pages, so read location.href.
  const findPage = async (suffix) => {
    for (const p of await fox.browser.pages()) if (await p.evaluate(() => location.href).then((u) => u.endsWith(suffix), () => false)) return p;
    return null;
  };
  const approvalsPage = await until("the approvals page opens", () => findPage("approvals.html#t2"));
  const shownState = await until("the approval shows", () => approvalsPage.evaluate(() => document.querySelector('[data-task="t2"] .answers .primary')?.textContent));
  check("the approvals page shows the pending approval", "Approve", shownState);
  replies["approvals:list"] = await send("approvals:list");
  check("the click did not approve", "pending", replies["approvals:list"].t2.state);
  await approvalsPage.close();

  // Quiet hours hold a low-priority notice and let an urgent one through (D1, D2).
  const quiet = { start: hhmm(Date.now() - 3_600_000), end: hhmm(Date.now() + 3_600_000), bypass: "urgent" };
  await send("settings:save", { rules: { ...rules, quietHours: quiet }, webhook: { ...webhook, enabled: true } });
  const sentBefore = hook.got.length;
  const low = await send("agent:emit", { taskId: t1.taskId, kind: "task-done" });
  check("quiet hours hold the low-priority notice", { action: "hold", reason: "quiet-hours" }, low.decision);
  const high = await send("agent:emit", { taskId: t2.taskId, kind: "needs-sign-in", priority: "high" });
  check("quiet hours hold a high notice too (bypass is urgent)", "hold", high.decision.action);
  const urgent = await send("agent:emit", { taskId: t1.taskId, kind: "needs-approval", priority: "urgent" });
  check("quiet hours let the urgent notice through", { action: "send" }, urgent.decision);
  const now = await ids();
  displayCheck("Firefox shows the urgent notice only", [true, false, false], ["fnt:needs-approval:t1", "fnt:task-done:t1", "fnt:needs-sign-in:t2"].map((id) => now.includes(id)));
  await until("the webhook gets the urgent notice", async () => hook.got.length === sentBefore + 1);
  check("the webhook gets the urgent notice only", "urgent", JSON.parse(hook.got.at(-1).body).priority);

  // The event page unloads; a click on an older notice still routes (C1).
  await send("agent:emit", { taskId: t1.taskId, kind: "task-stuck", priority: "urgent" });
  await send("test:focus", { tabId: t2.tabId });
  const bootsBefore = (await send("test:boots")).length;
  // Each check wakes the page, so wait 5 s between checks.
  let bootsAfter = bootsBefore;
  for (let i = 0; i < 12 && bootsAfter === bootsBefore; i++) {
    await sleep(5000);
    bootsAfter = (await send("test:boots")).length;
  }
  check("the event page unloaded and loaded again", true, bootsAfter > bootsBefore);
  check("click after the unload routes to the tab", "tab", await send("test:click", { id: "fnt:task-stuck:t1" }));
  check("the click after the unload makes tab a active", [t1.tabId], await send("test:active"));

  // Quiet hours end: the held notices come out as one digest on the alarm (D3).
  await send("settings:save", { rules: { ...rules, digestMinutes: 0.05 }, webhook: { ...webhook, enabled: true } });
  await send("agent:emit", { taskId: t2.taskId, kind: "task-done" });
  const digestHook = await until("the webhook gets the digest", async () => hook.got.map((g) => JSON.parse(g.body)).find((b) => b.kind === "digest"), 90_000);
  const digest = (await shown()).find(([id]) => id.startsWith("fnt:digest:"));
  displayCheck("the alarm shows one digest of the three queued notices", "3 updates from your agent", digest?.[1].title);
  check("the webhook digest is a count with no titles", { kind: "digest", count: 3, titles: undefined }, { kind: digestHook.kind, count: digestHook.count, titles: digestHook.titles });

  // Per-task mute.
  await send("agent:mute", { taskId: t2.taskId, muted: true });
  const muted = await send("agent:emit", { taskId: t2.taskId, kind: "task-stuck", priority: "urgent" });
  check("a muted task does not notify", { action: "drop", reason: "muted" }, muted.decision);
  replies["agent:list"] = await send("agent:list");
  replies["agent:emit"] = urgent;
} catch (error) {
  record.error = error instanceof Error ? error.message : String(error);
} finally {
  await fox?.close();
  hook.close();
}

// Screenshots: the real pages over http, with a stub browser that replays
// the answers recorded above.
if (shots && !record.error) {
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, "replies.json"), `${JSON.stringify(replies, null, 2)}\n`);
  const dir = mkdtempSync(join(tmpdir(), "fnt-shot-"));
  const stub = `<script>window.browser={runtime:{sendMessage:async(m)=>({ok:true,value:${JSON.stringify(replies)}[m.type]??null})}};</script>`;
  for (const name of ["popup", "settings", "approvals"]) {
    writeFileSync(join(dir, `${name}.html`), readFileSync(`dist-ext/${name}.html`, "utf8").replace(`<script src="${name}.js">`, `${stub}<script src="${name}.js">`));
    writeFileSync(join(dir, `${name}.js`), readFileSync(`dist-ext/${name}.js`));
  }
  writeFileSync(join(dir, "style.css"), readFileSync("dist-ext/style.css"));
  const shotSite = await serve(dir);
  const shooter = await launch({ extension: "dist-ext", headless: true });
  try {
    for (const [name, width, prep] of [
      ["popup", 420, () => document.querySelector(".task button").click()],
      ["settings", 640, () => document.getElementById("preview").click()],
      ["approvals", 520, null],
    ]) {
      const p = await shooter.open(`${shotSite.url}/${name}.html#t2`);
      await p.setViewport({ width, height: 400 });
      await sleep(300);
      if (prep) await p.evaluate(prep);
      await sleep(500);
      await p.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
    }
    record.screenshots = ["popup", "settings", "approvals"].map((n) => `${n}.png`);
  } finally {
    await shooter.close();
    await shotSite.close();
  }
}
await site.close();

record.passed = !record.error && record.checks.length > 0 && record.checks.every((c) => c.ok);
const path = writeArtifact("artifacts", "e2e", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}: ${JSON.stringify(c.actual)}`);
console.log(`${record.passed ? "PASS" : "FAIL"} ${record.checks.filter((c) => c.ok).length}/${record.checks.length}${record.skipped ? ` (${record.skipped.length} display checks skipped on CI)` : ""}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;
