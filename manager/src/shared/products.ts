// What the manager can install, as a table. The names follow scripts/lib/packs.mjs in the repo:
// a release tag is `<product id>/v<version>`, English's folders are the plain names and a
// language's are those plus `_<lang>`. Which of these have a release is the catalog's business.
import type { Product, QuestsPack, Section } from './types'

export const BASE_LANGUAGE = 'enUS'

/** Languages in the order the Voice Packs page lists them, named in their own language. */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'enUS', name: 'English' },
  { code: 'deDE', name: 'Deutsch' },
  { code: 'esES', name: 'Español (España)' },
  { code: 'esMX', name: 'Español (Latinoamérica)' },
  { code: 'frFR', name: 'Français' },
  { code: 'itIT', name: 'Italiano' },
  { code: 'ptBR', name: 'Português (Brasil)' },
  { code: 'ruRU', name: 'Русский' },
  { code: 'koKR', name: '한국어' },
  { code: 'zhCN', name: '简体中文' },
  { code: 'zhTW', name: '繁體中文' }
]

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code
}

const SIDES: Record<Exclude<QuestsPack, 'all'>, string> = {
  alliance: 'Alliance',
  horde: 'Horde',
  shared: 'Shared',
  gossip: 'Gossip'
}

const SECTION_TITLE: Record<Section, string> = {
  quests: 'Quests',
  places: 'Places',
  readables: 'Readables',
  bosses: 'Bosses'
}

/** English's folder for each section but quests, whose folders follow the pack. */
const FOLDER: Record<Exclude<Section, 'quests'>, string> = {
  places: 'SpokenPlacesAudio',
  readables: 'SpokenReadablesAudio',
  bosses: 'SpokenBossesAudio'
}

/** Places' and Readables' packs before their sections were renamed: the tag prefix and folder. */
const LEGACY: Partial<Record<Section, { section: string; folder: string }>> = {
  places: { section: 'zones', folder: 'SpokenZonesAudio' },
  readables: { section: 'books', folder: 'SpokenBooksAudio' }
}

const SECTION_BLURB: Record<Section, string> = {
  quests: 'Every quest, spoken as you read it, and the gossip of the people who give them.',
  places: 'The story of each zone, dungeon and place, told as you arrive.',
  readables: 'Books, letters and notes read aloud when you open them.',
  bosses: 'The story of each dungeon and raid boss, told when it falls.'
}

const SIDE_BLURB: Record<QuestsPack, string> = {
  all: 'Everything in one download: Alliance, Horde, Shared and Gossip.',
  alliance: 'Quests only the Alliance sees.',
  horde: 'Quests only the Horde sees.',
  shared: 'Quests both sides share.',
  gossip: 'What the people of the world say when you talk to them.'
}

function zip(base: string): string {
  return `^${base}-\\d.*\\.zip$`
}

function voices(section: Section, lang: string, pack: QuestsPack): Product {
  const english = lang === BASE_LANGUAGE
  let id: string
  let folder: string
  let base: string
  let legacy: Product['legacy']
  if (section === 'quests') {
    if (english) {
      id = pack === 'all' ? 'quests-audio' : `quests-audio-${pack}`
      folder = pack === 'all' ? '' : `SpokenQuestsAudio${SIDES[pack as Exclude<QuestsPack, 'all'>]}`
      base = pack === 'all' ? 'SpokenQuestsAudioAll' : folder
    } else {
      id = `quests-audio-${lang}`
      folder = `SpokenQuestsAudio_${lang}`
      base = folder
    }
  } else {
    const name = FOLDER[section]
    const suffix = english ? '' : `-${lang}`
    id = `${section}-audio${suffix}`
    folder = english ? name : `${name}_${lang}`
    base = folder
    const old = LEGACY[section]
    if (old) {
      const oldFolder = english ? old.folder : `${old.folder}_${lang}`
      legacy = { id: `${old.section}-audio${suffix}`, tagPrefix: `${old.section}-audio${suffix}`, folders: [oldFolder], assetPattern: zip(oldFolder) }
    }
  }
  // English's "all" is a bundle holding the four split packs' folders, as the store installs them.
  const folders =
    section === 'quests' && english && pack === 'all'
      ? Object.values(SIDES).map((s) => `SpokenQuestsAudio${s}`)
      : [folder]
  const title = `${SECTION_TITLE[section]} voices`
  return {
    id,
    kind: 'voices',
    title,
    description: section === 'quests' && english ? SIDE_BLURB[pack] : SECTION_BLURB[section],
    section,
    lang,
    pack: section === 'quests' ? pack : undefined,
    tagPrefix: id,
    folders,
    assetPattern: zip(base),
    ...(legacy ? { legacy } : {})
  }
}

const SPOKEN: Product = {
  id: 'spoken',
  kind: 'addon',
  title: 'Spoken',
  description: 'Reads the game aloud: quests, gossip, places and readables. One queue, one narrator, one settings window.',
  tagPrefix: 'spoken',
  folders: null,
  assetPattern: zip('Spoken')
}

function build(): Product[] {
  const out: Product[] = [SPOKEN]
  for (const { code } of LANGUAGES) {
    if (code === BASE_LANGUAGE) {
      for (const pack of ['all', 'alliance', 'horde', 'shared', 'gossip'] as QuestsPack[]) out.push(voices('quests', code, pack))
    } else {
      out.push(voices('quests', code, 'all'))
    }
    // Italian has quests voices only, so far, and bosses English only. With no release in a
    // language, the voice packs page still shows that language's first product.
    out.push(voices('places', code, 'all'), voices('readables', code, 'all'), voices('bosses', code, 'all'))
  }
  return out
}

/** Every product the manager knows. A pack with no release yet is simply not shown. */
export const PRODUCTS: Product[] = build()

export function productById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id)
}

/** The product an id names now: `zones-audio-deDE`, saved before the rename, is `places-audio-deDE`. */
export function currentProductId(id: string): string {
  return PRODUCTS.find((p) => p.legacy?.id === id)?.id ?? id
}

/** The folders of every voice pack and Spoken's known ones: the only names the installer may touch. */
export const SPOKEN_FOLDERS = [
  'Spoken',
  'Spoken_Quests',
  'Spoken_Conversations',
  'Spoken_Places',
  'Spoken_Readables',
  'Spoken_Bosses',
  'Spoken_NPCs',
  'SpokenContributions'
]

/** `spoken/v3.5.0` -> `3.5.0`; null when the tag is not `<prefix>/v<version>`. */
export function versionOfTag(tag: string, prefix: string): string | null {
  const lead = `${prefix}/v`
  return tag.startsWith(lead) ? tag.slice(lead.length) : null
}
