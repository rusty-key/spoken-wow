// The Voice Packs page drawn from a made-up state: which languages, which rows, and who made each.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { languagesFor, productsFor, type ChannelListing } from '../src/shared/products'
import { DEFAULT_SETTINGS, type ChannelTeam, type GameInstall, type Product, type QuestsSide, type ReleaseInfo, type Section, type Settings } from '../src/shared/types'
import { InstallAllConfirm, VoicePacksPage } from '../src/renderer/src/pages/VoicePacksPage'
import { initial, StoreContext, type Actions, type State } from '../src/renderer/src/store'
import { setUiLanguage } from '../src/renderer/src/strings'
import { ALL_AUTHORS, authorsOf, groupByAuthor, installAllPlan, type InstallAllPlan } from '../src/renderer/src/voices'

const STIMMEN: ChannelTeam = { slug: 'stimmen', name: 'Stimmen', official: false }
const KLANG: ChannelTeam = { slug: 'klang', name: 'Klang', official: false }
const NIHONGO: ChannelTeam = { slug: 'nihongo', name: 'Nihongo', official: false }

const at = (lang: string, section: Section, pack: QuestsSide | null, team: ChannelTeam | null) => ({ lang, section, pack, team })

/** deDE: the page packs and Stimmen's places; jaJP: one team; frFR: page packs only. */
const LISTING: ChannelListing = {
  packs: {
    SpokenPlacesAudio_deDE: at('deDE', 'places', null, null),
    SpokenReadablesAudio_deDE: at('deDE', 'readables', null, null),
    SpokenPlacesAudio_deDE_stimmen: at('deDE', 'places', null, STIMMEN),
    SpokenPlacesAudio_frFR: at('frFR', 'places', null, null),
    SpokenPlacesAudio_jaJP: at('jaJP', 'places', null, NIHONGO)
  },
  languages: { jaJP: { name: 'Japanese', native: '日本語' } }
}

const GAME: GameInstall = {
  id: 'g1', root: '/wow/_forever_', addOnsPath: '/wow/_forever_/Interface/AddOns', flavorFolder: '_forever_', flavor: 'forever',
  product: 'wow_forever', label: 'WoW: Forever', source: 'auto', writable: true
}

function release(productId: string): ReleaseInfo {
  return { productId, tag: 'channel/20261018T000000Z', version: '20261018T000000Z', prerelease: false, publishedAt: '2026-10-18T00:00:00Z', notes: '', assetName: '', assetSize: 1024, assetUrl: '', htmlUrl: '' }
}

function stateFor(listing: ChannelListing, settings: Partial<Settings> = {}): State {
  const products = productsFor(listing)
  const folders = new Set(Object.keys(listing.packs))
  const releases = Object.fromEntries(products.filter((p) => p.kind === 'voices' && p.folders!.every((f) => folders.has(f))).map((p) => [p.id, [release(p.id)]]))
  return {
    ...initial,
    ready: true,
    games: [GAME],
    gameId: GAME.id,
    page: 'voices',
    products,
    languages: languagesFor(listing),
    catalog: { fetchedAt: '2026-10-18T00:00:00Z', offline: false, releases },
    settings: { ...DEFAULT_SETTINGS, ...settings }
  }
}

function draw(state: State): string {
  const actions = {} as Actions
  return renderToStaticMarkup(createElement(StoreContext.Provider, { value: { state, actions } }, createElement(VoicePacksPage)))
}

/** The text of the section headed `title`. */
function section(html: string, title: string): string {
  const start = html.indexOf(`>${title}</h2>`)
  expect(start).toBeGreaterThan(-1)
  const end = html.indexOf('</section>', start)
  return html.slice(start, end)
}

afterEach(() => setUiLanguage('enUS'))

describe('Voice Packs: every language, and who made each pack', () => {
  it('has a pill for jaJP, named in Japanese', () => {
    expect(draw(stateFor(LISTING))).toContain('>日本語</button>')
  })

  it("says who made a non-official team's pack, and nothing on an official one", () => {
    const ja = draw(stateFor(LISTING, { voiceLanguage: 'jaJP' }))
    expect(section(ja, 'Places')).toContain('by Nihongo · ')
    const fr = draw(stateFor(LISTING, { voiceLanguage: 'frFR' }))
    expect(section(fr, 'Places')).not.toContain('by ')
    const official = { ...LISTING, packs: { SpokenPlacesAudio_jaJP: at('jaJP', 'places', null, { ...NIHONGO, official: true }) } }
    expect(section(draw(stateFor(official, { voiceLanguage: 'jaJP' })), 'Places')).not.toContain('by ')
  })

  it('says it in Chinese too', () => {
    setUiLanguage('zhCN')
    expect(draw(stateFor(LISTING, { voiceLanguage: 'jaJP' }))).toContain('由 Nihongo 制作')
  })

  it('groups a section with two teams under their names, official first, and gives one team no heading', () => {
    const html = draw(stateFor(LISTING, { voiceLanguage: 'deDE' }))
    const places = section(html, 'Places')
    expect(places).toContain('<li class="row-label">Official</li>')
    expect(places).toContain('<li class="row-label">Stimmen</li>')
    expect(places.indexOf('>Official<')).toBeLessThan(places.indexOf('>Stimmen<'))
    expect(section(html, 'Readables')).not.toContain('<li class="row-label">')
  })
})

describe('Voice Packs: the Author filter', () => {
  const authorPills = (html: string): string | null => {
    const at = html.indexOf('id="voice-author"')
    return at < 0 ? null : html.slice(at, html.indexOf('</div>', html.indexOf('class="pills"', at)))
  }

  it('shows for a language with two teams, All first, official before the rest, and not for one with one', () => {
    const pills = authorPills(draw(stateFor(LISTING, { voiceLanguage: 'deDE' })))!
    expect(pills).toContain('>Author<')
    expect([...pills.matchAll(/aria-pressed="(\w+)">([^<]+)</g)].map((m) => [m[2], m[1]])).toEqual([['All', 'true'], ['Official', 'false'], ['Stimmen', 'false']])
    expect(authorPills(draw(stateFor(LISTING, { voiceLanguage: 'frFR' })))).toBeNull()
    expect(authorPills(draw(stateFor(LISTING, { voiceLanguage: 'jaJP' })))).toBeNull()
  })

  it("shows only the chosen team's rows", () => {
    const html = draw(stateFor(LISTING, { voiceLanguage: 'deDE', voiceAuthors: { deDE: 'stimmen' } }))
    expect(authorPills(html)).toContain('aria-pressed="true">Stimmen<')
    const places = section(html, 'Places')
    expect(places).toContain('by Stimmen')
    expect(places).not.toContain('<li class="row-label">')
    expect(places.split('Not Installed').length - 1).toBe(1)
    expect(html).not.toContain('>Readables</h2>')
  })

  it('reads a saved team with no packs left as All', () => {
    const html = draw(stateFor(LISTING, { voiceLanguage: 'deDE', voiceAuthors: { deDE: 'gone' } }))
    expect(authorPills(html)).toContain('aria-pressed="true">All<')
    expect(section(html, 'Places')).toContain('<li class="row-label">Stimmen</li>')
    expect(html).toContain('>Readables</h2>')
  })
})

describe('authorsOf', () => {
  const product = (id: string, team: ChannelTeam | null | undefined): Product => ({ id, kind: 'voices', title: '', description: '', section: 'places', lang: 'deDE', tagPrefix: id, folders: [id], assetPattern: '', team })

  it('orders official teams first, then by name', () => {
    const official = { slug: 'zeta', name: 'Zeta', official: true }
    const list = authorsOf([product('a', STIMMEN), product('b', KLANG), product('c', official)]).list
    expect(list.map((a) => a.key)).toEqual(['zeta', 'klang', 'stimmen'])
  })

  it("counts page packs as the language's one official team", () => {
    const official = { slug: 'deutsch', name: 'Deutsch', official: true }
    const authors = authorsOf([product('a', null), product('b', official), product('c', STIMMEN)])
    expect(authors.list.map((a) => a.key)).toEqual(['deutsch', 'stimmen'])
    expect(groupByAuthor([product('a', null), product('b', official)], authors).map((g) => g.rows.map((p) => p.id))).toEqual([['a', 'b']])
  })
})

describe('Install All with several teams', () => {
  const sides = (lang: string, suffix: string, team: ChannelTeam | null) =>
    Object.fromEntries((['alliance', 'horde', 'shared', 'gossip'] as QuestsSide[]).map((s) => [`SpokenQuestsAudio${s[0]!.toUpperCase()}${s.slice(1)}_${lang}${suffix}`, at(lang, 'quests', s, team)]))
  /** deDE: page packs and Stimmen's, each with all four quests sides; plPL: Klang's and Stimmen's, no official team. */
  const TEAMS: ChannelListing = {
    packs: {
      ...sides('deDE', '', null),
      ...sides('deDE', '_stimmen', STIMMEN),
      SpokenPlacesAudio_deDE: at('deDE', 'places', null, null),
      SpokenPlacesAudio_deDE_stimmen: at('deDE', 'places', null, STIMMEN),
      SpokenReadablesAudio_deDE_stimmen: at('deDE', 'readables', null, STIMMEN),
      SpokenPlacesAudio_plPL: at('plPL', 'places', null, KLANG),
      SpokenPlacesAudio_plPL_stimmen: at('plPL', 'places', null, STIMMEN),
      SpokenReadablesAudio_plPL_stimmen: at('plPL', 'readables', null, STIMMEN)
    },
    languages: {}
  }

  function planFor(lang: string, choice: string = ALL_AUTHORS, installed: string[] = []): InstallAllPlan {
    const released = productsFor(TEAMS).filter((p) => p.kind === 'voices' && p.lang === lang && p.folders!.every((f) => TEAMS.packs[f]))
    return installAllPlan(released, authorsOf(released), choice, (p) => !installed.includes(p.id))
  }
  const ids = (plan: InstallAllPlan): string[] => (plan.kind === 'install' ? plan.products.map((p) => p.id) : [])
  /** No section twice: two teams' packs of one section would play over each other. */
  function oneTeamPerSection(plan: InstallAllPlan): void {
    const sections = plan.kind === 'install' ? plan.products.map((p) => p.section) : []
    expect(new Set(sections).size).toBe(sections.length)
  }

  it("with All, installs the official packs only, not a team's beside them", () => {
    const plan = planFor('deDE')
    expect(ids(plan)).toEqual(['quests-audio-deDE', 'places-audio-deDE'])
    oneTeamPerSection(plan)
  })

  it('with All and no official team, asks whose packs and installs nothing until one is picked', () => {
    const plan = planFor('plPL')
    expect(plan).toMatchObject({ kind: 'ask', authors: [{ key: 'klang' }, { key: 'stimmen' }] })
    const html = renderToStaticMarkup(createElement(InstallAllConfirm, { plan, lang: 'Polski', size: '~1 MB', onPick: () => undefined, onInstall: () => undefined, onCancel: () => undefined }))
    expect(html).toContain("Which team&#x27;s packs?")
    expect(html).toContain('>Klang</button>')
    expect(html).toContain('>Stimmen</button>')
    expect(html).not.toContain('>Install</button>')
    expect(ids(planFor('plPL', 'stimmen'))).toEqual(['places-audio-plPL-stimmen', 'readables-audio-plPL-stimmen'])
    expect(ids(planFor('plPL', 'klang'))).toEqual(['places-audio-plPL'])
  })

  it("with an author chosen, installs that author's packs, the quests bundle in place of its sides", () => {
    const plan = planFor('deDE', 'stimmen')
    expect(ids(plan)).toEqual(['quests-audio-deDE-stimmen', 'places-audio-deDE-stimmen', 'readables-audio-deDE-stimmen'])
    oneTeamPerSection(plan)
    expect(ids(planFor('deDE', 'stimmen', ['places-audio-deDE-stimmen']))).toEqual(['quests-audio-deDE-stimmen', 'readables-audio-deDE-stimmen'])
  })

  it('never installs two packs of one section in one press', () => {
    for (const lang of ['deDE', 'plPL']) for (const choice of [ALL_AUTHORS, '', 'stimmen', 'klang']) oneTeamPerSection(planFor(lang, choice))
  })

  it('asks in Chinese too', () => {
    setUiLanguage('zhCN')
    const html = renderToStaticMarkup(createElement(InstallAllConfirm, { plan: planFor('plPL'), lang: 'Polski', size: '~1 MB', onPick: () => undefined, onInstall: () => undefined, onCancel: () => undefined }))
    expect(html).toContain('安装哪个团队的语音包？')
  })
})
