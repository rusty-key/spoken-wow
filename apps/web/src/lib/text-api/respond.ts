import "server-only";

import { isSource, type Source } from "@/lib/sections";

import { sections } from "./index";
import { BAD_VARIANT, isVariant, type ReferenceItem, type SectionApi, type TextItem } from "./types";

export const PAGE_SIZE = 500;

const VARIANT = /^\d+$/;

export function invalid(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

/** The 400 for a request with a query string, or null when it has none. */
export function noQuery(request: Request, error = "this takes no query string"): Response | null {
  return new URL(request.url).search ? invalid(error) : null;
}

export function sectionOf(name: string): { section: Source; api: SectionApi } | Response {
  if (!isSource(name)) return Response.json({ error: `no section ${name}` }, { status: 404 });
  return { section: name, api: sections[name] };
}

type ListQuery = { filter: Record<string, string>; cursor: string | null; limit: number };

/**
 * Anything it does not know is refused, not ignored: an agent that misspells `zone`, or asks for
 * another language, would otherwise be given a whole language and take it for the answer.
 */
export function parseList(api: SectionApi, params: URLSearchParams): ListQuery | Response {
  const filter: Record<string, string> = {};
  let cursor: string | null = null;
  let limit = PAGE_SIZE;

  for (const [name, value] of params) {
    if (name === "cursor") {
      cursor = value;
    } else if (name === "limit") {
      limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE) {
        return invalid(`limit must be between 1 and ${PAGE_SIZE}`);
      }
    } else if (Object.hasOwn(api.filters, name)) {
      if (!api.filters[name].test(value)) return invalid(`${value} is not a valid ${name}`);
      filter[name] = value;
    } else {
      const known = ["cursor", "limit", ...Object.keys(api.filters)].join(", ");
      return invalid(`unknown parameter ${name}: this section takes ${known}`);
    }
  }
  return { filter, cursor, limit };
}

export function parseVariant(section: Source, params: URLSearchParams): number | Response {
  for (const name of params.keys()) {
    if (name !== "variant" || section !== "quests") return invalid(`unknown parameter ${name}`);
  }
  const value = params.get("variant");
  if (value === null) return 0;
  return VARIANT.test(value) && isVariant(Number(value)) ? Number(value) : invalid(BAD_VARIANT);
}

/** The id as the store knows it, whether its colons arrived encoded or not. */
export function decodeId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export function toReference(item: TextItem): ReferenceItem {
  const out: ReferenceItem = { id: item.id, text: item.text, name: item.name, group: item.group };
  if (item.variant !== undefined) out.variant = item.variant;
  if (item.override !== undefined) out.override = item.override;
  if (item.short !== undefined) out.short = item.short;
  return out;
}
