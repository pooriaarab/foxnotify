// For the E2E test only: build-ext.mjs --e2e bundles this file as the event
// page instead of extension/background.js. It loads the release event page
// and adds the test messages, so the release build that AMO signs has none.
import { handlers, notifier } from "../extension/background.js";

const store = browser.storage.local;
const get = async (key, fallback) => (await store.get(key))[key] ?? fallback;

// Count page loads, so the test can see each unload and wake.
get("e2e:boots", []).then((boots) => store.set({ "e2e:boots": [...boots, Date.now()].slice(-20) }));

Object.assign(handlers, {
  // A test cannot click a system notice, so it calls the same click handler
  // that notifications.onClicked calls.
  "test:click": ({ id }) => notifier.click(id),
  "test:shown": () => browser.notifications.getAll(),
  "test:boots": () => get("e2e:boots", []),
  "test:active": () => browser.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => tabs.map((t) => t.id)),
  "test:focus": ({ tabId }) => browser.tabs.update(tabId, { active: true }),
});
