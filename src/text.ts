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
