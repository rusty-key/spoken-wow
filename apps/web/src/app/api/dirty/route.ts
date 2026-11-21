/**
 * Clearing the mark on audio that predates a pronunciation change.
 *
 * One route for all three sections, because `take` and `take_ack` are one pair of tables
 * keyed by source -- three routes would be three places for the same rule to drift.
 *
 * Whoever may regenerate the language, the same boundary as a regeneration and for the same reason:
 * this says a take is fine as it stands, which is the decision NOT to spend on replacing
 * it. Both verdicts belong to the same people.
 *
 * Keyed on files, not lines. What is dirty is a recording, and 1,076 quests files are
 * addressed by several lines apiece -- see migration 0029.
 */
import { acknowledge } from "@/lib/generation/dirty";
import { requireIn } from "@/lib/generation/authz";
import { isSource } from "@/lib/sections";

export const dynamic = "force-dynamic";

type Body = { source?: unknown; files?: unknown };

/** How many files one call may acknowledge. "Clear all" on a wide filter is the caller. */
const MAX_FILES = 20_000;

export async function POST(request: Request) {
  const { session, lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  const { source, files } = (await request.json().catch(() => ({}))) as Body;

  if (!isSource(source)) {
    return Response.json({ error: "source must be 'quests', 'places', 'readables' or 'bosses'" }, { status: 400 });
  }
  if (!Array.isArray(files) || files.some((file) => typeof file !== "string" || file === "")) {
    return Response.json({ error: "files must be an array of paths" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return Response.json({ error: `at most ${MAX_FILES} files per call` }, { status: 400 });
  }

  // Deduplicated here rather than left to the upsert: a page of quests results can name one
  // file several times, since several lines share it, and the insert would otherwise touch
  // the same row twice in one statement.
  const unique = [...new Set(files as string[])];

  // Unvalidated against the corpus, unlike a places flag. A row here says "the take on this
  // path has been judged"; a path with no take is inert -- nothing reads an ack except the
  // sweep, which starts from takes -- so validating would cost a query per call to prevent
  // a row that does nothing.
  await acknowledge(source, unique, session.user.id, lang);

  return Response.json({ source, cleared: unique.length });
}
