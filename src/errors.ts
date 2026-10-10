export type FoxnotifyErrorCode = "invalid-event" | "invalid-rules" | "invalid-webhook";

/** Every error that foxnotify throws. Read `code`. */
export class FoxnotifyError extends Error {
  readonly code: FoxnotifyErrorCode;
  constructor(code: FoxnotifyErrorCode, message: string) {
    super(message);
    this.name = "FoxnotifyError";
    this.code = code;
  }
}
