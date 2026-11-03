/** What the /api/v1 routes share: reading the query, and answering about a bad one. */
import "server-only";

import { isSection, sections } from "./index";
import { BadCursor, type Section, type SectionApi } from "./types";

export const PAGE_SIZE = 500;

const VARIANT = /^\d+$/;

function invalid(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

export function sectionOf(name: string): { section: Section; api: SectionApi } | Response {
  if (!isSection(name)) return Response.json({ error: `no section ${name}` }, { status: 404 });
  return { section: name, api: sections[name] };
}

export type ListQuery = { filter: Record<string, string>; cursor: string | null; limit: number };

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

/** A quest line's variant from `?variant=`, 0 when absent. Only quests have one. */
export function parseVariant(section: Section, params: URLSearchParams): number | Response {
  for (const name of params.keys()) {
    if (name !== "variant" || section !== "quests") return invalid(`unknown parameter ${name}`);
  }
  const value = params.get("variant");
  if (value === null) return 0;
  return VARIANT.test(value) ? Number(value) : invalid("variant must be a whole number");
}

/** The id as the store knows it, whether its colons arrived encoded or not. */
export function decodeId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export function badCursor(error: unknown): Response | null {
  return error instanceof BadCursor ? invalid(error.message) : null;
}
