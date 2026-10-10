// Tests for the W rows in docs/failure-modes.md.
import { describe, expect, it } from "vitest";
import { type Message, FoxnotifyError, previewWebhook, toNotice, parseRules, webhookChannel } from "../src/index.js";

const AT = Date.UTC(2026, 9, 1, 12, 0);
const notice = toNotice({ kind: "needs-approval", taskId: "t1", title: "Pay the rent to Zoë" }, parseRules(), AT);
const message: Message = { digest: false, notices: [notice], dropped: 0, title: "Approval needed", body: "x" };

function fakeFetch(reply: () => Promise<Response> = async () => new Response("ok")) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return reply();
  };
  return { calls, fetch: fn as typeof fetch };
}

const code = (url: string) => {
  try {
    webhookChannel({ url });
  } catch (error) {
    return error instanceof FoxnotifyError ? error.code : "other";
  }
  return "ok";
};

const thrown = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error as Error;
  }
  throw new Error("no error");
};

describe("webhook", () => {
  it("W1 sends no title unless the user opts in", async () => {
    const f = fakeFetch();
    await webhookChannel({ url: "https://ntfy.example.org/agent", fetch: f.fetch }).send(message);
    expect(JSON.parse(String(f.calls[0]?.init.body))).toEqual({
      source: "foxnotify",
      kind: "needs-approval",
      priority: "high",
      text: "A task waits for your approval.",
      at: "2026-10-01T12:00:00.000Z",
    });
    await webhookChannel({ url: "https://ntfy.example.org/agent", includeTitle: true, fetch: f.fetch }).send(message);
    expect(JSON.parse(String(f.calls[1]?.init.body)).title).toBe("Pay the rent to Zoë");
  });

  it("W1 sends a digest as a count", async () => {
    const f = fakeFetch();
    const digest: Message = { ...message, digest: true, notices: [notice, { ...notice, kind: "task-done", priority: "low" }], dropped: 1 };
    await webhookChannel({ url: "https://ntfy.example.org/agent", fetch: f.fetch }).send(digest);
    const body = JSON.parse(String(f.calls[0]?.init.body));
    expect(body).toMatchObject({ kind: "digest", priority: "high", count: 3, text: "3 updates from your agent." });
    expect(body.titles).toBeUndefined();
  });

  it("W2 previews the exact request", async () => {
    for (const format of ["json", "ntfy"] as const) {
      const f = fakeFetch();
      const options = { url: "https://ntfy.example.org/agent", format, fetch: f.fetch };
      await webhookChannel(options).send(message);
      const preview = previewWebhook(options, message);
      expect(preview.url).toBe(f.calls[0]?.url);
      expect(preview.method).toBe(f.calls[0]?.init.method);
      expect(preview.headers).toEqual(f.calls[0]?.init.headers);
      expect(preview.body).toBe(f.calls[0]?.init.body);
    }
    expect(previewWebhook({ url: "https://ntfy.example.org/agent" }).body).toContain("A task waits for your approval.");
  });

  it("W3 refuses a URL that is not https or holds a password", () => {
    expect(code("http://ntfy.example.org/agent")).toBe("invalid-webhook");
    expect(code("https://user:pass@ntfy.example.org/agent")).toBe("invalid-webhook");
    expect(code("ftp://ntfy.example.org/agent")).toBe("invalid-webhook");
    expect(code("not a url")).toBe("invalid-webhook");
    expect(code("http://127.0.0.1:8080/agent")).toBe("ok");
    expect(code("http://localhost/agent")).toBe("ok");
    expect(code("http://[::1]/agent")).toBe("ok");
    expect(code("https://ntfy.example.org/agent")).toBe("ok");
  });

  it("W4 stops a request that never ends", async () => {
    const hang = (async (_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    const error = await thrown(webhookChannel({ url: "https://ntfy.example.org/agent", timeoutMs: 50, fetch: hang }).send(message));
    expect(error.message).toBe("The webhook did not answer in 50 ms.");
  });

  it("W5 and W6 throw on an error status without the URL", async () => {
    const f = fakeFetch(async () => new Response("no", { status: 403 }));
    const url = "https://ntfy.example.org/agent?auth=secret-token";
    const error = await thrown(webhookChannel({ url, fetch: f.fetch }).send(message));
    expect(error.message).toBe("The webhook answered 403.");
    const down = fakeFetch(async () => {
      throw new TypeError(`NetworkError when attempting to fetch ${url}`);
    });
    const net = await thrown(webhookChannel({ url, fetch: down.fetch }).send(message));
    expect(net.message).toBe("The webhook request failed (TypeError).");
    expect(net.message).not.toContain("secret-token");
  });

  it("W7 keeps headers to fixed ASCII text", async () => {
    const f = fakeFetch();
    await webhookChannel({ url: "https://ntfy.example.org/agent", format: "ntfy", includeTitle: true, fetch: f.fetch }).send(message);
    const headers = f.calls[0]?.init.headers as Record<string, string>;
    expect(headers).toEqual({ "Content-Type": "text/plain; charset=utf-8", Title: "foxnotify", Priority: "4", Tags: "needs-approval" });
    expect(f.calls[0]?.init.body).toBe("A task waits for your approval.\nPay the rent to Zoë");
  });

  it("W8 sends no cookies and no referrer", async () => {
    const f = fakeFetch();
    await webhookChannel({ url: "https://ntfy.example.org/agent", fetch: f.fetch }).send(message);
    expect(f.calls[0]?.init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  });
});
