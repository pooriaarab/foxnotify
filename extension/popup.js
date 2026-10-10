// The fake agent panel: start tasks and emit foxnotify events for them.
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "no answer");
  return reply.value;
};
const $ = (id) => document.getElementById(id);
const KINDS = [
  ["needs-approval", "Needs approval"],
  ["needs-sign-in", "Needs sign-in"],
  ["task-done", "Done"],
  ["task-stuck", "Stuck"],
  ["task-stuck:cut-short", "Cut short"],
  ["schedule-missed", "Missed its schedule"],
];

function option(value, text) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}

function taskCard(task, muted) {
  const card = document.createElement("div");
  card.className = muted ? "task muted" : "task";
  const name = document.createElement("div");
  name.className = "state";
  name.textContent = `${task.taskId}: ${task.title}${muted ? " (muted)" : ""}`;
  const kind = document.createElement("select");
  for (const [value, text] of KINDS) kind.append(option(value, text));
  const priority = document.createElement("select");
  for (const p of ["", "low", "normal", "high", "urgent"]) priority.append(option(p, p || "default priority"));
  const emit = document.createElement("button");
  emit.textContent = "Emit";
  emit.addEventListener("click", async () => {
    const [k, reason] = kind.value.split(":");
    const result = await ask("agent:emit", { taskId: task.taskId, kind: k, reason, priority: priority.value });
    $("log").textContent = JSON.stringify({ decision: result.decision, delivered: result.delivered, errors: result.errors }, null, 1);
  });
  const mute = document.createElement("button");
  mute.textContent = muted ? "Unmute" : "Mute";
  mute.addEventListener("click", () => ask("agent:mute", { taskId: task.taskId, muted: !muted }).then(render));
  const row = document.createElement("div");
  row.className = "row";
  row.append(kind, priority, emit, mute);
  card.append(name, row);
  return card;
}

async function render() {
  const { tasks, state } = await ask("agent:list");
  const list = Object.values(tasks);
  if (list.length) $("tasks").replaceChildren(...list.map((t) => taskCard(t, state.muted.includes(t.taskId))));
}

$("start").addEventListener("click", () => ask("agent:start", { title: $("title").value, url: $("url").value }).then(render));
render();
