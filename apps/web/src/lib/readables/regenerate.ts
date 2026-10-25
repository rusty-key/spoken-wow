/**
 * Narrating one book page, on the shared queue's terms.
 *
 * Deliberately the places narrator's voice: the design calls for one narrator across the
 * section, and resolving a second would be a second answer to "who reads this", with
 * nothing asking the question. Everything from resolving it to committing the take is
 * lib/generation/narrated.ts, shared with places; what is here is finding a page and
 * deciding whether it can be voiced.
 */
import type { GenerateOptions } from "@/lib/generation/generate-options";
import "server-only";

import { failure } from "@/lib/generation/errors";
import { regenerateNarrated } from "@/lib/generation/narrated";
import type { RegenerateResult } from "@/lib/generation/regenerate";

import { catalogue, type BookPage } from "./catalogue";
import { spokenText } from "./tools";
import { BASE_LANG, type Lang } from "@/lib/lang";

async function pageFor(lineId: string, lang: Lang): Promise<BookPage | undefined> {
  return (await catalogue(lang)).find((candidate) => candidate.id === lineId);
}

export async function regenerateBookLine(
  lineId: string,
  createdBy: string,
  options: GenerateOptions,
): Promise<RegenerateResult> {
  const lang = options.lang ?? BASE_LANG;

  const page = await pageFor(lineId, lang);
  if (!page) {
    return { ok: false, failure: { ...failure("bad-request", `no page ${lineId}`), status: 404 } };
  }

  // The 88 pages the game has and nothing can speak: empty, a placeholder, or holding a
  // substitution token the client fills in at runtime. Refused here as well as filtered in
  // the explorer, because the queue can be handed an id directly.
  if (!page.generatable || !page.spoken.trim()) {
    return {
      ok: false,
      failure: {
        ...failure("bad-request", `${lineId} cannot be voiced: ${page.skipReason ?? "no text"}`),
        status: 409,
        fatal: false,
      },
    };
  }

  return regenerateNarrated(
    "readables",
    // The caption the addon shows is the page's markup and $B breaks cleaned the same way.
    { lineId: page.id, file: page.file, spoken: page.spoken, shown: spokenText(page.text), hash: page.hash },
    createdBy,
    { ...options, lang },
  );
}
