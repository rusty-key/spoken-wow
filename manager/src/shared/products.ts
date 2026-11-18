// What the manager can install, as a table. The names follow scripts/lib/packs.mjs in the repo:
// a release tag is `<product id>/v<version>`, English's folders are the plain names and a
// language's are those plus `_<lang>`. Which of these have a release is the catalog's business.
import type { ChannelTeam, Product, QuestsPack, QuestsSide, Section } from './types'

export const BASE_LANGUAGE = 'enUS'

/** Languages in the order the Voice Packs page lists them, named in their own language. */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'enUS', name: 'English' },
  { code: 'deDE', name: 'Deutsch' },
  { code: 'esES', name: 'Español (España)' },
  { code: 'esMX', name: 'Español (Latinoamérica)' },
  { code: 'frFR', name: 'Français' },
  { code: 'itIT', name: 'Italiano' },
  { code: 'plPL', name: 'Polski' },
  { code: 'ptBR', name: 'Português (Brasil)' },
  { code: 'ruRU', name: 'Русский' },
  { code: 'koKR', name: '한국어' },
  { code: 'zhCN', name: '简体中文' },
  { code: 'zhTW', name: '繁體中文' }
]

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code
}

const RELEASE_PACKS = [
  'SpokenQuestsAudioAlliance',
  'SpokenQuestsAudioHorde',
  'SpokenQuestsAudioShared',
  'SpokenQuestsAudioGossip',
  'SpokenPlacesAudio',
  'SpokenReadablesAudio',
  'SpokenBossesAudio'
]

/** The folders a language's release covers: English folders carry no suffix. */
export function languageFolders(lang: string): string[] {
  return RELEASE_PACKS.map((p) => (lang === 'enUS' ? p : `${p}_${lang}`))
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
    const code = english ? '' : `_${lang}`
    const suffix = english ? '' : `-${lang}`
    id = pack === 'all' ? `quests-audio${suffix}` : `quests-audio-${pack}${suffix}`
    folder = pack === 'all' ? '' : `SpokenQuestsAudio${SIDES[pack as Exclude<QuestsPack, 'all'>]}${code}`
    base = pack === 'all' ? `SpokenQuestsAudioAll${code}` : folder
    // A language's quests were one folder before they were split as English's are.
    if (!english && pack === 'all') {
      const old = `SpokenQuestsAudio${code}`
      legacy = { id, tagPrefix: id, folders: [old], assetPattern: zip(old) }
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
  // "all" is a bundle holding the four split packs' folders, as the store installs them.
  const folders =
    section === 'quests' && pack === 'all'
      ? Object.values(SIDES).map((s) => `SpokenQuestsAudio${s}${english ? '' : `_${lang}`}`)
      : [folder]
  const title = `${SECTION_TITLE[section]} voices`
  return {
    id,
    kind: 'voices',
    title,
    description: section === 'quests' ? SIDE_BLURB[pack] : SECTION_BLURB[section],
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
    for (const pack of ['all', 'alliance', 'horde', 'shared', 'gossip'] as QuestsPack[]) out.push(voices('quests', code, pack))
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

/** What products and languages are read from in the channel's index-v2.json. */
export interface ChannelListing {
  packs: Record<string, { lang: string; section: Section; pack: QuestsSide | null; team: ChannelTeam | null }>
  languages: Record<string, { name: string; native: string }>
}

const QUESTS_SIDES: QuestsSide[] = ['alliance', 'horde', 'shared', 'gossip']

/** A pack the table does not name, from its folders as the index lists them. */
function channelProduct(section: Section, lang: string, slug: string | null, pack: QuestsPack | undefined, folders: string[], team: ChannelTeam | null): Product {
  const tail = `-${lang}${slug ? `-${slug}` : ''}`
  const id = section !== 'quests' ? `${section}-audio${tail}` : pack === 'all' ? `quests-audio${tail}` : `quests-audio-${pack}${tail}`
  const base = pack === 'all' ? `SpokenQuestsAudioAll_${lang}${slug ? `_${slug}` : ''}` : folders[0]!
  return {
    id,
    kind: 'voices',
    title: `${SECTION_TITLE[section]} voices`,
    description: section === 'quests' ? SIDE_BLURB[pack!] : SECTION_BLURB[section],
    section,
    lang,
    pack,
    tagPrefix: id,
    folders,
    assetPattern: zip(base),
    team
  }
}

/** The team slug a folder carries after its language; null for a language's plain folder. */
function folderSlug(folder: string, lang: string): string | null {
  const at = folder.lastIndexOf(`_${lang}_`)
  return at >= 0 ? folder.slice(at + lang.length + 2) : null
}

/**
 * The table's products with their teams from the channel, then one product for each folder the table does not name: a
 * team's packs and a new language's. Quests sides get one each, and a bundle of the four when all four are there. The
 * table keeps today's packs' ids, which installs, settings and jobs are keyed by.
 */
export function productsFor(index: ChannelListing | null): Product[] {
  if (!index) return PRODUCTS
  const named = new Set(PRODUCTS.flatMap((p) => [...(p.folders ?? []), ...(p.legacy?.folders ?? [])]))
  const out = PRODUCTS.map((p) => {
    const entry = p.kind === 'voices' ? index.packs[p.folders![0]!] : undefined
    return entry ? { ...p, team: entry.team } : p
  })
  const groups = new Map<string, { section: Section; lang: string; slug: string | null; team: ChannelTeam | null; folders: Map<QuestsSide | null, string> }>()
  for (const [folder, entry] of Object.entries(index.packs)) {
    if (named.has(folder)) continue
    const slug = folderSlug(folder, entry.lang)
    const key = `${entry.section}|${entry.lang}|${slug ?? ''}`
    const group = groups.get(key) ?? { section: entry.section, lang: entry.lang, slug, team: entry.team, folders: new Map() }
    group.folders.set(entry.pack, folder)
    groups.set(key, group)
  }
  const ids = new Set(out.map((p) => p.id))
  const add = (p: Product): void => {
    if (ids.has(p.id)) return
    ids.add(p.id)
    out.push(p)
  }
  for (const g of groups.values()) {
    if (g.section !== 'quests') {
      add(channelProduct(g.section, g.lang, g.slug, undefined, [...g.folders.values()], g.team))
      continue
    }
    const present = QUESTS_SIDES.filter((s) => g.folders.has(s))
    if (present.length === QUESTS_SIDES.length) add(channelProduct('quests', g.lang, g.slug, 'all', present.map((s) => g.folders.get(s)!), g.team))
    for (const side of present) add(channelProduct('quests', g.lang, g.slug, side, [g.folders.get(side)!], g.team))
  }
  return out
}

/**
 * Every language the Manager can list: today's in their order and words, then the index's others by English name,
 * each in its own words. Today's keep the table's names, which tell esES from esMX.
 */
export function languagesFor(index: ChannelListing | null): { code: string; name: string }[] {
  const known = new Set(LANGUAGES.map((l) => l.code))
  const others = new Set([...Object.keys(index?.languages ?? {}), ...Object.values(index?.packs ?? {}).map((p) => p.lang)].filter((c) => !known.has(c)))
  const english = (code: string): string => index?.languages[code]?.name ?? code
  const more = [...others].sort((a, b) => english(a).localeCompare(english(b), 'en')).map((code) => ({ code, name: index?.languages[code]?.native ?? code }))
  return [...LANGUAGES, ...more]
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
