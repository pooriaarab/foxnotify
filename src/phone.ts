import type { Channel, Message } from "./notifier.js";

/** The part of a foxsync `Link` that foxnotify uses. foxnotify does not import foxsync. */
export interface PhoneLink {
  readonly isOpen: boolean;
  send(type: string, payload?: unknown): Promise<void>;
}

type Sender = { id?: string; url?: string };
type OnMessage = (message: unknown, sender: Sender) => Promise<unknown> | undefined;

/** The parts of `browser.runtime` that the phone link uses. */
export interface PhoneRuntime {
  id: string;
  getURL(path: string): string;
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: { addListener(fn: OnMessage): void; removeListener(fn: OnMessage): void };
}

const TYPE = "fnt:phone";
const MAX_TEXT = 1000;

type Reply = { ok: true } | { ok: false; error: string };

/**
 * A channel for the event page. It hands each notice to the page that holds
 * the foxsync link (see `servePhoneLink`). The phone shows it as a note.
 */
export function phoneChannel(runtime: PhoneRuntime, options: { timeoutMs?: number } = {}): Channel {
  const timeoutMs = options.timeoutMs ?? 5000;
  return {
    name: "phone",
    async send(message: Message) {
      const text = `${message.title}: ${message.body}`.slice(0, MAX_TEXT);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`The phone page did not answer in ${timeoutMs} ms.`)), timeoutMs);
      });
      let reply: unknown;
      try {
        reply = await Promise.race([runtime.sendMessage({ type: TYPE, text }).catch(() => undefined), late]);
      } finally {
        clearTimeout(timer);
      }
      const r = reply as Reply | undefined;
      if (!r || typeof r !== "object" || !("ok" in r)) throw new Error("No page holds an open phone link.");
      if (!r.ok) throw new Error(r.error);
    },
  };
}

/**
 * Run this in the page that holds the foxsync link, such as the sidebar.
 * It sends each phone notice from the event page to the phone as a `note`.
 * Returns a function that stops it.
 */
export function servePhoneLink(runtime: PhoneRuntime, link: PhoneLink): () => void {
  const own = runtime.getURL("");
  const listener: OnMessage = (message, sender) => {
    const m = message as { type?: unknown; text?: unknown } | null;
    if (!m || m.type !== TYPE || typeof m.text !== "string") return undefined;
    if (sender.id !== runtime.id || !sender.url?.startsWith(own)) return undefined;
    if (!link.isOpen) return Promise.resolve<Reply>({ ok: false, error: "The phone link is closed." });
    return link.send("note", { text: m.text.slice(0, MAX_TEXT) }).then(
      (): Reply => ({ ok: true }),
      (error: unknown): Reply => ({ ok: false, error: `The phone link failed: ${error instanceof Error ? error.message : String(error)}` }),
    );
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
}
