/**
 * Before a team's bucket takes any object, it shows it does what the archive relies on: a PUT that
 * keeps the first bytes under a key, the size from a HEAD, a ranged GET with the whole size, a 404
 * for a key that is not there, and a browser able to fetch the object, by its public address or a
 * signed one. All under `probe/`, deleted afterwards when the key allows it.
 */
import "server-only";

import { randomBytes } from "node:crypto";

import type { BlobStore } from "@/lib/blobs/store";

export type ProbeStep = { name: string; ok: boolean; detail?: string };

export type ProbeResult = {
  ok: boolean;
  steps: ProbeStep[];
  /** Whether the bucket kept the first bytes when a second PUT under the key asked it not to replace them. */
  conditionalPut: boolean;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

export async function probe(
  store: BlobStore,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<ProbeResult> {
  const steps: ProbeStep[] = [];
  const key = `probe/${randomBytes(16).toString("hex")}`;
  const first = randomBytes(1024);
  let conditionalPut = true;
  // What the bucket holds under the key: the second bytes, when it let them replace the first.
  let held = first;

  const step = async (name: string, check: () => Promise<string | void>): Promise<boolean> => {
    try {
      const problem = await check();
      steps.push(problem ? { name, ok: false, detail: problem } : { name, ok: true });
      return !problem;
    } catch (error) {
      steps.push({ name, ok: false, detail: message(error) });
      return false;
    }
  };

  const wrote = await step("Write an object", () => store.put(key, first, "application/octet-stream"));
  if (wrote) {
    await step("Never replace an object", async () => {
      await store.put(key, randomBytes(1024), "application/octet-stream");
      const kept = await store.get(key);
      const bytes = kept?.body ? Buffer.from(await new Response(kept.body).arrayBuffer()) : null;
      if (!bytes) return "the object was gone after a second write";
      // Not a failure: the store looks before it writes from now on.
      conditionalPut = bytes.equals(first);
      held = bytes;
    });
    await step("Read its size", async () => {
      const head = await store.head(key);
      if (head?.size !== first.byteLength) return `expected ${first.byteLength} bytes, got ${head?.size ?? "nothing"}`;
    });
    await step("Read part of it", async () => {
      const part = await store.get(key, { start: 2, end: 5 });
      if (!part?.body) return "nothing came back";
      const bytes = Buffer.from(await new Response(part.body).arrayBuffer());
      if (part.size !== first.byteLength) return `the whole size came back as ${part.size}`;
      if (!bytes.equals(held.subarray(2, 6))) return "the bytes came back wrong: the bucket may ignore Range";
    });
    await step("Let a browser fetch it", async () => {
      const url = store.url(key) ?? (await store.presign(key, { method: "GET", expiresSec: 60 }));
      const res = await fetchImpl(url, { redirect: "follow" });
      if (!res.ok) return `HTTP ${res.status} from ${store.url(key) ? "the public address" : "a signed address"}`;
      if (!Buffer.from(await res.arrayBuffer()).equals(held)) return "the address answered with other bytes";
    });
  }
  await step("Say when an object is not there", async () => {
    if ((await store.get(`${key}-absent`)) !== null) return "a key never written answered with an object";
  });
  if (wrote) await store.delete(key).catch(() => {});

  return { ok: steps.every((s) => s.ok), steps, conditionalPut };
}
