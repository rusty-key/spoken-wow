// Which language the window is in. On its own so that `format.ts` can read it without importing a
// dictionary: `strings.en` imports `format` for its plural forms, so a `format -> strings` import
// would be a cycle.
import { DEFAULT_SETTINGS, bcp47Of, type UiLanguage } from '@shared/types'

let current: UiLanguage = DEFAULT_SETTINGS.uiLanguage

/** Called by `setUiLanguage`; not by components. */
export function setLocale(lang: UiLanguage): void {
  current = lang
}

export function currentLanguage(): UiLanguage {
  return current
}

/** The tag `Intl` wants, for dates and plural rules. */
export function localeTag(): string {
  return bcp47Of(current)
}
