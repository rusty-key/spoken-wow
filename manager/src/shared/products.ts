// What the manager can install, as a table. The names follow scripts/lib/packs.mjs in the repo:
// a release tag is `<product id>/v<version>`, English's folders are the plain names and a
// language's are those plus `_<lang>`. Which of these have a release is the catalog's business.
import { PAGE_AUTHOR, QUESTS_SIDES, type ChannelTeam, type PackAuthor, type Product, type QuestsPack, type QuestsSide, type Section, type VoiceLanguage } from './types'

export const BASE_LANGUAGE = 'enUS'

/** Languages in the order the Voice Packs page lists them, named in their own language. */
export const LANGUAGES: VoiceLanguage[] = [
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

const SIDES: Record<QuestsSide, string> = {
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

/** What a pack's id and folders carry after the name: nothing for English's page packs, else the language and a team's slug. */
function tail(lang: string, slug: string | null, sep: '-' | '_'): string {
  return lang === BASE_LANGUAGE && !slug ? '' : `${sep}${lang}${slug ? `${sep}${slug}` : ''}`
}

/** A pack's product id, which is also its release tag prefix; a team's when `slug` is given. */
export function productIdOf(section: Section, lang: string, pack: QuestsPack, slug: string | null = null): string {
  const t = tail(lang, slug, '-')
  if (section !== 'quests') return `${section}-audio${t}`
  return pack === 'all' ? `quests-audio${t}` : `quests-audio-${pack}${t}`
}

/** A pack's folder: a quests side's, or another section's. */
export function packFolder(section: Section, lang: string, side: QuestsSide | null, slug: string | null = null): string {
  const name = section === 'quests' ? `SpokenQuestsAudio${SIDES[side!]}` : FOLDER[section]
  return `${name}${tail(lang, slug, '_')}`
}

/** What a pack's zip is named before its version: the quests bundle's has a name of its own. */
function assetBaseOf(section: Section, lang: string, pack: QuestsPack, slug: string | null): string {
  return section === 'quests' && pack === 'all' ? `SpokenQuestsAudioAll${tail(lang, slug, '_')}` : packFolder(section, lang, pack === 'all' ? null : pack, slug)
}

function voiceProduct(section: Section, lang: string, pack: QuestsPack, folders: string[], slug: string | null): Product {
  const id = productIdOf(section, lang, pack, slug)
  return {
    id,
    kind: 'voices',
    title: `${SECTION_TITLE[section]} voices`,
    description: section === 'quests' ? SIDE_BLURB[pack] : SECTION_BLURB[section],
    section,
    lang,
    pack: section === 'quests' ? pack : undefined,
    tagPrefix: id,
    folders,
    assetPattern: zip(assetBaseOf(section, lang, pack, slug))
  }
}

/** The page packs' author until the channel says whose they are. */
export const PAGE_PACKS: PackAuthor = { key: PAGE_AUTHOR, name: null, official: true }

/** A pack of the table: a page pack, with what it was released as before. */
function voices(section: Section, lang: string, pack: QuestsPack): Product {
  // "all" is a bundle holding the four split packs' folders, as the store installs them.
  const folders = section === 'quests' && pack === 'all' ? QUESTS_SIDES.map((s) => packFolder('quests', lang, s)) : [packFolder(section, lang, section === 'quests' ? (pack as QuestsSide) : null)]
  const product = voiceProduct(section, lang, pack, folders, null)
  const english = lang === BASE_LANGUAGE
  let legacy: Product['legacy']
  if (section === 'quests') {
    // A language's quests were one folder before they were split as English's are.
    if (!english && pack === 'all') {
      const old = `SpokenQuestsAudio_${lang}`
      legacy = { id: product.id, tagPrefix: product.id, folders: [old], assetPattern: zip(old) }
    }
  } else {
    const old = LEGACY[section]
    if (old) {
      const id = `${old.section}-audio${tail(lang, null, '-')}`
      const oldFolder = `${old.folder}${tail(lang, null, '_')}`
      legacy = { id, tagPrefix: id, folders: [oldFolder], assetPattern: zip(oldFolder) }
    }
  }
  return { ...product, author: PAGE_PACKS, ...(legacy ? { legacy } : {}) }
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
    for (const pack of ['all', ...QUESTS_SIDES] as QuestsPack[]) out.push(voices('quests', code, pack))
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

/** A pack the table does not name, from its folders as the index lists them. */
function channelProduct(section: Section, lang: string, slug: string | null, pack: QuestsPack, folders: string[], team: ChannelTeam | null): Product {
  return { ...voiceProduct(section, lang, pack, folders, slug), team }
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
      add(channelProduct(g.section, g.lang, g.slug, 'all', [...g.folders.values()], g.team))
      continue
    }
    const present = QUESTS_SIDES.filter((s) => g.folders.has(s))
    if (present.length === QUESTS_SIDES.length) add(channelProduct('quests', g.lang, g.slug, 'all', present.map((s) => g.folders.get(s)!), g.team))
    for (const side of present) add(channelProduct('quests', g.lang, g.slug, side, [g.folders.get(side)!], g.team))
  }
  return withAuthors(out)
}

const teamAuthor = (team: ChannelTeam): PackAuthor => ({ key: team.slug, name: team.name, official: team.official })

/**
 * Each voice product's author. A page pack has no team, but its language's privileged team made it: with one named
 * official team in the language, page packs are that team's, so one team is not two authors.
 */
function withAuthors(products: Product[]): Product[] {
  const official = new Map<string, Map<string, ChannelTeam>>()
  for (const p of products) {
    if (!p.team?.official) continue
    const teams = official.get(p.lang!) ?? new Map<string, ChannelTeam>()
    official.set(p.lang!, teams.set(p.team.slug, p.team))
  }
  const page = (lang: string): PackAuthor => {
    const teams = [...(official.get(lang)?.values() ?? [])]
    return teams.length === 1 ? teamAuthor(teams[0]!) : PAGE_PACKS
  }
  return products.map((p) => (p.kind === 'voices' ? { ...p, author: p.team ? teamAuthor(p.team) : page(p.lang!) } : p))
}

/**
 * Every language the Manager can list: today's in their order and words, then the index's others by English name,
 * each in its own words. Today's keep the table's names, which tell esES from esMX.
 */
export function languagesFor(index: ChannelListing | null): VoiceLanguage[] {
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
