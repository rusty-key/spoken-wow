/** An error as one line fit to store in a bucket's or a move's `lastError`. */
export const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 300);
