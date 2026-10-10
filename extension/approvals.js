// The approvals page. A click on an approval notice opens it. The notice
// itself cannot approve: Firefox notices have no buttons, and a click only
// brings the user here.
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "no answer");
  return reply.value;
};

function card(item) {
  const div = document.createElement("div");
  div.className = item.taskId === location.hash.slice(1) ? "approval focus" : "approval";
  div.dataset.task = item.taskId;
  const title = document.createElement("div");
  title.className = "state";
  title.textContent = item.title;
  const action = document.createElement("div");
  action.textContent = `The agent wants to: ${item.action}`;
  const state = document.createElement("div");
  state.className = "decision";
  state.textContent = `State: ${item.state}`;
  div.append(title, action, state);
  if (item.state === "pending") {
    for (const decision of ["approve", "deny"]) {
      const b = document.createElement("button");
      b.textContent = decision === "approve" ? "Approve" : "Deny";
      b.addEventListener("click", () => ask("approvals:answer", { taskId: item.taskId, decision }).then(render));
      div.append(b);
    }
  }
  return div;
}

async function render() {
  const items = Object.values(await ask("approvals:list"));
  if (items.length) document.getElementById("list").replaceChildren(...items.map(card));
}
addEventListener("hashchange", render);
render();
