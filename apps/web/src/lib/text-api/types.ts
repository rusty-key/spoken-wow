/** What each section of /api/v1 offers, so the routes never name a table. */
import type { ApiAudit } from "@/lib/activity/kinds";
import type { Lang } from "@/lib/lang";
import type { NameKind } from "@/lib/names/store";

export const SECTIONS = ["places", "bosses", "readables", "quests"] as const;
export type Section = (typeof SECTIONS)[number];

export function isSection(value: unknown): value is Section {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}

export type NameTarget = { kind: NameKind; entityId: string };

export type TextItem = {
  id: string;
  /** Quests only: 103 line ids name two different lines. */
  variant?: number;
  text: string | null;
  /** Places only. */
  short?: string | null;
  version: number | null;
  name: string | null;
  nameVersion: number | null;
  englishText: string | null;
  englishName: string | null;
  group: Record<string, string | number | null>;
};

export type Page = { items: TextItem[]; nextCursor: string | null };

export type SaveTextArgs = {
  lang: Lang;
  id: string;
  variant: number;
  text?: string;
  short?: string | null;
  note: string | null;
  by: string;
  expectedVersion: number | null;
  audit: ApiAudit;
};

export type SectionApi = {
  /** Each filter's name, and what its value must look like. */
  filters: Readonly<Record<string, RegExp>>;
  list(lang: Lang, filter: Record<string, string>, cursor: string | null, limit: number): Promise<Page>;
  one(lang: Lang, id: string, variant: number): Promise<TextItem | null>;
  /** Which of `keys` are items, as keyOf(id, variant). Asked once a request, before any write. */
  known(lang: Lang, keys: { id: string; variant: number }[]): Promise<Set<string>>;
  saveText(args: SaveTextArgs): Promise<{ version: number; lines: string[] }>;
  nameTarget(lang: Lang, id: string, variant: number): Promise<NameTarget | null>;
};

export function keyOf(id: string, variant: number): string {
  return `${variant}\u0000${id}`;
}

export class BadCursor extends Error {}

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString());
  } catch {
    throw new BadCursor("that cursor is not one this API gave out");
  }
}
