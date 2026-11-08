/**
 * Sending a gathered file request by request, stopping at the first the site does not take.
 *
 * Browser-safe: UploadGathered runs it. `sent` counts from the start of the list, so what is left
 * is `envelopes.slice(sent)`, and a player can send that without repeating what already arrived.
 */
import { chunksOf } from "./saved-variables";

export type UploadOutcome = {
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
): Promise<UploadOutcome> {
  const outcome: UploadOutcome = { sent: 0, accepted: 0, refused: 0 };
  for (const chunk of chunksOf(envelopes)) {
    const response = await post(chunk);
    if (!response?.ok) return { ...outcome, failedWith: response?.status ?? null };
    const body = (await response.json()) as { accepted: number; refused: Record<string, number> };
    outcome.sent += chunk.length;
    outcome.accepted += body.accepted;
    outcome.refused += Object.values(body.refused).reduce((total, count) => total + count, 0);
    onProgress(outcome.sent);
  }
  return outcome;
}
