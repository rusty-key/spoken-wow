import { describe, expect, it } from 'vitest'
import { LANGUAGES, PRODUCTS, languagesFor, productsFor, type ChannelListing } from '../src/shared/products'
import type { ChannelTeam, QuestsSide, Section } from '../src/shared/types'

const STIMMEN: ChannelTeam = { slug: 'stimmen', name: 'Stimmen', official: false }
const NIHONGO: ChannelTeam = { slug: 'nihongo', name: 'Nihongo', official: false }

const at = (lang: string, section: Section, pack: QuestsSide | null, team: ChannelTeam | null) => ({ lang, section, pack, team })
const sides = (lang: string, suffix: string, team: ChannelTeam | null, which: QuestsSide[] = ['alliance', 'horde', 'shared', 'gossip']) =>
  Object.fromEntries(which.map((s) => [`SpokenQuestsAudio${s[0]!.toUpperCase()}${s.slice(1)}_${lang}${suffix}`, at(lang, 'quests', s, team)]))

function listing(packs: ChannelListing['packs'], languages: ChannelListing['languages'] = {}): ChannelListing {
  return { packs, languages }
}

describe('productsFor', () => {
  it('is the table when there is no channel', () => {
    expect(productsFor(null)).toBe(PRODUCTS)
  })

  it("keeps every table product's id and folders, and adds a team's pack with its team", () => {
    const index = listing({ SpokenPlacesAudio_deDE: at('deDE', 'places', null, null), SpokenPlacesAudio_deDE_stimmen: at('deDE', 'places', null, STIMMEN) })
    const products = productsFor(index)
    for (const p of PRODUCTS) expect(products.find((q) => q.id === p.id)?.folders).toEqual(p.folders)
    expect(products.find((p) => p.id === 'places-audio-deDE')).toMatchObject({ folders: ['SpokenPlacesAudio_deDE'], team: null })
    expect(products.find((p) => p.id === 'places-audio-deDE-stimmen')).toMatchObject({
      kind: 'voices',
      section: 'places',
      lang: 'deDE',
      folders: ['SpokenPlacesAudio_deDE_stimmen'],
      tagPrefix: 'places-audio-deDE-stimmen',
      team: STIMMEN
    })
    expect(products).toHaveLength(PRODUCTS.length + 1)
  })

  it("fills a table product's team from its folder", () => {
    const official = { slug: 'deutsch', name: 'Deutsch', official: true }
    const products = productsFor(listing({ SpokenBossesAudio_deDE: at('deDE', 'bosses', null, official) }))
    expect(products.find((p) => p.id === 'bosses-audio-deDE')?.team).toEqual(official)
  })

  it("gives a team's four quests sides a product each and a bundle of them", () => {
    const products = productsFor(listing(sides('deDE', '_stimmen', STIMMEN)))
    const added = products.slice(PRODUCTS.length)
    expect(added.map((p) => p.id)).toEqual([
      'quests-audio-deDE-stimmen',
      'quests-audio-alliance-deDE-stimmen',
      'quests-audio-horde-deDE-stimmen',
      'quests-audio-shared-deDE-stimmen',
      'quests-audio-gossip-deDE-stimmen'
    ])
    expect(added[0]).toMatchObject({
      pack: 'all',
      folders: ['SpokenQuestsAudioAlliance_deDE_stimmen', 'SpokenQuestsAudioHorde_deDE_stimmen', 'SpokenQuestsAudioShared_deDE_stimmen', 'SpokenQuestsAudioGossip_deDE_stimmen'],
      team: STIMMEN
    })
    expect(added[2]).toMatchObject({ pack: 'horde', folders: ['SpokenQuestsAudioHorde_deDE_stimmen'] })
  })

  it('gives three sides three products and no bundle', () => {
    const added = productsFor(listing(sides('deDE', '_stimmen', STIMMEN, ['alliance', 'horde', 'gossip']))).slice(PRODUCTS.length)
    expect(added.map((p) => p.id)).toEqual(['quests-audio-alliance-deDE-stimmen', 'quests-audio-horde-deDE-stimmen', 'quests-audio-gossip-deDE-stimmen'])
  })

  it("gives a new language's plain packs the shape of today's ids", () => {
    const added = productsFor(listing({ SpokenPlacesAudio_jaJP: at('jaJP', 'places', null, NIHONGO), ...sides('jaJP', '', NIHONGO) })).slice(PRODUCTS.length)
    expect(added.map((p) => p.id)).toEqual(['places-audio-jaJP', 'quests-audio-jaJP', 'quests-audio-alliance-jaJP', 'quests-audio-horde-jaJP', 'quests-audio-shared-jaJP', 'quests-audio-gossip-jaJP'])
    expect(added[0]).toMatchObject({ folders: ['SpokenPlacesAudio_jaJP'], team: NIHONGO })
  })

  it('takes folders from the index, never from a rule', () => {
    const added = productsFor(listing({ SpokenReadablesAudio_ptBR_leitores: at('ptBR', 'readables', null, { slug: 'leitores', name: 'Leitores', official: false }) })).slice(PRODUCTS.length)
    expect(added.map((p) => [p.id, p.folders])).toEqual([['readables-audio-ptBR-leitores', ['SpokenReadablesAudio_ptBR_leitores']]])
  })
})

describe('languagesFor', () => {
  it("lists today's languages in their order, then the index's others by English name, each in its own words", () => {
    const index = listing(
      { SpokenPlacesAudio_jaJP: at('jaJP', 'places', null, NIHONGO), SpokenPlacesAudio_trTR: at('trTR', 'places', null, null) },
      { jaJP: { name: 'Japanese', native: '日本語' }, trTR: { name: 'Turkish', native: 'Türkçe' }, elGR: { name: 'Greek', native: 'Ελληνικά' } }
    )
    const langs = languagesFor(index)
    expect(langs.slice(0, LANGUAGES.length)).toEqual(LANGUAGES)
    expect(langs.slice(LANGUAGES.length)).toEqual([
      { code: 'elGR', name: 'Ελληνικά' },
      { code: 'jaJP', name: '日本語' },
      { code: 'trTR', name: 'Türkçe' }
    ])
  })

  it('names a language the index does not name by its code', () => {
    expect(languagesFor(listing({ SpokenPlacesAudio_jaJP: at('jaJP', 'places', null, null) })).at(-1)).toEqual({ code: 'jaJP', name: 'jaJP' })
  })
})
