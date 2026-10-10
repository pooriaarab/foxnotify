// The E2E test: install the built demo (dist-ext/) in a real Firefox, start a
// fake task from the popup page, emit a sign-in event, and check that
// Firefox shows the notice. Writes artifacts/e2e-<date>.json.
// Usage: pnpm e2e [--headed]. Env: FIREFOX (the Firefox binary).
import { launch, poll, serve, writeArtifact } from "create-foxkit/e2e";

const record = { startedAt: new Date().toISOString(), checks: [] };
const check = (name, expected, actual) => record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });

const site = await serve("e2e/site");
let fox;
try {
  fox = await launch({ extension: "dist-ext", headless: !process.argv.includes("--headed") });
  record.firefox = await fox.browser.version();
  const ext = await fox.openExtensionPage("popup.html");
  check("the popup shows the fake agent", "Fake agent", await poll(ext, () => document.querySelector("h1")?.textContent));
  const out = await ext.evaluate(async (url) => {
    // oxlint-disable-next-line consistent-function-scoping -- this runs in the page, so it must be inside
    const ask = async (type, data) => (await browser.runtime.sendMessage({ type, ...data })).value;
    const task = await ask("agent:start", { title: "Book a table", url });
    const result = await ask("agent:emit", { taskId: task.taskId, kind: "needs-sign-in" });
    const shown = await browser.notifications.getAll();
    return { action: result.decision.action, title: shown["fnt:needs-sign-in:t1"]?.title };
  }, `${site.url}/index.html`);
  check("the sign-in event shows a notice", { action: "send", title: "Sign-in needed" }, out);
} catch (error) {
  record.error = error instanceof Error ? error.message : String(error);
} finally {
  await fox?.close();
  await site.close();
}
record.passed = !record.error && record.checks.length === 2 && record.checks.every((c) => c.ok);
const path = writeArtifact("artifacts", "e2e", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}: ${JSON.stringify(c.actual)}`);
console.log(`${record.passed ? "PASS" : "FAIL"}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;
