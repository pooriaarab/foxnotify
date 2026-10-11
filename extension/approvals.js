// The approvals page. A click on an approval notice opens it. The notice
// itself cannot approve: Firefox notices have no buttons, and a click only
// brings the user here.
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "no answer");
  return reply.value;
};

// A letter avatar for the task. The hue comes from the name, so one task
// keeps one color. style.setProperty is CSSOM, which the CSP allows.
function siteIcon(site) {
  const box = Object.assign(document.createElement("span"), { className: "site-icon", textContent: (site[0] ?? "?").toUpperCase() });
  let hue = 0;
  for (const c of site) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  box.style.setProperty("--hue", String(hue));
  box.setAttribute("aria-hidden", "true");
  return box;
}
const seen = new Set();
const el = (tag, className, textContent) => Object.assign(document.createElement(tag), { className, textContent });

function card(item) {
  const div = el("div", "approval ask");
  if (item.taskId === location.hash.slice(1)) div.classList.add("focus");
  if (item.state !== "pending") div.classList.add("done");
  // Only a new card animates in; a re-render keeps the others still.
  if (!seen.has(item.taskId)) div.classList.add("ask-new");
  seen.add(item.taskId);
  div.dataset.task = item.taskId;
  const head = el("div", "ask-head");
  head.append(siteIcon(item.title), el("div", "state site", item.title));
  div.append(head, el("div", "text", `The agent wants to: ${item.action}`), el("div", "decision", `State: ${item.state}`));
  if (item.state === "pending") {
    const answers = el("div", "answers");
    for (const decision of ["deny", "approve"]) {
      const b = el("button", decision === "approve" ? "primary" : "ghost", decision === "approve" ? "Approve" : "Deny");
      b.addEventListener("click", () => ask("approvals:answer", { taskId: item.taskId, decision }).then(render));
      answers.append(b);
    }
    div.append(answers);
  }
  return div;
}

async function render() {
  const items = Object.values(await ask("approvals:list"));
  if (items.length) document.getElementById("list").replaceChildren(...items.map(card));
}
addEventListener("hashchange", render);
render();
