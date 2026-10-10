import { type Notice, type NoticeEvent, type NoticeKind, type RulesInput, type Target, isRecord, parseRules } from "./rules.js";
import { type Decision, type State, clear, decide, flushDue, mute, parseState, unmute } from "./state.js";
import { digestText, noticeText } from "./text.js";

type Listener<F> = { addListener(fn: F): void };

/** The parts of the `browser` object that the notifier uses. */
export interface NotifierBrowser {
  notifications: {
    create(id: string, options: { type: "basic"; title: string; message: string; iconUrl?: string }): Promise<string>;
    clear(id: string): Promise<boolean>;
    onClicked: Listener<(id: string) => unknown>;
    onClosed: Listener<(id: string) => unknown>;
  };
  alarms: {
    create(name: string, info: { when: number }): void;
    clear(name: string): Promise<boolean>;
    onAlarm: Listener<(alarm: { name: string }) => unknown>;
  };
  tabs: {
    get(id: number): Promise<{ id?: number; windowId?: number }>;
    update(id: number, props: { active: boolean }): Promise<unknown>;
    query(info: Record<string, never>): Promise<{ id?: number; windowId?: number; url?: string }[]>;
    create(props: { url: string }): Promise<unknown>;
  };
  /** Missing on Android. Then a click makes the tab active only. */
  windows?: { update(id: number, props: { focused: boolean }): Promise<unknown> };
  runtime: { getURL(path: string): string };
}

/** A storage area such as `browser.storage.local`. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** What a channel gets: one notice, or a digest of several. */
export interface Message {
  digest: boolean;
  notices: Notice[];
  /** Notices that the queue cap dropped. They count in a digest. */
  dropped: number;
  /** The desktop text. It holds the cleaned task titles. */
  title: string;
  body: string;
}

/** Another place to send notices, such as a webhook or the phone link. */
export interface Channel {
  name: string;
  send(message: Message): Promise<void>;
}

export interface NotifierOptions {
  browser: NotifierBrowser;
  storage: StorageAreaLike;
  /** Rules until `setRules` saves others. */
  rules?: RulesInput;
  channels?: Channel[];
  /** Show desktop notices. Default true. */
  desktop?: boolean;
  iconUrl?: string;
  /** An extension page that a click opens when the notice has no target, for example a list of pending approvals. */
  fallbackUrl?: string;
  now?: () => number;
  /** Called after a click is routed. It gets no way to approve anything. */
  onClick?: (info: { key: string; taskId: string; kind: NoticeKind | "digest" }) => void;
}

export interface Delivery {
  delivered: string[];
  errors: { channel: string; message: string }[];
}

export interface NotifyResult extends Delivery {
  decision: Decision;
  notice: Notice;
}

interface ClickEntry {
  key: string;
  taskId: string;
  kind: NoticeKind | "digest";
  target?: Target;
  at: number;
}

const STATE = "fnt:state";
const RULES = "fnt:rules";
const CLICKS = "fnt:clicks";
const ALARM = "fnt:flush";
const PREFIX = "fnt:";
const CLICKS_MAX = 50;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Make the notifier in the background script. Call it in the first turn of
 * the script, so its click and alarm listeners exist on every wake.
 */
export function createNotifier(options: NotifierOptions) {
  const { browser, storage } = options;
  const now = options.now ?? Date.now;
  const channels = options.channels ?? [];
  let chain: Promise<unknown> = Promise.resolve();
  /** Ids of notices that a new notice replaced. Their next onClosed is for the old notice. */
  const replaced = new Set<string>();
  /** Run one state change at a time in this page. */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const read = async <T>(key: string, fallback: T): Promise<T> => ((await storage.get(key))[key] as T | undefined) ?? fallback;
  const loadState = async () => parseState(await read<unknown>(STATE, null));
  const loadRulesInput = async () => read<RulesInput>(RULES, options.rules ?? {});
  const loadClicks = async () => {
    const value = await read<unknown>(CLICKS, {});
    return (isRecord(value) ? value : {}) as Record<string, ClickEntry>;
  };
  const saveClicks = (clicks: Record<string, ClickEntry>) => {
    const newest = Object.entries(clicks)
      .toSorted((a, b) => a[1].at - b[1].at)
      .slice(-CLICKS_MAX);
    return storage.set({ [CLICKS]: Object.fromEntries(newest) });
  };

  async function syncAlarm(state: State): Promise<void> {
    if (state.flushAt === null) await browser.alarms.clear(ALARM);
    else browser.alarms.create(ALARM, { when: state.flushAt });
  }

  async function deliver(message: Message, id: string, entry: ClickEntry): Promise<Delivery> {
    const out: Delivery = { delivered: [], errors: [] };
    const jobs: [string, () => Promise<unknown>][] = [];
    if (options.desktop !== false) {
      jobs.push([
        "desktop",
        async () => {
          await serial(async () => {
            const clicks = await loadClicks();
            // Firefox replaces a notice with the same id and may send onClosed for the old one.
            if (id in clicks) replaced.add(id);
            await saveClicks({ ...clicks, [id]: entry });
          });
          await browser.notifications.create(id, { type: "basic", title: message.title, message: message.body, ...(options.iconUrl ? { iconUrl: options.iconUrl } : {}) });
        },
      ]);
    }
    for (const channel of channels) jobs.push([channel.name, () => channel.send(message)]);
    const results = await Promise.allSettled(jobs.map(([, run]) => run()));
    results.forEach((r, i) => {
      const name = jobs[i]![0];
      if (r.status === "fulfilled") out.delivered.push(name);
      else out.errors.push({ channel: name, message: errorText(r.reason) });
    });
    return out;
  }

  const single = (notice: Notice): Promise<Delivery> => {
    const { title, body } = noticeText(notice);
    const entry: ClickEntry = { key: notice.key, taskId: notice.taskId, kind: notice.kind, at: now(), ...(notice.target ? { target: notice.target } : {}) };
    return deliver({ digest: false, notices: [notice], dropped: 0, title, body }, PREFIX + notice.key, entry);
  };

  const digest = (notices: Notice[], dropped: number): Promise<Delivery> => {
    if (notices.length === 1 && dropped === 0) return single(notices[0]!);
    const { title, body } = digestText(notices, dropped);
    const at = now();
    return deliver({ digest: true, notices, dropped, title, body }, `${PREFIX}digest:${at}`, { key: "digest", taskId: "", kind: "digest", at });
  };

  async function flushNow(): Promise<Delivery & { notices: Notice[] }> {
    const out = await serial(async () => {
      const r = flushDue(await loadState(), parseRules(await loadRulesInput()), now());
      await storage.set({ [STATE]: r.state });
      await syncAlarm(r.state);
      return r;
    });
    const delivery = out.notices.length ? await digest(out.notices, out.dropped) : { delivered: [], errors: [] };
    return { notices: out.notices, ...delivery };
  }

  async function focus(target: Target | undefined): Promise<"tab" | "url" | "none"> {
    if (target?.tabId !== undefined) {
      try {
        const tab = await browser.tabs.get(target.tabId);
        await browser.tabs.update(target.tabId, { active: true });
        if (browser.windows && tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
        return "tab";
      } catch {
        // The tab is gone. Fall back to the URL.
      }
    }
    const url = target?.url ?? (options.fallbackUrl ? browser.runtime.getURL(options.fallbackUrl) : undefined);
    if (!url) return "none";
    const open = (await browser.tabs.query({})).find((t) => t.url === url && t.id !== undefined);
    if (open) return focus({ tabId: open.id! }).then(() => "tab");
    await browser.tabs.create({ url });
    return "url";
  }

  /** Route a click on a notice. A click only focuses a tab or opens a page. */
  async function click(id: string): Promise<"tab" | "url" | "none" | "ignored"> {
    if (!id.startsWith(PREFIX)) return "ignored";
    const entry = await serial(async () => {
      const clicks = await loadClicks();
      const found = clicks[id];
      delete clicks[id];
      if (found) await saveClicks(clicks);
      return found;
    });
    if (!entry) return "ignored";
    await browser.notifications.clear(id).catch(() => false);
    const how = await focus(entry.target);
    options.onClick?.({ key: entry.key, taskId: entry.taskId, kind: entry.kind });
    return how;
  }

  // The listeners return their promise, so a caller can wait. Firefox ignores it.
  browser.notifications.onClicked.addListener((id) => click(id));
  browser.notifications.onClosed.addListener((id) => {
    if (!id.startsWith(PREFIX)) return undefined;
    if (replaced.delete(id)) return undefined;
    return serial(async () => {
      const clicks = await loadClicks();
      if (!(id in clicks)) return;
      delete clicks[id];
      await saveClicks(clicks);
    });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    return alarm.name === ALARM ? flushNow() : undefined;
  });

  /** On each load: flush a flush time that has passed, else set the alarm again. */
  const ready = flushNow().then(() => undefined);

  const update = (change: (state: State) => State) =>
    serial(async () => {
      const state = change(await loadState());
      await storage.set({ [STATE]: state });
      await syncAlarm(state);
      return state;
    });

  return {
    /** Resolves when the load check is done. */
    ready,
    /** Report one agent event. Throws `invalid-event` for a bad event. */
    async notify(event: NoticeEvent): Promise<NotifyResult> {
      const result = await serial(async () => {
        const r = decide(await loadState(), event, parseRules(await loadRulesInput()), now());
        await storage.set({ [STATE]: r.state });
        await syncAlarm(r.state);
        return r;
      });
      if (result.decision.action !== "send") return { decision: result.decision, notice: result.notice, delivered: [], errors: [] };
      const delivery = await single(result.notice);
      // A clear(key) that ran while the notice was on its way removed the key. Close the notice.
      const after = await serial(loadState);
      if (!(result.notice.key in after.seen)) await browser.notifications.clear(PREFIX + result.notice.key).catch(() => false);
      return { decision: result.decision, notice: result.notice, ...delivery };
    },
    /** Show the queued notices when their time has come. The alarm calls this. */
    flush: flushNow,
    /** Close the notice for this key and remove a queued copy, for example when the approval is answered. */
    async clear(key: string): Promise<void> {
      await update((s) => clear(s, key));
      await browser.notifications.clear(PREFIX + key).catch(() => false);
    },
    mute: (taskId: string) => update((s) => mute(s, taskId)).then(() => undefined),
    unmute: (taskId: string) => update((s) => unmute(s, taskId)).then(() => undefined),
    /** Check and save rules. They win over `options.rules`. Throws `invalid-rules`. */
    async setRules(input: RulesInput): Promise<void> {
      parseRules(input);
      await serial(() => storage.set({ [RULES]: input }));
    },
    getRules: loadRulesInput,
    state: (): Promise<State> => serial(loadState),
    click,
  };
}

export type Notifier = ReturnType<typeof createNotifier>;
