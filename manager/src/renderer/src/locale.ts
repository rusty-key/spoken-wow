// Which language the window is in, as `Intl` needs it. On its own so that `format.ts` can read it
// without importing a dictionary: `strings.en` imports `format` for its plural forms, so a
// `format -> strings` import would be a cycle.
import { DEFAULT_SETTINGS, type UiLanguage } from '@shared/types'

/**
 * The manager's codes are the game's (`zhCN`), and `Intl` does not know them; asking for a date
 * with one would quietly fall back to the system's language.
 */
const BCP47: Record<UiLanguage, string> = { enUS: 'en-US', zhCN: 'zh-CN' }

/** The languages that have words in this window. Kept in step with `strings.ts`'s dictionaries. */
const SPOKEN: readonly UiLanguage[] = ['enUS', 'zhCN']

let current: UiLanguage = DEFAULT_SETTINGS.uiLanguage

/** Called by `setUiLanguage`; not by components. */
export function setLocale(lang: UiLanguage): void {
  if (SPOKEN.includes(lang)) current = lang
}

/** The tag `Intl` wants, for dates and plural rules. */
export function localeTag(): string {
  return BCP47[current] ?? BCP47.enUS
}
