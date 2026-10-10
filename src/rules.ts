import { FoxnotifyError } from "./errors.js";
import { cleanTitle } from "./text.js";

export const KINDS = ["needs-approval", "needs-sign-in", "task-done", "task-stuck", "schedule-missed"] as const;
export type NoticeKind = (typeof KINDS)[number];
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Where a click on the notice goes. */
export interface Target {
  /** Focus this tab and its window. */
  tabId?: number;
  /** Open this URL, or focus a tab that already shows it. An extension page that lists the pending approval fits. */
  url?: string;
}

/** What an agent reports. */
export interface NoticeEvent {
  kind: NoticeKind;
  taskId: string;
  /** The task title. It is the only free text in a notice. foxnotify hides secrets in it. */
  title: string;
  priority?: Priority;
  target?: Target;
  /** The de-duplicate key. Default: `<kind>:<taskId>`. */
  key?: string;
  /** For `task-stuck`: the task cannot go on, or it stopped before it finished. */
  reason?: "stuck" | "cut-short";
}

/** A checked event, as foxnotify stores it. */
export interface Notice {
  key: string;
  kind: NoticeKind;
  taskId: string;
  title: string;
  priority: Priority;
  at: number;
  target?: Target;
  reason?: "stuck" | "cut-short";
}

export interface RulesInput {
  /** Priority per kind. Defaults: approval and sign-in `high`, stuck `normal`, done and missed `low`. */
  priorities?: Partial<Record<NoticeKind, Priority>>;
  /** Local times "HH:MM". A notice below `bypass` (default `urgent`) waits until the end. */
  quietHours?: { start: string; end: string; bypass?: Priority } | null;
  /** Drop a repeat of a key within this time. Default 10. */
  dedupeMinutes?: number;
  /** At most `max` notices at once per `perMinutes`. The rest go to the digest. Default 4 per 1. */
  rateLimit?: { max: number; perMinutes: number };
  /** Low-priority notices wait this long and then show as one digest. Default 60. */
  digestMinutes?: number;
}

export interface Rules {
  priorities: Record<NoticeKind, Priority>;
  quietHours: { start: number; end: number; bypass: Priority } | null;
  dedupeMs: number;
  rateLimit: { max: number; perMs: number };
  digestMs: number;
}

const MINUTE = 60_000;
const DEFAULT_PRIORITIES: Record<NoticeKind, Priority> = {
  "needs-approval": "high",
  "needs-sign-in": "high",
  "task-stuck": "normal",
  "task-done": "low",
  "schedule-missed": "low",
};

export const rank = (p: Priority) => PRIORITIES.indexOf(p);
export const isPriority = (p: unknown): p is Priority => PRIORITIES.includes(p as Priority);
const bad = (message: string) => new FoxnotifyError("invalid-rules", message);

function clock(text: unknown): number {
  const m = typeof text === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text) : null;
  if (!m) throw bad(`A time must be "HH:MM" from 00:00 to 23:59, not ${JSON.stringify(text)}.`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutes(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw bad(`${name} must be a number of 0 or more.`);
  return value;
}

/** Check rules and fill in the defaults. Throws `invalid-rules`. */
export function parseRules(input: RulesInput = {}): Rules {
  const priorities = { ...DEFAULT_PRIORITIES };
  for (const [kind, p] of Object.entries(input.priorities ?? {})) {
    if (!KINDS.includes(kind as NoticeKind)) throw bad(`Unknown kind ${JSON.stringify(kind)}.`);
    if (!isPriority(p)) throw bad(`Unknown priority ${JSON.stringify(p)} for ${kind}.`);
    priorities[kind as NoticeKind] = p;
  }
  let quietHours: Rules["quietHours"] = null;
  if (input.quietHours) {
    const bypass = input.quietHours.bypass ?? "urgent";
    if (!isPriority(bypass)) throw bad(`Unknown bypass priority ${JSON.stringify(bypass)}.`);
    const start = clock(input.quietHours.start);
    const end = clock(input.quietHours.end);
    if (start !== end) quietHours = { start, end, bypass };
  }
  const rate = input.rateLimit ?? { max: 4, perMinutes: 1 };
  if (!Number.isInteger(rate.max) || rate.max < 1) throw bad("rateLimit.max must be a whole number of 1 or more.");
  const perMinutes = minutes(rate.perMinutes, "rateLimit.perMinutes", 1);
  const digestMinutes = minutes(input.digestMinutes, "digestMinutes", 60);
  if (perMinutes <= 0 || digestMinutes <= 0) throw bad("rateLimit.perMinutes and digestMinutes must be more than 0.");
  return {
    priorities,
    quietHours,
    dedupeMs: minutes(input.dedupeMinutes, "dedupeMinutes", 10) * MINUTE,
    rateLimit: { max: rate.max, perMs: perMinutes * MINUTE },
    digestMs: digestMinutes * MINUTE,
  };
}

const minuteOfDay = (now: number) => {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
};

/** True when `now` is in the quiet hours, in local time. */
export function isQuiet(rules: Rules, now: number): boolean {
  const q = rules.quietHours;
  if (!q) return false;
  const m = minuteOfDay(now);
  return q.start < q.end ? m >= q.start && m < q.end : m >= q.start || m < q.end;
}

/** The next end of quiet hours after `now`, in local time. */
export function quietEndsAt(rules: Rules, now: number): number | null {
  const q = rules.quietHours;
  if (!q) return null;
  const end = new Date(now);
  end.setHours(Math.floor(q.end / 60), q.end % 60, 0, 0);
  if (end.getTime() <= now) end.setDate(end.getDate() + 1);
  return end.getTime();
}


export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fail = (message: string) => new FoxnotifyError("invalid-event", message);

/** Check an event and turn it into a notice. Throws `invalid-event`. */
export function toNotice(event: NoticeEvent, rules: Rules, now: number): Notice {
  if (!isRecord(event) || !KINDS.includes(event.kind)) throw fail(`Unknown kind ${JSON.stringify(event?.kind)}.`);
  if (typeof event.taskId !== "string" || !event.taskId.trim()) throw fail("taskId must be a non-empty string.");
  const title = typeof event.title === "string" ? cleanTitle(event.title) : "";
  if (!title) throw fail("title must be a non-empty string.");
  if (event.key !== undefined && (typeof event.key !== "string" || !event.key)) throw fail("key must be a non-empty string.");
  if (event.priority !== undefined && !isPriority(event.priority)) throw fail(`Unknown priority ${JSON.stringify(event.priority)}.`);
  const notice: Notice = {
    key: event.key ?? `${event.kind}:${event.taskId}`,
    kind: event.kind,
    taskId: event.taskId,
    title,
    priority: event.priority ?? rules.priorities[event.kind],
    at: now,
  };
  if (event.target) {
    const target: Target = {};
    if (Number.isInteger(event.target.tabId)) target.tabId = event.target.tabId;
    if (typeof event.target.url === "string") target.url = event.target.url;
    notice.target = target;
  }
  if (event.kind === "task-stuck") notice.reason = event.reason === "cut-short" ? "cut-short" : "stuck";
  return notice;
}
