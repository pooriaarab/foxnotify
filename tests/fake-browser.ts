// A small stand-in for the WebExtension APIs that the notifier uses. It keeps
// state in memory, so a test can drop the listeners (an event page unload)
// and make a new notifier on the same storage.
type Fn = (...args: never[]) => unknown;

export interface FakeTab {
  id: number;
  windowId: number;
  active: boolean;
  url: string;
}

export function fakeBrowser() {
  let listeners: Record<string, Fn[]> = {};
  const on = (name: string) => ({ addListener: (fn: Fn) => void (listeners[name] ??= []).push(fn) });
  const fire = async (name: string, ...args: unknown[]) => {
    for (const fn of listeners[name] ?? []) await (fn as (...a: unknown[]) => unknown)(...args);
  };
  const shown = new Map<string, { title: string; message: string }>();
  const alarms = new Map<string, number>();
  const tabs: FakeTab[] = [
    { id: 1, windowId: 1, active: true, url: "http://127.0.0.1/a" },
    { id: 2, windowId: 2, active: true, url: "http://127.0.0.1/b" },
  ];
  const fake = {
    failCreate: false,
    focusedWindow: 2,
    shown,
    alarms,
    tabs,
    created: [] as string[],
    /** Drop every listener, as when Firefox unloads the event page. */
    unload: () => void (listeners = {}),
    click: (id: string) => fire("clicked", id),
    close: (id: string) => fire("closed", id),
    alarm: (name: string) => fire("alarm", { name }),
  };
  const browser = {
    notifications: {
      create: async (id: string, opts: { title: string; message: string }) => {
        if (fake.failCreate) throw new Error("notifications are off");
        shown.set(id, { title: opts.title, message: opts.message });
        return id;
      },
      clear: async (id: string) => shown.delete(id),
      onClicked: on("clicked"),
      onClosed: on("closed"),
    },
    alarms: {
      create: (name: string, info: { when: number }) => void alarms.set(name, info.when),
      clear: async (name: string) => alarms.delete(name),
      onAlarm: on("alarm"),
    },
    tabs: {
      get: async (id: number) => {
        const tab = tabs.find((t) => t.id === id);
        if (!tab) throw new Error(`Invalid tab ID: ${id}`);
        return tab;
      },
      update: async (id: number, props: { active?: boolean }) => {
        const tab = tabs.find((t) => t.id === id);
        if (!tab) throw new Error(`Invalid tab ID: ${id}`);
        if (props.active) for (const t of tabs) if (t.windowId === tab.windowId) t.active = t.id === id;
        return tab;
      },
      query: async () => tabs,
      create: async (props: { url: string }) => {
        const tab = { id: tabs.length + 10, windowId: 1, active: true, url: props.url };
        for (const t of tabs) if (t.windowId === 1) t.active = false;
        tabs.push(tab);
        fake.created.push(props.url);
        return tab;
      },
    },
    windows: {
      update: async (id: number, props: { focused?: boolean }) => {
        if (props.focused) fake.focusedWindow = id;
        return { id };
      },
    } as { update(id: number, props: { focused?: boolean }): Promise<unknown> } | undefined,
    runtime: { getURL: (path: string) => `moz-extension://test/${path}` },
  };
  return { browser, fake };
}

export function memoryStorage() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key: string) => (data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
  };
}
