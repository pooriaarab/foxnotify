const MAX_TITLE = 80;
const HIDDEN = "[hidden]";

/** A host for a URL, or [hidden] when it does not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || HIDDEN;
  } catch {
    return HIDDEN;
  }
}

/**
 * Make a task title safe to show: one line, at most 80 characters, with
 * secrets replaced. A URL keeps only its host. Email addresses, runs of 6 or
 * more digits (codes, card numbers) and long token-like words become [hidden].
 */
export function cleanTitle(text: string): string {
  let out = String(text)
    // oxlint-disable-next-line no-control-regex -- control characters are what this removes
    .replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ")
    .trim()
    .replace(/\bhttps?:\/\/\S+/gi, hostOf)
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, HIDDEN)
    .replace(/[A-Za-z0-9_+/=-]{20,}/g, (word) => (/\d/.test(word) && /[A-Za-z]/.test(word) ? HIDDEN : word))
    .replace(/\d(?:[ -]?\d){5,}/g, HIDDEN);
  if (out.length > MAX_TITLE) out = `${out.slice(0, MAX_TITLE - 1)}…`;
  return out;
}

const LABELS: Record<string, string> = {
  "needs-approval": "Approval needed",
  "needs-sign-in": "Sign-in needed",
  "task-done": "Task done",
  "task-stuck": "Task stuck",
  "task-cut-short": "Task cut short",
  "schedule-missed": "Schedule missed",
};

const SENTENCES: Record<string, string> = {
  "needs-approval": "an action waits for you. Click to review it.",
  "needs-sign-in": "sign in to go on. Click to open the tab.",
  "task-done": "done.",
  "task-stuck": "the task cannot go on.",
  "task-cut-short": "the task stopped before the end.",
  "schedule-missed": "did not run at its time.",
};

/** The kind and reason as one text key, for example `task-cut-short`. */
export const textKey = (notice: { kind: string; reason?: string }) =>
  notice.kind === "task-stuck" && notice.reason === "cut-short" ? "task-cut-short" : notice.kind;

/** The short label of a notice, such as "Approval needed". It never holds the title. */
export const labelOf = (notice: { kind: string; reason?: string }) => LABELS[textKey(notice)] ?? "Update";

/** The text of one notice: a fixed sentence for the kind, and the cleaned title. */
export function noticeText(notice: { kind: string; reason?: string; title: string }): { title: string; body: string } {
  return { title: labelOf(notice), body: `${notice.title}: ${SENTENCES[textKey(notice)] ?? ""}`.trim() };
}

/** The text of a digest: one line per notice, at most 5 lines. */
export function digestText(notices: { kind: string; reason?: string; title: string }[], dropped = 0): { title: string; body: string } {
  const lines = notices.slice(0, 5).map((n) => `${labelOf(n)}: ${n.title}`);
  const more = notices.length - lines.length + dropped;
  if (more > 0) lines.push(`and ${more} more.`);
  return { title: `${notices.length + dropped} updates from your agent`, body: lines.join("\n") };
}
