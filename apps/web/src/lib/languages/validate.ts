/** What a new language's code and names must look like, shared by the admin route and team requests. */

export const LANG_CODE = /^[a-z]{2}[A-Z]{2}$/;
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

/** Why a new language cannot have this code and these names, or null when it can. */
export function newLanguageError(code: string, name: unknown, native: unknown): string | null {
  if (!LANG_CODE.test(code)) return "A language code is two lowercase letters and two capitals, like xxXX.";
  if (isPageSection(code)) return `${code} would shadow a page`;
  if (!describedName(name) || !describedName(native)) {
    return "A new language needs an English name and a native name, each 1 to 60 characters.";
  }
  return null;
}
