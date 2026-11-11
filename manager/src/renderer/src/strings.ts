// Which language the window speaks, and the one object every component reads.
//
// `S` keeps its identity and has its own properties swapped in place, because every importer
// holds the object it imported: replacing the binding would leave each file on the first
// language. The swap happens in the store's reducer, before React redraws, so the render that
// follows a language change already reads the new words.
import type { Snapshot } from '@shared/types'
import { DEFAULT_SETTINGS, bcp47Of, type UiLanguage } from '@shared/types'
import { setLocale } from './locale'
import { S_EN } from './strings.en'
import { S_ZH } from './strings.zh'

export type Platform = Snapshot['platform']

export const REPO_URL = 'https://github.com/rusty-key/spoken-wow'
export const SITE_URL = 'https://spoken.quest'
export const COMMUNITY_README_URL = 'https://github.com/rusty-key/spoken-wow/blob/master/community/README.md'

/** The shape every language file must have: whatever English has, a translation has too. */
export type Dict = typeof S_EN

const DICTS: Record<UiLanguage, Dict> = { enUS: S_EN, zhCN: S_ZH as Dict }

/** The language the window is in. */
let current: UiLanguage = DEFAULT_SETTINGS.uiLanguage

/** Every word the window shows. Never read `Object.keys(S)`: it is a live view, not a snapshot. */
export const S: Dict = { ...S_EN }

/** The language the window is in. */
export function uiLanguage(): UiLanguage {
  return current
}

/** Called by the store when the setting changes or the snapshot arrives; not by components. */
export function setUiLanguage(lang: UiLanguage): void {
  setLocale(lang)
  if (DICTS[lang] === undefined || lang === current) return
  current = lang
  Object.assign(S, DICTS[lang])
  // Screen readers pick a voice by this, and `:lang()` rules by it: an English `lang` on Chinese
  // words reads them with an English voice.
  if (typeof document !== 'undefined') document.documentElement.lang = bcp47Of(lang)
}

setUiLanguage(current)
