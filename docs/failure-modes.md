# Failure modes

This file lists every way foxnotify can fail. Each row names the wanted
behavior and the test that checks it. The rows come before the code, and the
tests commit before the code that makes them pass.

## Events and text

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| E1 | An event has an unknown kind, an empty task id or an empty title. | `decide` throws `FoxnotifyError` with code `invalid-event`. Nothing goes in the state. | `tests/events.test.ts` |
| E2 | A task title holds a secret: a token, a one-time code, a card number, an email address or a URL with a query. | `cleanTitle` puts `[hidden]` in its place. A URL keeps only its host. | `tests/events.test.ts` |
| E3 | A title has line breaks, control characters or 500 characters. | The text becomes one line of at most 80 characters, with `…` at the cut. | `tests/events.test.ts` |
| E4 | An event sets a priority that does not exist. | `decide` throws `invalid-event`. | `tests/events.test.ts` |
| E5 | An event sets a key that is not a non-empty string. A stored state with such a key fails its check at the next load, and every queued notice and mute is lost. | `toNotice` throws `invalid-event`. | `tests/events.test.ts` |

## Rules

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| R1 | A rule has a bad time such as `25:00`, a bad priority, or a limit below 1. | `parseRules` throws `FoxnotifyError` with code `invalid-rules`. | `tests/events.test.ts` |
| R2 | Quiet hours cross midnight (22:00 to 07:00). | 23:30 and 06:59 are quiet. 07:00 and 21:59 are not. | `tests/events.test.ts` |
| R3 | Quiet hours have the same start and end. | There are no quiet hours. | `tests/events.test.ts` |
| R4 | A per-kind priority is set in the rules, and an event sets its own. | The event priority wins. Else the rules priority, else the default for the kind. | `tests/events.test.ts` |
