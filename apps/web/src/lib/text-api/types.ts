/** What each section of /api/v1 offers, so the routes never name a table. */
import type { ApiAudit } from "@/lib/activity/kinds";
import type { Lang } from "@/lib/lang";
import type { NameKind } from "@/lib/names/store";

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

type SaveTextArgs = {
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
  saveText(args: SaveTextArgs): Promise<{ version: number; lines: string[]; wrote: boolean }>;
  /** What a name on this item writes to. Asked per item in a run, so it must not read a catalogue. */
  nameTarget(lang: Lang, id: string, variant: number): Promise<NameTarget | null>;
  /** The current text version. Asked per edit in an undo, so it must not read a catalogue. */
  version(lang: Lang, id: string, variant: number): Promise<number | null>;
  /** Moves the live text back to `version`. */
  restore(lang: Lang, id: string, variant: number, version: number, by: string): Promise<unknown>;
  /** Takes back a first translation, so the line has no text in the language again. */
  retire(lang: Lang, id: string, variant: number, version: number, by: string): Promise<void>;
};

export function keyOf(id: string, variant: number): string {
  return `${variant}\u0000${id}`;
}

export class BadCursor extends Error {}

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor<T>(cursor: string, valid: (value: unknown) => value is T): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
  } catch {
    decoded = undefined;
  }
  if (!valid(decoded)) throw new BadCursor("that cursor is not one this API gave out");
  return decoded;
}
