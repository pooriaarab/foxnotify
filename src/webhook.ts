import { FoxnotifyError } from "./errors.js";
import type { Channel, Message } from "./notifier.js";
import { type Notice, type Priority, PRIORITIES } from "./rules.js";
import { textKey } from "./text.js";

export interface WebhookOptions {
  /** An `https:` URL, for example a topic on your own ntfy server. Plain `http:` works for localhost only. */
  url: string;
  /** `json` (default) posts a JSON object. `ntfy` posts plain text with ntfy headers. */
  format?: "json" | "ntfy";
  /** Put the cleaned task title in the request. Default false. */
  includeTitle?: boolean;
  /** Stop a request after this long. Default 10000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** One request, as it goes out. */
export interface WebhookRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

const SUMMARY: Record<string, string> = {
  "needs-approval": "A task waits for your approval.",
  "needs-sign-in": "A task needs you to sign in.",
  "task-done": "A task is done.",
  "task-stuck": "A task is stuck.",
  "task-cut-short": "A task stopped before the end.",
  "schedule-missed": "A scheduled task did not run.",
};
const NTFY_PRIORITY: Record<Priority, string> = { low: "2", normal: "3", high: "4", urgent: "5" };
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function checkUrl(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new FoxnotifyError("invalid-webhook", "The webhook URL does not parse.");
  }
  if (url.username || url.password) throw new FoxnotifyError("invalid-webhook", "The webhook URL must not hold a user name or a password.");
  const ok = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!ok) throw new FoxnotifyError("invalid-webhook", "The webhook URL must use https:, or http: on localhost.");
  return url.href;
}

const top = (notices: Notice[]): Priority =>
  notices.reduce<Priority>((best, n) => (PRIORITIES.indexOf(n.priority) > PRIORITIES.indexOf(best) ? n.priority : best), "low");

/** Build the request for a message. The preview and the send both use it. */
function build(options: WebhookOptions, message: Message): WebhookRequest {
  const url = checkUrl(options.url);
  const first = message.notices[0];
  const count = message.notices.length + message.dropped;
  const one = !message.digest && first !== undefined;
  const kind = one ? first.kind : "digest";
  const priority = one ? first.priority : top(message.notices);
  const text = one ? (SUMMARY[textKey(first)] ?? "A task needs you.") : `${count} updates from your agent.`;
  const titles = message.notices.map((n) => n.title);
  if (options.format === "ntfy") {
    const body = options.includeTitle ? [text, ...titles].join("\n") : text;
    const headers = { "Content-Type": "text/plain; charset=utf-8", Title: "foxnotify", Priority: NTFY_PRIORITY[priority], Tags: kind };
    return { url, method: "POST", headers, body };
  }
  const at = new Date(one ? first.at : Math.max(...message.notices.map((n) => n.at))).toISOString();
  const json: Record<string, unknown> = { source: "foxnotify", kind, priority, text, at };
  if (!one) json.count = count;
  if (options.includeTitle) {
    if (one) json.title = first.title;
    else json.titles = titles;
  }
  return { url, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) };
}

const SAMPLE: Notice = { key: "needs-approval:sample", kind: "needs-approval", taskId: "sample", title: "Example task", priority: "high", at: 0 };

/**
 * Show what the webhook will send, before the user turns it on. With no
 * message, it uses a sample approval notice. Throws `invalid-webhook`.
 */
export function previewWebhook(options: WebhookOptions, message?: Message): WebhookRequest {
  const sample: Message = { digest: false, notices: [{ ...SAMPLE, at: Date.now() }], dropped: 0, title: "", body: "" };
  return build(options, message ?? sample);
}

/** A channel that posts each notice and digest to a URL. Throws `invalid-webhook` for a bad URL. */
export function webhookChannel(options: WebhookOptions): Channel {
  checkUrl(options.url);
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    name: "webhook",
    async send(message) {
      const request = build(options, message);
      const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs);
      let response: Response;
      try {
        response = await doFetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          signal: abort.signal,
        });
      } catch (error) {
        // Never repeat or attach the error: its text can hold the URL, and the URL can hold a token.
        // oxlint-disable-next-line preserve-caught-error -- the cause would leak the URL
        if (abort.signal.aborted) throw new Error(`The webhook did not answer in ${timeoutMs} ms.`);
        // oxlint-disable-next-line preserve-caught-error -- the cause would leak the URL
        throw new Error(`The webhook request failed (${error instanceof Error ? error.name : "error"}).`);
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`The webhook answered ${response.status}.`);
    },
  };
}
