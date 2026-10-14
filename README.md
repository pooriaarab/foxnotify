# foxnotify

[![npm version](https://img.shields.io/npm/v/foxnotify)](https://www.npmjs.com/package/foxnotify)
[![Downloads/month](https://img.shields.io/npm/dm/foxnotify)](https://www.npmjs.com/package/foxnotify)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/license/mit)

[Quickstart](#decide-your-first-notice) · [API reference](#runtime-surfaces) · [Channel coverage](#coverage) · [FAQ](#faq)

foxnotify is an open-source notification library for Firefox agent developers who need approval alerts, quiet hours, and digests.
It routes notices to the desktop, a webhook, or a caller-supplied phone link.
Desktop clicks focus a task tab or open a page where the user can review the action.

## Install

```bash
npm install foxnotify
```

The demo extension targets Firefox 153 or later.
Pure rule functions also run in Node.js 24 or later.
TypeScript declarations are included; there are no required runtime dependencies.
foxsync is an optional peer dependency for callers who provide a phone link.

## Decide your first notice

Save this as `example.mjs`, then run `node example.mjs`.
This example checks rules; it does not show a desktop notification.
No API keys, environment variables, or `.env` file are needed.

```js
import { decide, emptyState, parseRules } from "foxnotify";

const rules = parseRules({ quietHours: { start: "22:00", end: "07:00" } });
const night = new Date(2026, 9, 14, 23, 30).getTime();
const done = decide(emptyState(), {
  kind: "task-done", taskId: "t1", title: "Book a table",
}, rules, night);
console.log(done.decision);
const ask = decide(done.state, {
  kind: "needs-approval", taskId: "t1", title: "Send the form", priority: "urgent",
}, rules, night);
console.log(ask.decision);
```

Success prints `{ action: 'hold', reason: 'quiet-hours' }`, then `{ action: 'send' }`.
For desktop delivery, initialize this in your extension background script:

```js
import { createNotifier } from "foxnotify";

const notifier = createNotifier({
  browser,
  storage: browser.storage.local,
});
await notifier.ready;
const result = await notifier.notify({
  kind: "needs-approval", taskId: "t42", title: "Send the form",
});
console.log(result.delivered, result.errors);
```

Declare `notifications`, `alarms`, and `storage` permissions in the extension manifest.
Initialize listeners on each background-page load.
Success shows an approval notice and includes `desktop` in `result.delivered`.

## How it works

```text
Agent event -> validate + clean title -> rules -> send / hold / digest / drop
                                               -> persist state + alarm
Send or flush -> desktop | webhook | phone bridge
Desktop click -> focus tab or open review page
```

The notifier saves state, rules, and click targets in `browser.storage.local`.
One alarm flushes notices when their time arrives.
Independent channel results appear in `delivered` and `errors`.

## Why it exists

Browser agents need to request attention while users work in another tab.
ntfy and Gotify deliver push messages through servers.
foxnotify applies agent-specific event rules inside an extension, then calls delivery channels.
It can use ntfy as a destination; it provides no push server.

## Compare

Checked on 2026-10-14 against [ntfy documentation](https://docs.ntfy.sh/)
and [Gotify documentation](https://gotify.net/docs/).

| Property | foxnotify | ntfy | Gotify |
|---|---|---|---|
| Scope | Agent notice rules and browser routing | HTTP push notifications | Server messages from applications to clients |
| Deployment | Library inside your extension | Push server and receiving clients | Server and receiving clients |
| Configuration | Rule and channel objects | Topic URLs and publish requests | Applications and clients |
| Message model | Five event kinds, quiet hours, digest | Topic messages via HTTP PUT or POST | Content, title, application ID, priority |

## Coverage

There are three implemented delivery surfaces: desktop, webhook, and phone bridge.
The webhook supports two formats, JSON and ntfy; these share one channel factory.

| Integration | Status | Verification level |
|---|---|---|
| Mozilla Firefox desktop notifications | ✓ | Browser API behavior tested locally with stand-ins |
| JSON HTTP webhook | ✓ | Request construction and failures tested locally |
| ntfy HTTP publishing | Implemented format | Header/body tests; live ntfy service not checked here |
| foxsync phone link bridge | Implemented bridge | Stand-in link tests; real paired phone pending |
| Gotify | — | No built-in adapter |

The five event kinds are `needs-approval`, `needs-sign-in`, `task-done`, `task-stuck`, and `schedule-missed`.
The four priorities are `low`, `normal`, `high`, and `urgent`.
This rewrite does not verify Android, a live webhook service, or a paired phone.

## Common use cases

1. foxmate developers alert users when a Firefox agent needs approval.
2. foxpass login-helper developers focus the task tab when sign-in needs attention.
3. Firefox extension authors group low-priority task completions into a morning digest.
4. ntfy home-lab users receive fixed task summaries through a self-hosted topic.
5. foxsync application developers pass notices to an open page with a paired phone link.

## Features

- **Quiet hours:** local clock rules and a configurable priority bypass; see [rules](#rules-pure-also-in-node).
- **Flood control:** deduplication, per-task mute, rate limits, and a bounded queue; see [limits](#delivery-and-behavior-limits).
- **Digests:** queued notices flush through the same delivery surfaces; see the [notifier API](#notifier-extension-event-page).
- **Webhook preview:** inspect the outgoing request before enabling delivery; see [channels](#channels).
- **Text filtering:** cleaned titles and fixed event sentences; see [limits](#delivery-and-behavior-limits).

## Runtime surfaces

The package exports a JavaScript library with pure rules and Firefox notifier APIs.
There is no CLI or Model Context Protocol (MCP) server.

### Rules (pure, also in Node)

| Export | What it does |
|---|---|
| `parseRules(input?)` | Checks a rules object and fills in the defaults. Throws `FoxnotifyError` with code `invalid-rules`. |
| `decide(state, event, rules, now)` | Returns `{ decision, notice, state }`. `decision.action` is `send`, `digest`, `hold` or `drop`, with a `reason`. The given state does not change. |
| `flushDue(state, rules, now)` | Returns `{ notices, dropped, state }`: the queued notices when the flush time has come and it is not quiet hours. |
| `emptyState()`, `parseState(value)` | A new state, or a stored one. A corrupt state gives an empty state. |
| `clear(state, key)` | Removes a queued copy and forgets the key. |
| `mute(state, taskId)`, `unmute(state, taskId)` | Per-task mute. |
| `isQuiet(rules, now)`, `quietEndsAt(rules, now)` | Quiet hours in local time. |
| `toNotice(event, rules, now)` | Checks an event. Throws `invalid-event`. |
| `cleanTitle(text)`, `noticeText(notice)`, `digestText(notices, dropped?)` | The text parts. |

The rules input:

| Option | Default | What it does |
|---|---|---|
| `priorities` | see above | Priority per kind |
| `quietHours` | none | `{ start: "22:00", end: "07:00", bypass: "urgent" }` |
| `dedupeMinutes` | `10` | Drop a repeat of a key within this time |
| `rateLimit` | `{ max: 4, perMinutes: 1 }` | Notices at once; the rest go to the digest |
| `digestMinutes` | `60` | How long a low-priority notice waits |

An event is `{ kind, taskId, title, priority?, target?, key?, reason? }`.
`kind` is `needs-approval`, `needs-sign-in`, `task-done`, `task-stuck` or
`schedule-missed`. For `task-stuck`, `reason` is `stuck` (default) or
`cut-short`. `target` is `{ tabId }` to focus a tab, or `{ url }` to open a
page or focus the tab that shows it.

### Notifier (extension event page)

`createNotifier(options)` takes `browser`, `storage`, and optionally `rules`,
`channels`, `desktop` (default `true`), `iconUrl`, `fallbackUrl` (the page a
click opens when the notice has no target), `now` and `onClick`. It returns:

| Method | What it does |
|---|---|
| `notify(event)` | Decides, saves, then delivers. Returns `{ decision, notice, delivered, errors }`. A failing channel shows up in `errors`; the others still deliver. |
| `flush()` | Shows the queued notices when their time has come. The `fnt:flush` alarm calls it. |
| `clear(key)` | Closes the notice for this key and removes a queued copy. Call it when the user answers an approval. |
| `mute(taskId)`, `unmute(taskId)` | Per-task mute. |
| `setRules(input)`, `getRules()` | Saves the rules in storage. They win over `options.rules`. |
| `state()` | The stored state. |
| `click(id)` | The click handler that `notifications.onClicked` calls. Returns `tab`, `url`, `none` or `ignored`. |
| `ready` | Resolves after the load check: a past flush time flushes, else the alarm is set again. |

Storage keys start with `fnt:`. Run the notifier in one page only, the event
page. Other pages send it a message.

### Channels

| Export | What it does |
|---|---|
| `webhookChannel({ url, format?, includeTitle?, timeoutMs?, fetch? })` | Posts each notice and digest. `format` is `json` (default) or `ntfy`. The URL must use `https:`, or `http:` on localhost. Throws `invalid-webhook`. |
| `previewWebhook(options, message?)` | The exact `{ url, method, headers, body }` that the channel sends. With no message, it uses a sample approval notice. |
| `phoneChannel(browser.runtime, { timeoutMs? })` | For the event page. Hands each notice to the page that runs `servePhoneLink`. |
| `servePhoneLink(browser.runtime, link)` | For the sidebar or a pinned tab. Sends each notice over a foxsync `Link` as a `note`. Returns a function that stops it. |
| `Channel` | Your own channel: `{ name, send(message) }`. |

foxsync is an optional peer dependency. foxnotify uses only the `isOpen` and
`send` parts of a link, so it does not import foxsync.

## Delivery and behavior limits

- **No buttons on a notice.** Firefox notices have no action buttons, images
  or progress bars. A click is the only action, and it only opens a page. The
  user approves on that page.
- **A click cannot open the sidebar.** `sidebarAction.open()` needs a user
  action, and a notice click is not one of them. Point the target at an
  extension page in a tab instead.
- **Android is not tested.** Firefox for Android has `notifications` (48 and
  later) and `onClicked`, but no `windows` API, so a click makes the tab
  active only. There is no sidebar on Android.
- **The event page unloads.** Firefox 157 unloads an idle event page after
  30 s (the `extensions.background.idle.timeout` pref). The notifier saves
  first and keeps one alarm. Nothing runs while Firefox is closed. A flush
  time that passed shows when the event page loads again.
- **The E2E does not click a real notice.** A test cannot click a system
  notice, so it calls the handler that `onClicked` calls.
- **The E2E does not cover a real foxsync link.** The phone channel has
  isolated tests with a stand-in link.
- **cleanTitle is a filter, not a guarantee.** It catches common secret
  shapes. Do not put secrets in task titles.
- **One page runs the notifier.** Two pages with their own notifier can race
  on the stored state.
- **No retry.** A failed send, on any channel, shows up in `errors`, and the
  notice is not sent again. This is also true for a digest.
- **Mute is for new events.** Notices that wait in the queue before `mute`
  still show in the digest.
- **Clock changes.** When quiet hours end in the hour that a clock change
  repeats or skips, the held notices can show an hour late, or a day late on
  the night the clock goes back.
- **No phone call or SMS.** foxnotify never calls a phone.
- **http: only on localhost.** A webhook on your LAN needs `https:`.

## Integration guides

- [Firefox desktop agent alerts](#decide-your-first-notice): initialize the notifier in the background script.
- [ntfy and JSON webhook delivery](#channels): supply a URL and choose the payload format.
- [foxsync phone notices](#channels): keep the link in an open extension page and register `servePhoneLink` there.

Use `webhookChannel({ url, format: "ntfy" })` for an ntfy topic.
The default format is JSON; it does not use ntfy publishing headers.
External webhooks need appropriate extension host permissions.
The webhook omits cleaned task titles unless `includeTitle: true`; desktop and phone text includes them.

## Status

foxnotify is a 0.x library; rule defaults and API shapes can change before 1.0.
Report problems through [GitHub issues](https://github.com/pooriaarab/foxnotify/issues).
Public case studies are not yet published.
The demo is a development extension; this README does not claim an approved add-on listing.

## FAQ

### What is foxnotify?

foxnotify turns agent events into delivery decisions and notices.
It includes quiet hours, digests, deduplication, and click routing for Firefox extensions.

### Which integrations are verified?

foxnotify has local tests for rule decisions, browser API calls, webhook requests, and a stand-in phone link.
This README rewrite does not test a live ntfy server, Android, or a real paired phone.

### Does foxnotify provide a managed push service?

foxnotify runs inside your extension.
You provide any webhook server or phone link it uses.

### How is foxnotify different from ntfy?

foxnotify decides when an agent notice should appear and can publish to an ntfy topic.
[ntfy](https://docs.ntfy.sh/) delivers push notifications through HTTP publishing and receiving clients.

### How is foxnotify different from Gotify?

foxnotify runs agent notice rules inside Firefox.
[Gotify](https://gotify.net/docs/) provides a server with sending applications and receiving clients; foxnotify has no built-in Gotify adapter.

### Does clicking a foxnotify notice approve an action?

foxnotify routes the click to a tab or page.
The application handles the approval on that page.

### Does foxnotify retry failed delivery?

foxnotify reports channel failures in `errors`.
It does not retry failed single notices or digests.

### Does foxnotify hide all secrets in titles?

foxnotify filters common secret patterns and shortens titles.
The filter cannot guarantee secrecy; applications should supply titles without secrets.

## Try the demo

```bash
pnpm install
pnpm ci:local
pnpm build:ext
```

Load `dist-ext/manifest.json` from Firefox `about:debugging`.
The popup emits sample agent events; settings configures quiet hours and previews the webhook request.
Run `pnpm e2e` separately for Firefox checks and an artifact in `artifacts/`.
The end-to-end suite calls the notice click handler; it does not click an operating-system notification.
Its phone tests use a stand-in link.

## License

[MIT](https://opensource.org/license/mit)
