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
