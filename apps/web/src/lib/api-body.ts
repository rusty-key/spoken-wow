// Reading a route's JSON body. Browser-safe: the pack rules run these in the submit form too.

export const bad = (error: string) => Response.json({ error }, { status: 400 });

/** A body that is not JSON reads as null, for the caller to refuse as not in the expected shape. */
export const bodyOf = (request: Request): Promise<unknown> => request.json().catch(() => null);

export const objectOf = (body: unknown): Record<string, unknown> | null =>
  typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
