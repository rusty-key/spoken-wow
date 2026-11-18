/** An error as one line fit to store in a bucket's or a move's `lastError`. */
export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300);
