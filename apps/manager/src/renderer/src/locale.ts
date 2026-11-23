// Which language the window is in. Kept apart from the dictionaries because `strings.en` imports
// `format` for plural forms, so `format` reading the language from `strings` would be a cycle.
import { DEFAULT_SETTINGS, bcp47Of, type UiLanguage } from '@shared/types'

let current: UiLanguage = DEFAULT_SETTINGS.uiLanguage

/** Called by `setUiLanguage`; not by components. */
export function setLocale(lang: UiLanguage): void {
  current = lang
}

export function currentLanguage(): UiLanguage {
  return current
}

export function localeTag(): string {
  return bcp47Of(current)
}
