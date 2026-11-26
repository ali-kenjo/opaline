// Errors of the expression language (docs/EXPRESSIONS.md §8).

export type ErrorCode =
  | "parse-error"
  | "unknown-function"
  | "arity"
  | "type-error"
  | "chained-comparison"
  | "too-long"
  | "too-deep";

/** A compile or run-time error at a code-point offset into the source. */
export class Diagnostic extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly at: number,
    message: string,
  ) {
    super(message);
    this.name = "Diagnostic";
  }
}

/** Longest expression or template, in code points. */
export const MAX_LEN = 4096;
/** Deepest nesting. */
export const MAX_DEPTH = 64;
