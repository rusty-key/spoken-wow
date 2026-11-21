import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addGame,
  describeFlavorFolder,
  flavorOfFolder,
  gameIdFor,
  labelFor,
  notSupportedMessage,
  parseBuildInfo,
  parseFlavorInfo,
  parseProductDb,
  parseRegQuery,
  removeGame,
  resolveGamePath,
  scanGames
} from '../src/main/games'
import { loadState } from '../src/main/state'
import { SUPPORTED_FLAVORS } from '../src/shared/types'
import { makeGame, makeGameFolders, tmpDir, write } from './helpers'

const BUILD_INFO =
  'Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Version!STRING:0|Product!STRING:0\r\n' +
  'us|1|aaaa|bbbb|11.2.0.62213|wow\r\n' +
  'us|1|cccc|dddd|1.60.1.70450|wow_forever\r\n' +
  'us|1|eeee|ffff|1.15.7.61582|wow_classic_era\r\n'

describe('Blizzard files', () => {
  it('parses .build.info rows by header name', () => {
    const rows = parseBuildInfo(BUILD_INFO)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toMatchObject({ Branch: 'us', Version: '1.60.1.70450', Product: 'wow_forever' })
    expect(parseBuildInfo('')).toEqual([])
  })

  it('parses .flavor.info', () => {
    expect(parseFlavorInfo('Product Flavor!STRING:0\nwow_forever')).toBe('wow_forever')
    expect(parseFlavorInfo('Product Flavor!STRING:0\r\nwow_classic_era\r\n')).toBe('wow_classic_era')
    expect(parseFlavorInfo('')).toBeUndefined()
    expect(parseFlavorInfo('Product Flavor!STRING:0')).toBeUndefined()
  })

  it('labels the three supported game versions', () => {
    expect(labelFor('forever')).toBe('WoW: Forever')
    expect(labelFor('classic_era')).toBe('WoW: Classic Era')
    expect(labelFor('anniversary')).toBe('WoW: Anniversary')
  })

  it('knows the supported flavor folders and no others', () => {
    expect(SUPPORTED_FLAVORS).toEqual(['forever', 'classic_era', 'anniversary'])
    expect(flavorOfFolder('_forever_')).toBe('forever')
    expect(flavorOfFolder('_CLASSIC_ERA_')).toBe('classic_era')
    expect(flavorOfFolder('_anniversary_')).toBe('anniversary')
    for (const other of ['_classic_beta_', '_retail_', '_classic_', '_classic_ptr_', '_xptr_', '_ptr_', '_beta_', '_classic_era_ptr_', 'Interface', '']) {
      expect(flavorOfFolder(other)).toBeNull()
    }
  })

  it('makes a stable 12 digit id, case-insensitive on Windows and macOS only', () => {
    const a = gameIdFor('C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_', 'win32')
    expect(a).toMatch(/^[0-9a-f]{12}$/)
    expect(gameIdFor('c:\\program files (x86)\\world of warcraft\\_CLASSIC_BETA_', 'win32')).toBe(a)
    expect(gameIdFor('C:\\other', 'win32')).not.toBe(a)
    const mac = gameIdFor('/Applications/World of Warcraft/_classic_era_', 'darwin')
    expect(gameIdFor('/applications/world of warcraft/_CLASSIC_ERA_', 'darwin')).toBe(mac)
    const linux = gameIdFor('/home/me/Games/battlenet/drive_c/World of Warcraft/_classic_era_', 'linux')
    expect(gameIdFor('/home/me/games/battlenet/drive_c/world of warcraft/_classic_era_', 'linux')).not.toBe(linux)
    expect(gameIdFor('/home/me/Games/battlenet/drive_c/World of Warcraft/_classic_era_', 'linux')).toBe(linux)
  })

  it('reads install paths from reg query output and from product.db bytes', () => {
    const reg =
      '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft\r\n' +
      '    InstallPath    REG_SZ    C:\\Program Files (x86)\\World of Warcraft\\_retail_\\\r\n\r\n'
    expect(parseRegQuery(reg)).toEqual(['C:\\Program Files (x86)\\World of Warcraft\\_retail_\\'])
    const db = Buffer.concat([Buffer.from([0x0a, 0x2a]), Buffer.from('D:\\Games\\World of Warcraft'), Buffer.from([0x12, 0x00, 0xff])])
    expect(parseProductDb(db)).toEqual(['D:\\Games\\World of Warcraft'])
  })
})

describe('describeFlavorFolder', () => {
  it('reads product and version for a flavor folder', async () => {
    const base = tmpDir()
    const g = await makeGame(base)
    expect(g).toMatchObject({
      flavor: 'forever',
      flavorFolder: '_forever_',
      product: 'wow_forever',
      label: 'WoW: Forever',
      gameVersion: '1.60.1.70450',
      source: 'manual',
      writable: true
    })
    expect(g.addOnsPath).toBe(path.join(g.root, 'Interface', 'AddOns'))
    expect(g.id).toBe(gameIdFor(g.root))
  })

  it('writes nothing into the game folder while scanning', async () => {
    const base = tmpDir()
    const g = await makeGame(base)
    const snapshot = (): string[] => {
      const out: string[] = []
      const walk = (d: string): void => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          out.push(path.join(d, e.name))
          if (e.isDirectory()) walk(path.join(d, e.name))
        }
      }
      walk(base)
      return out.sort()
    }
    const before = snapshot()
    await describeFlavorFolder(g.root, 'auto')
    await scanGames(tmpDir(), { autoPaths: [path.dirname(g.root)] })
    expect(snapshot()).toEqual(before)
  })

  it('is writable when only the Interface folder is missing, and not when a file is in the way', async () => {
    const base = tmpDir()
    const g = await makeGame(base)
    fs.rmSync(path.join(g.root, 'Interface'), { recursive: true })
    fs.mkdirSync(path.join(g.root, 'WTF'), { recursive: true })
    expect((await describeFlavorFolder(g.root, 'auto'))!.writable).toBe(true)
    write(path.join(g.root, 'Interface'), 'a file')
    expect((await describeFlavorFolder(g.root, 'auto'))!.writable).toBe(false)
  })

  it('picks the build.info row of its own product', async () => {
    const base = tmpDir()
    const root = path.join(base, 'World of Warcraft')
    write(path.join(root, '.build.info'), BUILD_INFO)
    write(path.join(root, '_classic_era_', '.flavor.info'), 'Product Flavor!STRING:0\nwow_classic_era\n')
    fs.mkdirSync(path.join(root, '_classic_era_', 'Interface'), { recursive: true })
    fs.mkdirSync(path.join(root, '_anniversary_', 'WTF'), { recursive: true })
    const era = await describeFlavorFolder(path.join(root, '_classic_era_'), 'auto')
    expect(era).toMatchObject({ product: 'wow_classic_era', gameVersion: '1.15.7.61582', label: 'WoW: Classic Era' })
    // No .flavor.info: the product comes from the folder name; no row in build.info: no version.
    const anniversary = await describeFlavorFolder(path.join(root, '_anniversary_'), 'auto')
    expect(anniversary).toMatchObject({ product: 'wow_anniversary', flavor: 'anniversary', label: 'WoW: Anniversary' })
    expect(anniversary!.gameVersion).toBeUndefined()
  })

  it('accepts a folder with only a Wow exe, and refuses an empty one', async () => {
    const base = tmpDir()
    write(path.join(base, '_classic_era_', 'WowClassic.exe'), 'x')
    fs.mkdirSync(path.join(base, '_anniversary_'), { recursive: true })
    expect(await describeFlavorFolder(path.join(base, '_classic_era_'), 'auto')).not.toBeNull()
    expect(await describeFlavorFolder(path.join(base, '_anniversary_'), 'auto')).toBeNull()
    expect(await describeFlavorFolder(path.join(base, 'missing'), 'auto')).toBeNull()
  })

  it('refuses a folder of a game Spoken does not run on, even with a real install in it', async () => {
    for (const folder of ['_retail_', '_classic_', '_ptr_', '_xptr_', '_classic_ptr_', '_beta_']) {
      const flavor = makeGameFolders(tmpDir(), { flavorFolder: folder, product: 'wow' })
      expect(await describeFlavorFolder(flavor, 'auto')).toBeNull()
    }
  })

  it('names a _forever_ folder without .flavor.info by its folder', async () => {
    const base = tmpDir()
    const forever = makeGameFolders(base)
    fs.rmSync(path.join(forever, '.flavor.info'))
    const g = await describeFlavorFolder(forever, 'manual')
    expect(g).toMatchObject({ flavor: 'forever', product: 'wow_forever', gameVersion: '1.60.1.70450' })
  })

  it('has no gameVersion when build.info has no row for it', async () => {
    const base = tmpDir()
    const g = await makeGame(base, { product: 'wow_forever' })
    write(path.join(path.dirname(g.root), '.build.info'), BUILD_INFO.replace('wow_forever', 'other'))
    const again = await describeFlavorFolder(g.root, 'auto')
    expect(again?.gameVersion).toBeUndefined()
  })
})

describe('resolveGamePath', () => {
  it('gives every flavor of a game folder, in a fixed order', async () => {
    const base = tmpDir()
    await makeGame(base, { flavorFolder: '_anniversary_', product: 'wow_anniversary' })
    await makeGame(base, { flavorFolder: '_classic_era_', product: 'wow_classic_era' })
    await makeGame(base, { flavorFolder: '_forever_', product: 'wow_forever' })
    // A game version Spoken does not run on sits beside them and is left out.
    makeGameFolders(base, { flavorFolder: '_retail_', product: 'wow' })
    const res = await resolveGamePath(path.join(base, 'World of Warcraft'), 'manual')
    expect(res.error).toBeUndefined()
    expect(res.games.map((g) => g.flavorFolder)).toEqual(['_forever_', '_classic_era_', '_anniversary_'])
  })

  it('refuses the ended Forever beta in _classic_beta_ and keeps _forever_ beside it', async () => {
    const base = tmpDir()
    const beta = makeGameFolders(base, { flavorFolder: '_classic_beta_', product: 'wow_classic_beta' })
    expect((await resolveGamePath(beta, 'manual')).error).toBe('_classic_beta_ is the WoW: Forever beta, which has ended. Spoken runs on the released game in _forever_.')
    await makeGame(base)
    const res = await resolveGamePath(path.join(base, 'World of Warcraft'), 'manual')
    expect(res.games.map((g) => g.flavorFolder)).toEqual(['_forever_'])
  })

  it('resolves a flavor folder, an Interface folder and an AddOns folder to the same install', async () => {
    const base = tmpDir()
    const g = await makeGame(base)
    for (const p of [g.root, path.join(g.root, 'Interface'), g.addOnsPath, `"${g.addOnsPath}"`, `${g.root}${path.sep}`]) {
      const res = await resolveGamePath(p, 'manual')
      expect(res.games.map((x) => x.id)).toEqual([g.id])
    }
  })

  it('refuses a game version Spoken does not run on, by whatever path it is given', async () => {
    const base = tmpDir()
    const retail = makeGameFolders(base, { flavorFolder: '_retail_', product: 'wow' })
    const message = 'Spoken runs on WoW: Forever, Classic Era and Anniversary. _retail_ is not one of them.'
    expect(notSupportedMessage('_retail_')).toBe(message)
    for (const p of [retail, path.join(retail, 'Interface'), path.join(retail, 'Interface', 'AddOns'), path.join(base, 'World of Warcraft')]) {
      const res = await resolveGamePath(p, 'manual')
      expect(res.games).toEqual([])
      expect(res.error).toBe(message)
    }
    const ptr = makeGameFolders(tmpDir(), { flavorFolder: '_classic_ptr_', product: 'wow_classic_ptr' })
    expect((await resolveGamePath(ptr, 'manual')).error).toBe('Spoken runs on WoW: Forever, Classic Era and Anniversary. _classic_ptr_ is not one of them.')
  })

  it('refuses a folder that holds an Interface folder but is not a flavor folder', async () => {
    const base = tmpDir()
    fs.mkdirSync(path.join(base, 'My WoW copy', 'Interface', 'AddOns'), { recursive: true })
    const res = await resolveGamePath(path.join(base, 'My WoW copy'), 'manual')
    expect(res.games).toEqual([])
    expect(res.error).toMatch(/does not look like a World of Warcraft folder/)
  })

  it('says in plain words when it is not a WoW folder', async () => {
    const base = tmpDir()
    fs.mkdirSync(path.join(base, 'Documents'))
    const res = await resolveGamePath(path.join(base, 'Documents'), 'manual')
    expect(res.games).toEqual([])
    expect(res.error).toMatch(/does not look like a World of Warcraft folder/)
    expect((await resolveGamePath(path.join(base, 'nope'), 'manual')).error).toBe('That folder does not exist.')
    expect((await resolveGamePath('   ', 'manual')).error).toBe('Choose a folder first.')
  })
})

describe('scanGames, addGame, removeGame', () => {
  it('finds auto paths, keeps manual ones and hides removed auto ones', async () => {
    const data = tmpDir()
    const base = tmpDir()
    const a = await makeGame(base, { flavorFolder: '_anniversary_', product: 'wow_anniversary' })
    makeGameFolders(base, { flavorFolder: '_retail_', product: 'wow' })
    const other = tmpDir()
    const b = await makeGame(other)

    let games = await scanGames(data, { autoPaths: [path.join(base, 'World of Warcraft'), path.join(base, 'no-such-folder')] })
    expect(games.map((g) => g.id)).toEqual([a.id])
    expect(games[0]!.source).toBe('auto')

    const added = await addGame(data, path.join(other, 'World of Warcraft'))
    expect(added.games.map((g) => g.id)).toEqual([b.id])
    expect(loadState(data).manualGames).toEqual([b.root])
    games = await scanGames(data, { autoPaths: [path.join(base, 'World of Warcraft')] })
    expect(games.map((g) => g.id).sort()).toEqual([a.id, b.id].sort())
    expect(games.find((g) => g.id === b.id)!.source).toBe('manual')

    // Removing a manual one forgets it; removing an auto one hides it from the scan.
    removeGame(data, games.find((g) => g.id === b.id)!)
    removeGame(data, games.find((g) => g.id === a.id)!)
    expect(loadState(data).manualGames).toEqual([])
    expect(await scanGames(data, { autoPaths: [path.join(base, 'World of Warcraft')] })).toEqual([])
    // Adding it again brings it back.
    await addGame(data, a.root)
    expect((await scanGames(data, { autoPaths: [path.join(base, 'World of Warcraft')] })).map((g) => g.id)).toEqual([a.id])
  })

  it('refuses to add a game Spoken does not run on, and forgets such a saved game on the next scan', async () => {
    const data = tmpDir()
    const retail = makeGameFolders(tmpDir(), { flavorFolder: '_retail_', product: 'wow' })
    const res = await addGame(data, retail)
    expect(res.error).toMatch(/_retail_ is not one of them/)
    expect(loadState(data).manualGames).toEqual([])

    // A state file written by an earlier run, which listed Retail and one supported game.
    const good = await makeGame(tmpDir())
    fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ manualGames: [retail, good.root], installs: {} }))
    const games = await scanGames(data, { autoPaths: [] })
    expect(games.map((g) => g.id)).toEqual([good.id])
    expect(loadState(data).manualGames).toEqual([good.root])
    // Nothing on disk was touched.
    expect(fs.existsSync(path.join(retail, 'Interface', 'AddOns'))).toBe(true)
    expect(fs.existsSync(path.join(retail, 'WTF'))).toBe(true)
  })

  it('moves a saved Forever beta to the _forever_ folder beside it, or forgets it', async () => {
    const data = tmpDir()
    const base = tmpDir()
    const beta = makeGameFolders(base, { flavorFolder: '_classic_beta_', product: 'wow_classic_beta' })
    fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ manualGames: [beta], installs: {} }))
    expect(await scanGames(data, { autoPaths: [] })).toEqual([])
    expect(loadState(data).manualGames).toEqual([])

    const forever = await makeGame(base)
    fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify({ manualGames: [beta], installs: {} }))
    expect((await scanGames(data, { autoPaths: [] })).map((g) => g.id)).toEqual([forever.id])
    expect(loadState(data).manualGames).toEqual([forever.root])
  })

  it('names the ended Forever beta before any other game Spoken does not run on', async () => {
    const base = tmpDir()
    makeGameFolders(base, { flavorFolder: '_beta_', product: 'wow_beta' })
    makeGameFolders(base, { flavorFolder: '_classic_beta_', product: 'wow_classic_beta' })
    const res = await resolveGamePath(path.join(base, 'World of Warcraft'), 'manual')
    expect(res.error).toMatch(/^_classic_beta_ is the WoW: Forever beta/)
  })

  it('returns an error string and stores nothing for a bad folder', async () => {
    const data = tmpDir()
    const res = await addGame(data, tmpDir())
    expect(res.error).toBeTruthy()
    expect(loadState(data).manualGames).toEqual([])
  })
})
