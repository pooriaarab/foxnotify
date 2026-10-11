// The settings page: rules, the webhook with its preview, and muted tasks.
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "no answer");
  return reply.value;
};
const $ = (id) => document.getElementById(id);
const webhookInput = () => ({ url: $("url").value.trim(), format: $("format").value, includeTitle: $("title").checked });
let previewed = null;

function lockWebhook() {
  const now = JSON.stringify(webhookInput());
  if (previewed !== now) {
    $("enabled").checked = false;
    $("enabled").disabled = true;
  }
}

$("preview").addEventListener("click", async () => {
  try {
    const r = await ask("settings:preview", { webhook: webhookInput() });
    const headers = Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join("\n");
    $("request").textContent = `${r.method} ${r.url}\n${headers}\n\n${r.body}`;
    previewed = JSON.stringify(webhookInput());
    $("enabled").disabled = false;
  } catch (error) {
    $("request").textContent = error.message;
    previewed = null;
    lockWebhook();
  }
  $("request").hidden = false;
});
for (const id of ["url", "format", "title"]) $(id).addEventListener("input", lockWebhook);

$("save").addEventListener("click", async () => {
  const rules = {
    quietHours: $("quiet").checked ? { start: $("start").value, end: $("end").value, bypass: $("bypass").value } : null,
    digestMinutes: Number($("digest").value),
    rateLimit: { max: Number($("max").value), perMinutes: 1 },
    dedupeMinutes: Number($("dedupe").value),
  };
  const webhook = $("url").value.trim() ? { ...webhookInput(), enabled: $("enabled").checked } : null;
  try {
    await ask("settings:save", { rules, webhook });
    $("status").textContent = "Saved.";
  } catch (error) {
    $("status").textContent = error.message;
  }
});

async function load() {
  const { rules, webhook } = await ask("settings:get");
  if (rules.quietHours) {
    $("quiet").checked = true;
    $("start").value = rules.quietHours.start;
    $("end").value = rules.quietHours.end;
    $("bypass").value = rules.quietHours.bypass ?? "urgent";
  }
  if (rules.digestMinutes) $("digest").value = rules.digestMinutes;
  if (rules.rateLimit) $("max").value = rules.rateLimit.max;
  if (rules.dedupeMinutes !== undefined) $("dedupe").value = rules.dedupeMinutes;
  if (webhook) {
    $("url").value = webhook.url;
    $("format").value = webhook.format ?? "json";
    $("title").checked = Boolean(webhook.includeTitle);
    $("enabled").checked = webhook.enabled;
    $("enabled").disabled = false;
    previewed = JSON.stringify(webhookInput());
  }
  const { tasks, state } = await ask("agent:list");
  if (state.muted.length) {
    $("muted").replaceChildren(
      ...state.muted.map((taskId) => {
        const row = document.createElement("div");
        row.className = "row";
        const name = document.createElement("span");
        name.textContent = tasks[taskId]?.title ?? taskId;
        const b = document.createElement("button");
        b.className = "small";
        b.textContent = "Unmute";
        b.addEventListener("click", () => ask("agent:mute", { taskId, muted: false }).then(() => row.remove()));
        row.append(name, b);
        return row;
      }),
    );
  }
}
load();
