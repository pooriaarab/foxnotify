# Failure modes

This file lists every way foxnotify can fail. Each row names the wanted
behavior and the test that checks it. The rows come before the code, and the
tests commit before the code that makes them pass.

## Events and text

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| E1 | An event has an unknown kind, an empty task id or an empty title. | `toNotice` throws `FoxnotifyError` with code `invalid-event`. | `tests/events.test.ts` |
| E2 | A task title holds a secret: a token, a one-time code, a card number, an email address or a URL with a query. | `cleanTitle` puts `[hidden]` in its place. A URL keeps only its host. | `tests/events.test.ts` |
| E3 | A title has line breaks, control characters or 500 characters. | The text becomes one line of at most 80 characters, with `…` at the cut. | `tests/events.test.ts` |
| E4 | An event sets a priority that does not exist. | `toNotice` throws `invalid-event`. | `tests/events.test.ts` |
| E5 | An event sets a key that is not a non-empty string. A stored state with such a key fails its check at the next load, and every queued notice and mute is lost. | `toNotice` throws `invalid-event`. | `tests/events.test.ts` |

## Rules

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| R1 | A rule has a bad time such as `25:00`, a bad priority, or a limit below 1. | `parseRules` throws `FoxnotifyError` with code `invalid-rules`. | `tests/events.test.ts` |
| R2 | Quiet hours cross midnight (22:00 to 07:00). | 23:30 and 06:59 are quiet. 07:00 and 21:59 are not. | `tests/events.test.ts` |
| R3 | Quiet hours have the same start and end. | There are no quiet hours. | `tests/events.test.ts` |
| R4 | A per-kind priority is set in the rules, and an event sets its own. | The event priority wins. Else the rules priority, else the default for the kind. | `tests/events.test.ts` |

## Decisions

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| D1 | A low-priority notice comes in quiet hours. | It is held, not sent. | `tests/decide.test.ts`, E2E |
| D2 | An urgent notice comes in quiet hours. | It is sent at once. | `tests/decide.test.ts`, E2E |
| D3 | Held notices are never shown after quiet hours end. | The next flush time is the end of quiet hours. A flush then returns them. | `tests/decide.test.ts` |
| D4 | The same event comes again within the de-duplicate time. | The repeat is dropped as `duplicate`. After that time, it is sent again. | `tests/decide.test.ts` |
| D5 | A repeat comes while the first copy waits in the digest. | The repeat is dropped. The digest has one copy. | `tests/decide.test.ts` |
| D6 | A flood of events passes the rate limit. | The events over the limit go to the digest. None is lost and none is shown at once. | `tests/decide.test.ts` |
| D7 | An urgent notice comes when the rate limit is full. | It is sent at once. | `tests/decide.test.ts` |
| D8 | A muted task sends an event. | It is dropped as `muted`. After `unmute`, events from it come through. | `tests/decide.test.ts` |
| D9 | A low-priority notice is shown at once. | It goes to the digest. A flush before the flush time returns nothing. A flush at that time returns all digest notices together. | `tests/decide.test.ts` |
| D10 | A flush runs during quiet hours. | It returns nothing. The flush time moves to the end of quiet hours. | `tests/decide.test.ts` |
| D11 | The clock moves back. | Stored times in the future count as now, so the rate limit and de-duplicate windows do not stay closed. | `tests/decide.test.ts` |
| D12 | `clear(key)` is called for a notice that waits in the digest or is held. | The waiting copy is removed, and the key can notify again. | `tests/decide.test.ts` |
| D13 | A stored state has a flush time and an empty queue. | A flush clears the flush time, so the alarm does not fire again and again. | `tests/decide.test.ts` |

## State

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| S1 | The stored state is corrupt, or comes from a newer foxnotify. | `parseState` returns an empty state. It does not throw. | `tests/decide.test.ts` |
| S2 | The state grows with no limit: old keys, old send times, a long queue. | Old keys and send times are removed. The queue keeps the newest 50 notices and counts the ones it drops. | `tests/decide.test.ts` |
| S3 | `decide` changes the state object that the caller gave it. | The caller's object stays the same. `decide` returns a new state. | `tests/decide.test.ts` |

## Notifier (the event page)

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| N1 | Two `notify()` calls at the same time lose a state update. | The calls run one after the other in the page. Each one counts for the rate limit. | `tests/notifier.test.ts` |
| N2 | The flush alarm is lost when Firefox restarts. | On load, the notifier sets the alarm again from the stored flush time. A flush time in the past flushes at once. | `tests/notifier.test.ts` |
| N3 | `notifications.create` throws. | The result lists the error. The state is saved, and the other channels still get the notice. | `tests/notifier.test.ts` |
| N4 | A channel throws. | The result lists the error. The desktop notice and the other channels still go out. | `tests/notifier.test.ts` |
| N5 | An approval is answered while its notice is on screen. | `clear(key)` closes the notice and removes a queued copy. | `tests/notifier.test.ts` |
| N6 | Rules from the settings page are lost when the page unloads, or bad rules replace good ones. | `setRules` checks the rules and saves them. Each `notify` reads the saved rules. Bad rules throw `invalid-rules`, and the saved rules stay. | `tests/notifier.test.ts` |
| N7 | The notice text shows more than the task title, such as page text that an agent puts in the event. | The text comes from a fixed sentence for each kind, plus the cleaned title. Other event fields never reach the text. | `tests/notifier.test.ts`, E2E |
| N8 | `clear(key)` runs after `notify` decided to send and before the notice shows. | The notifier checks the key again after it shows the notice, and closes it. No notice stays on screen for an answered approval. | `tests/notifier.test.ts` |

## Clicks

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| C1 | Firefox unloads the event page after a notice and before the click. | The click target is in storage. The notifier of the next page load routes the click. | `tests/clicks.test.ts` |
| C2 | The target tab is closed before the click. | The click opens the target URL, else the fallback page. A tab that already shows the URL gets the focus. It does not throw. | `tests/clicks.test.ts` |
| C3 | The target tab is in a window behind another window. | The click makes the tab active and focuses its window. With no `windows` API (Android), it makes the tab active only. | `tests/clicks.test.ts`, E2E |
| C4 | A click approves the action. | A click only focuses a tab or opens a page. foxnotify has no approve path. The approval waits on the page that the click opens. | E2E |
| C5 | A click comes for a notification id that foxnotify did not make. | The notifier ignores it. | `tests/clicks.test.ts` |
| C6 | The stored click targets grow with no limit. | A click or a close removes the entry. The store keeps the newest 50. | `tests/clicks.test.ts` |
| C7 | A digest holds one notice only. | It shows as that notice, with its own click target. | `tests/clicks.test.ts` |
| C8 | A key notifies again while its old notice is still on screen. Firefox replaces the old notice and can send `onClosed` for it after the new target is saved. | The notifier ignores that one close, so a click on the new notice still routes. | `tests/clicks.test.ts` |

## Webhook

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| W1 | The webhook sends the task title when the user did not opt in. | The body has the kind, the priority, a fixed sentence and the time. The title goes in only with `includeTitle: true`. | `tests/webhook.test.ts`, E2E |
| W2 | The preview shows other text than the request that goes out. | One function builds both. `previewWebhook` returns the exact method, headers and body. | `tests/webhook.test.ts`, E2E |
| W3 | The URL is not `https:`, or holds a user name and password. | `webhookChannel` throws `invalid-webhook`. Plain `http:` works only for `localhost`, `127.0.0.1` and `[::1]`. | `tests/webhook.test.ts` |
| W4 | The server never answers. | The request stops after `timeoutMs` (default 10000), and the channel throws. | `tests/webhook.test.ts` |
| W5 | The server answers with an error status. | The channel throws with the status. It does not count as sent. | `tests/webhook.test.ts` |
| W6 | An error message shows the URL, which can hold an access token. | Error messages never hold the URL. | `tests/webhook.test.ts` |
| W7 | A non-ASCII title goes into an HTTP header and the request fails. | Headers hold only fixed ASCII text. A title goes in the body. | `tests/webhook.test.ts` |
| W8 | The request sends cookies or a referrer. | The request uses `credentials: "omit"` and no referrer. | `tests/webhook.test.ts` |

## Phone link (foxsync)

The foxsync link lives in a page that stays open, such as the sidebar. The
event page sends each notice to that page with `runtime.sendMessage`.

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| P1 | No page holds a phone link. | The phone channel throws "No page holds an open phone link." It does not wait forever. | `tests/phone.test.ts`, E2E |
| P2 | The page holds a link that has closed. | The page answers that the link is closed, and the channel throws. | `tests/phone.test.ts` |
| P3 | A content script or a web page sends a phone message. | `servePhoneLink` answers only messages from the extension's own pages. | `tests/phone.test.ts` |
| P4 | `link.send` throws, for example because the link closes during the send. | The page answers with the error, and the channel throws. | `tests/phone.test.ts` |
| P5 | The text is too long for one link message. | The text is cut at 1000 characters. | `tests/phone.test.ts` |
| P6 | The page gets the message and never answers. | The channel stops after `timeoutMs` (default 5000) and throws. | `tests/phone.test.ts` |
| P7 | Other messages of the extension reach `servePhoneLink`. | It ignores every message that is not a phone notice, and lets other listeners answer. | `tests/phone.test.ts` |
