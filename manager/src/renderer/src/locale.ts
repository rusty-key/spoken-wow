// Which language the window is in, as `Intl` needs it. On its own so that `format.ts` can read it
// without importing a dictionary: `strings.en` imports `format` for its plural forms, so a
// `format -> strings` import would be a cycle.
import { DEFAULT_SETTINGS, UI_LANGUAGE_CODES, bcp47Of, type UiLanguage } from '@shared/types'

let current: UiLanguage = DEFAULT_SETTINGS.uiLanguage

/** Called by `setUiLanguage`; not by components. A language without words is refused. */
export function setLocale(lang: UiLanguage): void {
  if (UI_LANGUAGE_CODES.includes(lang)) current = lang
}

/** The tag `Intl` wants, for dates and plural rules. */
export function localeTag(): string {
  return bcp47Of(current)
}
