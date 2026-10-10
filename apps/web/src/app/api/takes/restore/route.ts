/**
 * Put an earlier take back, in whichever section owns the file.
 *
 * The counterpart of regeneration, and the reason regeneration is safe to offer at all: a
 * re-roll is not always an improvement, and without this the only way back would be a file
 * copy on the droplet.
 *
 * RESTORING MOVES THE LIVE FLAG, and does nothing else: no new take, no file read or
 * written. Every take is its own archived file, so the history is the set of takes this
 * line has had, and restoring says which of them is right. It is the same thing `restore`
 * means for a lore version (lib/zones/lore.ts).
 *
 * Holds the same lock a regeneration does. A restore landing while a regeneration of the
 * same file is in flight would race it to decide which take is live, and whichever wrote
 * last would win without the other's author ever seeing why.
 */
import { requireIn } from "@/lib/generation/authz";
import { BUSY, withTakeLock } from "@/lib/generation/lock";

import { isAddressableFile } from "@/lib/takes/files";
import { restoreTake } from "@/lib/takes/restore";
import { isSource } from "@/lib/sections";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { lang, session, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    source?: unknown;
    file?: unknown;
    version?: unknown;
  };

  if (!isSource(body.source)) {
    return Response.json({ error: "source must be quests, zones or books" }, { status: 400 });
  }
  const source = body.source;

  if (typeof body.file !== "string" || !(await isAddressableFile(source, body.file, lang))) {
    return Response.json({ error: "unknown file" }, { status: 404 });
  }
  if (typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 1) {
    return Response.json({ error: "version must be a whole number" }, { status: 400 });
  }

  const file = body.file;
  const version = body.version;

  const outcome = await withTakeLock(source, file, async () => {
    try {
      await restoreTake(source, file, version, lang, session.user.id);
      return { ok: true as const };
    } catch (error) {
      // restoreTake refuses a version that was never recorded, and one whose clip was not
      // kept. Both are the caller asking for something that does not exist, and both leave
      // the live take where it was.
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }, lang);

  if (outcome === BUSY) {
    return Response.json(
      { error: `${file} is being regenerated; try again in a moment` },
      { status: 409 },
    );
  }
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: 404 });
  }

  return Response.json({ source, file, version });
}
