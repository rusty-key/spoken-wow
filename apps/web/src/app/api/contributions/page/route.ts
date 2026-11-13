/**
 * A moderator's answer to "which page is this?" for a readables contribution: a page in any
 * language, a place in a book, or a new book. Stored on the contribution; where there is no
 * answer, the matcher's own decision stands. Refused once the row's page is written, which is
 * one-way.
 *
 * Gated on the row's language: whoever may edit it.
 */
import { requireCapability } from "@/lib/generation/authz";
import { loadBookCorpus, matchBook } from "@/lib/contributions/book-match";
import { contributionLocale, setContributionMatch, type BookAnswer } from "@/lib/contributions/store";
import { BASE_LANG, isLang } from "@/lib/lang";
import { INT32_MAX } from "@/lib/npc/npc";

export const dynamic = "force-dynamic";

function answerOf(body: Record<string, unknown>): BookAnswer | undefined {
  if (body.clear === true) return null;
  if (body.newBook === true) return { newBook: true };
  if (typeof body.lineId === "string" && /^b:(\d+|n[0-9a-f-]{36})$/.test(body.lineId)) return { lineId: body.lineId };
  if (typeof body.bookId === "string" && typeof body.pageNumber === "number"
      && Number.isInteger(body.pageNumber) && body.pageNumber > 0 && body.pageNumber <= 1000) {
    return { bookId: body.bookId, pageNumber: body.pageNumber };
  }
  return undefined;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0 || id > INT32_MAX) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }
  const answer = answerOf(body);
  if (answer === undefined) {
    return Response.json({ error: "a page, a book and page number, a new book, or clear" }, { status: 400 });
  }

  // Permission before existence, as ../npc-identity does, so a member learns nothing about which ids exist.
  const locale = await contributionLocale(id);
  const { session, denied } = await requireCapability("text", isLang(locale) ? locale : BASE_LANG);
  if (denied) return denied;

  const corpus = await loadBookCorpus();
  if (answer && "lineId" in answer && !corpus.pages.some((p) => p.lineId === answer.lineId)) {
    return Response.json({ error: `${answer.lineId} is not a page` }, { status: 400 });
  }
  if (answer && "bookId" in answer && !corpus.pages.some((p) => p.bookId === answer.bookId)) {
    return Response.json({ error: `there is no book ${answer.bookId}` }, { status: 400 });
  }

  const recorded = await setContributionMatch(id, answer, session.user.id);
  if (!recorded) {
    return Response.json({ error: "no such readables contribution, or its page is already written" }, { status: 409 });
  }
  return Response.json({ ok: true, match: matchBook(recorded, corpus) });
}
