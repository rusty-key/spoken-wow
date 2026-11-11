/** Both the page and the Spoken Manager import this, so it stays free of Node and of site aliases. */
import { MAX_ENVELOPES } from "./saved-variables";

/** Under nginx's 16 MB limit on the batch route, with room to spare. */
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

const encoder = new TextEncoder();

export function chunksOf(
  envelopes: readonly string[],
  maxCount = MAX_ENVELOPES,
  maxBytes = MAX_REQUEST_BYTES,
): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const envelope of envelopes) {
    const size = encoder.encode(envelope).length + 4;
    if (current.length > 0 && (current.length >= maxCount || bytes + size > maxBytes)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(envelope);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

type UploadOutcome = {
  /** Counted from the start of the list, so what is left is `envelopes.slice(sent)`. */
  sent: number;
  accepted: number;
  refused: number;
  /** The status that stopped it, null for no response at all; undefined when everything arrived. */
  failedWith?: number | null;
};

export async function sendInChunks(
  envelopes: readonly string[],
  post: (chunk: string[]) => Promise<Response | null>,
  onProgress: (sent: number) => void = () => {},
  /** What earlier tries of this file got through, so the totals cover the whole file. */
  carried = { accepted: 0, refused: 0 },
): Promise<UploadOutcome> {
  const outcome: UploadOutcome = { sent: 0, ...carried };
  for (const chunk of chunksOf(envelopes)) {
    const response = await post(chunk);
    if (!response?.ok) return { ...outcome, failedWith: response?.status ?? null };
    // A connection dropped after the headers, or a proxy's page answered with a 200.
    const body = (await response.json().catch(() => null)) as {
      accepted: number;
      refused: Record<string, number>;
    } | null;
    if (!body?.refused) return { ...outcome, failedWith: null };
    outcome.sent += chunk.length;
    outcome.accepted += body.accepted;
    outcome.refused += Object.values(body.refused).reduce((total, count) => total + count, 0);
    onProgress(outcome.sent);
  }
  return outcome;
}
