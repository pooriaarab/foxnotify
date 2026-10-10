// Tests for the P rows in docs/failure-modes.md.
import { describe, expect, it } from "vitest";
import { type Message, parseRules, phoneChannel, servePhoneLink, toNotice } from "../src/index.js";

const ORIGIN = "moz-extension://test/";
const notice = toNotice({ kind: "needs-approval", taskId: "t1", title: "Send the invoice" }, parseRules(), 0);
const message: Message = { digest: false, notices: [notice], dropped: 0, title: "Approval needed", body: "Send the invoice: an action waits for you." };

type Sender = { id?: string; url?: string; tab?: object };
type OnMessage = (msg: unknown, sender: Sender) => Promise<unknown> | undefined;

/** runtime.sendMessage reaches the listeners of other pages, as in Firefox. */
function fakeRuntime() {
  const listeners: OnMessage[] = [];
  let sender: Sender = { id: "fnt@test", url: `${ORIGIN}background.html` };
  const runtime = {
    id: "fnt@test",
    getURL: (path: string) => ORIGIN + path,
    onMessage: {
      addListener: (fn: OnMessage) => void listeners.push(fn),
      removeListener: (fn: OnMessage) => void listeners.splice(listeners.indexOf(fn), 1),
    },
    sendMessage: async (msg: unknown) => {
      for (const fn of listeners) {
        const reply = fn(structuredClone(msg), sender);
        if (reply !== undefined) return reply;
      }
      throw new Error("Could not establish connection. Receiving end does not exist.");
    },
  };
  return { runtime, setSender: (s: Sender) => void (sender = s) };
}

function fakeLink(open = true, fail?: string) {
  const sent: { type: string; payload: unknown }[] = [];
  return {
    sent,
    link: {
      isOpen: open,
      send: async (type: string, payload?: unknown) => {
        if (fail) throw new Error(fail);
        sent.push({ type, payload });
      },
    },
  };
}

const thrown = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return (error as Error).message;
  }
  return "no error";
};

describe("phone link", () => {
  it("sends the notice as a foxsync note", async () => {
    const { runtime } = fakeRuntime();
    const { link, sent } = fakeLink();
    servePhoneLink(runtime, link);
    await phoneChannel(runtime).send(message);
    expect(sent).toEqual([{ type: "note", payload: { text: "Approval needed: Send the invoice: an action waits for you." } }]);
  });

  it("P1 throws when no page holds a link", async () => {
    const { runtime } = fakeRuntime();
    expect(await thrown(phoneChannel(runtime).send(message))).toBe("No page holds an open phone link.");
  });

  it("P2 throws when the link is closed", async () => {
    const { runtime } = fakeRuntime();
    servePhoneLink(runtime, fakeLink(false).link);
    expect(await thrown(phoneChannel(runtime).send(message))).toBe("The phone link is closed.");
  });

  it("P3 answers only the extension's own pages", async () => {
    const { runtime, setSender } = fakeRuntime();
    const { link, sent } = fakeLink();
    servePhoneLink(runtime, link);
    setSender({ id: "fnt@test", url: "http://127.0.0.1/page", tab: {} });
    expect(await thrown(phoneChannel(runtime).send(message))).toBe("No page holds an open phone link.");
    setSender({ id: "other@test", url: "moz-extension://other/x.html" });
    expect(await thrown(phoneChannel(runtime).send(message))).toBe("No page holds an open phone link.");
    expect(sent).toHaveLength(0);
  });

  it("P4 throws when link.send fails", async () => {
    const { runtime } = fakeRuntime();
    servePhoneLink(runtime, fakeLink(true, "closed").link);
    expect(await thrown(phoneChannel(runtime).send(message))).toBe("The phone link failed: closed");
  });

  it("P5 cuts long text at 1000 characters", async () => {
    const { runtime } = fakeRuntime();
    const { link, sent } = fakeLink();
    servePhoneLink(runtime, link);
    await phoneChannel(runtime).send({ ...message, body: "x".repeat(5000) });
    expect((sent[0]!.payload as { text: string }).text).toHaveLength(1000);
  });

  it("P6 stops when the page never answers", async () => {
    const { runtime } = fakeRuntime();
    runtime.onMessage.addListener(() => new Promise(() => {}));
    expect(await thrown(phoneChannel(runtime, { timeoutMs: 30 }).send(message))).toBe("The phone page did not answer in 30 ms.");
  });

  it("P7 ignores other messages and can stop", async () => {
    const { runtime } = fakeRuntime();
    const { link, sent } = fakeLink();
    const stop = servePhoneLink(runtime, link);
    runtime.onMessage.addListener((msg) => ((msg as { type?: string }).type === "ping" ? Promise.resolve("pong") : undefined));
    expect(await runtime.sendMessage({ type: "ping" })).toBe("pong");
    stop();
    expect(await thrown(phoneChannel(runtime).send(message))).toBe("No page holds an open phone link.");
    expect(sent).toHaveLength(0);
  });
});
