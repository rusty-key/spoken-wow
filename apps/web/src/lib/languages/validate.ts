/** What a new language's code and names must look like, shared by the admin route and team requests. */
import { LANG_SHAPE } from "@/lib/lang";

export const LANG_CODE = new RegExp(`^${LANG_SHAPE}$`);
const MAX_NAME = 60;

/** A name trimmed, or null when it is empty, over 60 characters or not text. */
export function describedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= MAX_NAME ? text : null;
}

/** The page sections, baked in by next.config.ts: the standalone bundle cannot read src/app/[lang]. */
export function isPageSection(code: string): boolean {
  const sections = (process.env.SPOKEN_PAGE_SECTIONS ?? "").split(",");
  return sections.some((section) => section.toLowerCase() === code.toLowerCase());
}

/** A new language's code and trimmed names, or why it cannot have them. */
export function checkNewLanguage(
  code: string,
  name: unknown,
  native: unknown,
): { error: string } | { language: { code: string; name: string; native: string } } {
  if (!LANG_CODE.test(code)) return { error: "A language code is two lowercase letters and two capitals, like xxXX." };
  if (isPageSection(code)) return { error: `${code} would shadow a page` };
  const english = describedName(name);
  const own = describedName(native);
  if (!english || !own) {
    return { error: "A new language needs an English name and a native name, each 1 to 60 characters." };
  }
  return { language: { code, name: english, native: own } };
}
