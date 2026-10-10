// For the E2E test only: build-ext.mjs --e2e adds it as a content script on
// 127.0.0.1 pages. It passes commands from the test page to the event page.
// A content script is not an extension view, so it does not keep the event
// page loaded between commands.
window.addEventListener("message", async (event) => {
  if (event.source !== window || event.data?.fnt !== "command") return;
  const result = await browser.runtime.sendMessage(event.data.msg).catch((error) => ({ ok: false, error: error.message }));
  window.postMessage({ fnt: "reply", id: event.data.id, result }, "*");
});
document.documentElement.dataset.bridge = "ready";
