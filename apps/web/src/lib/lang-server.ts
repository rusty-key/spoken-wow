/**
 * The language a request is in, on the server: from `?lang=` for an API route, from the
 * `[lang]` segment for a page.
 *
 * Both answer the same two questions the same way. An unknown code is the caller's mistake
 * (400 on an API, 404 on a page); a known language that is switched off is visible only to
 * somebody preparing it -- an admin or a holder of a grant in it -- and does not exist for
 * anyone else. English needs neither question asked, so no English request pays for a query
 * or a session read.
 */
import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { BASE_LANG, isLang, type Lang } from "@/lib/lang";
import { isEnabled } from "@/lib/languages/store";
import { currentSession } from "@/lib/session";
import { viewerOf } from "@/lib/grants/store";
import { worksIn } from "@/lib/permissions";

/**
 * Whether the person asking may see a language that is switched off: an admin, or anybody
 * holding a grant in it -- the translators who are preparing it.
 */
async function mayPreview(lang: Lang): Promise<boolean> {
  return worksIn(await viewerOf(await currentSession()), lang);
}

/**
 * Whether the person asking works in a language: an admin, or anybody holding a grant in
 * it. The same people mayPreview lets see it switched off, and who the explorers show who
 * and what made each take (lib/takes/made-by.ts).
 */
export async function worksHere(lang: Lang): Promise<boolean> {
  return mayPreview(lang);
}

/** Cached per render: the layout and the page under it both ask, of the same language. */
const visible = cache(async (lang: Lang): Promise<boolean> => {
  if (lang === BASE_LANG) return true;
  return (await isEnabled(lang)) || (await mayPreview(lang));
});

/**
 * An API route's language, or the response to return instead.
 *
 * Absent means English, so every URL the site built before languages existed means what it
 * always meant.
 */
export async function langParam(
  request: Request,
): Promise<{ lang: Lang; denied: null } | { lang: null; denied: Response }> {
  const raw = new URL(request.url).searchParams.get("lang");
  if (raw === null || raw === "") return { lang: BASE_LANG, denied: null };
  if (!isLang(raw)) {
    return { lang: null, denied: Response.json({ error: `unknown language ${raw}` }, { status: 400 }) };
  }
  if (!(await visible(raw))) {
    return { lang: null, denied: Response.json({ error: `${raw} is not available` }, { status: 404 }) };
  }
  return { lang: raw, denied: null };
}

/** A page's language, from its `[lang]` segment. Anything not servable is a 404. */
export async function pageLang(params: Promise<{ lang: string }>): Promise<Lang> {
  const { lang } = await params;
  if (!isLang(lang) || !(await visible(lang))) notFound();
  return lang;
}
