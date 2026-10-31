import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { productById, SPOKEN_FOLDERS } from '../src/shared/products'
import { isAllowedExternalUrl, isAllowedOpenPath } from '../src/main/external'
import {
  allowedFolders,
  canWrite,
  canWriteQuick,
  checkEntryPath,
  ensureFreeSpace,
  findEntrySync,
  foldsCase,
  isGameRunning,
  isInside,
  isLinked,
  isWowProcess,
  isWowPsLine,
  parsePs,
  parseTasklist,
  samePath
} from '../src/main/guard'
import { tmpDir, write } from './helpers'

describe('checkEntryPath', () => {
  const allowed = ['Spoken', 'Spoken_Places']
  const cases: [string, boolean, string?][] = [
    ['Spoken/Spoken.toc', true],
    ['Spoken/sub/deep/file.lua', true],
    ['Spoken_Places/', true],
    ['Spoken/', true],
    ['../evil.txt', false],
    ['Spoken/../../evil.txt', false],
    ['Spoken/../Spoken_Places/x', false],
    ['/etc/passwd', false],
    ['/Spoken/x', false],
    ['C:/Windows/x.dll', false],
    ['c:evil', false],
    ['Spoken\\..\\evil.txt', false],
    ['Spoken\\file.lua', false],
    ['Spoken/a\0b', false],
    ['Spoken//x', false],
    ['Spoken/./x', false],
    ['Spoken/x:stream', false],
    ['Spoken/x.', false],
    ['Spoken/x ', false],
    ['Spoken/CON<', false],
    ['spoken/Spoken.toc', false],
    ['WTF/Account/x.lua', false],
    ['Other/Other.toc', false],
    ['README.txt', false],
    ['Spoken', false],
    ['', false]
  ]
  for (const [name, ok] of cases) {
    it(`${ok ? 'accepts' : 'refuses'} ${JSON.stringify(name)}`, () => {
      expect(checkEntryPath(name, allowed).ok).toBe(ok)
    })
  }

  it('splits the path and flags directories', () => {
    const r = checkEntryPath('Spoken/a/b.lua', allowed)
    expect(r).toEqual({ ok: true, segments: ['Spoken', 'a', 'b.lua'], directory: false })
    const d = checkEntryPath('Spoken/a/', allowed)
    expect(d).toEqual({ ok: true, segments: ['Spoken', 'a'], directory: true })
  })
})

describe('allowedFolders', () => {
  it('uses the product folders for a voice pack and the Spoken list for Spoken', () => {
    // A pack keeps its folder from before its section was renamed, to see it and replace it.
    expect(allowedFolders(productById('places-audio')!)).toEqual(['SpokenPlacesAudio', 'SpokenZonesAudio'])
    expect(allowedFolders(productById('quests-audio')!)).toHaveLength(4)
    expect(allowedFolders(productById('spoken')!)).toEqual(SPOKEN_FOLDERS)
  })
})

describe('isInside', () => {
  it('accepts the folder itself and children, refuses siblings and escapes', () => {
    const root = path.resolve('somewhere', 'AddOns')
    expect(isInside(root, root)).toBe(true)
    expect(isInside(root, path.join(root, 'Spoken', 'x'))).toBe(true)
    expect(isInside(root, path.join(root, '..', 'WTF'))).toBe(false)
    expect(isInside(root, `${root}-other`)).toBe(false)
  })

  it('ignores letter case on Windows and macOS and not on Linux', () => {
    const win = 'C:\\Games\\AddOns'
    expect(isInside(win, 'C:\\GAMES\\addons\\Spoken', 'win32')).toBe(true)
    expect(isInside(win, 'C:\\Games\\AddOns-other', 'win32')).toBe(false)
    const posix = '/Users/me/AddOns'
    expect(isInside(posix, '/USERS/me/addons/Spoken', 'darwin')).toBe(true)
    expect(isInside(posix, '/USERS/me/addons/Spoken', 'linux')).toBe(false)
    expect(isInside(posix, '/Users/me/AddOns/Spoken/x', 'linux')).toBe(true)
    expect(isInside(posix, '/Users/me/WTF', 'linux')).toBe(false)
    expect(isInside(posix, '/Users/me/AddOns/../WTF', 'linux')).toBe(false)
  })
})

describe('letter case by platform', () => {
  it('Windows and macOS fold case, Linux does not', () => {
    expect(foldsCase('win32')).toBe(true)
    expect(foldsCase('darwin')).toBe(true)
    expect(foldsCase('linux')).toBe(false)
  })

  it('samePath follows the platform', () => {
    expect(samePath('C:\\Games\\World of Warcraft', 'c:\\games\\WORLD OF WARCRAFT\\', 'win32')).toBe(true)
    const a = '/Applications/World of Warcraft'
    const b = '/applications/world of warcraft'
    expect(samePath(a, b, 'darwin')).toBe(true)
    expect(samePath(a, b, 'linux')).toBe(false)
    expect(samePath(a, '/Applications/Other/../World of Warcraft', 'linux')).toBe(true)
  })

  it('findEntrySync gives the real-cased name, preferring the exact one', () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, 'wtf'))
    expect(findEntrySync(dir, 'WTF')).toBe('wtf')
    expect(findEntrySync(dir, 'wtf')).toBe('wtf')
    expect(findEntrySync(dir, 'Interface')).toBeNull()
    expect(findEntrySync(path.join(dir, 'missing'), 'WTF')).toBeNull()
  })
})

describe('isLinked', () => {
  it('is false for a plain folder and a missing path', async () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, 'real'))
    expect(await isLinked(path.join(dir, 'real'))).toBe(false)
    expect(await isLinked(path.join(dir, 'missing'))).toBe(false)
  })

  it('is true for a junction and for a folder inside a linked parent chain only when it is the link itself', async () => {
    const dir = tmpDir()
    const target = path.join(dir, 'checkout')
    fs.mkdirSync(path.join(target, 'inner'), { recursive: true })
    const link = path.join(dir, 'AddOns-link')
    fs.symlinkSync(target, link, 'junction')
    expect(await isLinked(link)).toBe(true)
    // `inner` is a plain folder that happens to be reached through a junction: it is not itself linked.
    expect(await isLinked(path.join(link, 'inner'))).toBe(false)
  })

  it('is true for a symlink to a folder and to a file (a junction is a symlink on macOS and Linux)', async () => {
    const dir = tmpDir()
    const target = path.join(dir, 'checkout')
    fs.mkdirSync(target)
    write(path.join(dir, 'file.txt'), 'x')
    const folderLink = path.join(dir, 'folder-link')
    fs.symlinkSync(target, folderLink, 'junction')
    expect(await isLinked(folderLink)).toBe(true)
    try {
      fs.symlinkSync(path.join(dir, 'file.txt'), path.join(dir, 'file-link'), 'file')
    } catch {
      return // a symlink to a file needs a privilege on Windows
    }
    expect(await isLinked(path.join(dir, 'file-link'))).toBe(true)
  })

  it('is true for a symlink that points nowhere', async () => {
    const dir = tmpDir()
    const link = path.join(dir, 'dangling')
    try {
      fs.symlinkSync(path.join(dir, 'gone'), link, 'dir')
    } catch {
      return // needs a privilege on Windows
    }
    expect(await isLinked(link)).toBe(true)
  })
})

describe('disk and write checks', () => {
  it('reports not enough space in plain words', async () => {
    const dir = tmpDir()
    await expect(ensureFreeSpace(dir, 1e18, 'Test (1 EB)')).rejects.toThrow(/Not enough free space/)
    await expect(ensureFreeSpace(dir, 1024)).resolves.toBeUndefined()
  })

  it('canWrite creates and removes a probe file, using the nearest existing parent', async () => {
    const dir = tmpDir()
    expect(await canWrite(path.join(dir, 'Interface', 'AddOns'))).toBe(true)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('canWriteQuick checks access and creates nothing', async () => {
    const dir = tmpDir()
    expect(await canWriteQuick(path.join(dir, 'Interface', 'AddOns'))).toBe(true)
    expect(fs.readdirSync(dir)).toEqual([])
    write(path.join(dir, 'file.txt'), 'x')
    expect(await canWriteQuick(path.join(dir, 'file.txt', 'sub'))).toBe(false)
    expect(await canWriteQuick(path.join(dir, 'file.txt'))).toBe(false)
  })

  it('canWrite is false when the nearest existing path is a file', async () => {
    const dir = tmpDir()
    write(path.join(dir, 'file.txt'), 'x')
    expect(await canWrite(path.join(dir, 'file.txt', 'sub'))).toBe(false)
  })
})

describe('running game', () => {
  it('reads process names from tasklist output', () => {
    const out = '"System","4","Services","0","1,000 K"\r\n"Wow.exe","1234","Console","1","2,000,000 K"\r\n"WowClassic.exe","5","Console","1","1 K"\r\n'
    expect(parseTasklist(out)).toEqual(['System', 'Wow.exe', 'WowClassic.exe'])
  })

  it('matches Wow*.exe only', () => {
    for (const n of ['Wow.exe', 'WowClassic.exe', 'WowB.exe', 'WowT.exe', 'WowClassicT.exe', 'WowClassicB.exe', 'wow-64.exe']) {
      expect(isWowProcess(n)).toBe(true)
    }
    for (const n of ['Battle.net.exe', 'Agent.exe', 'Wow.dll', 'notwow.exe', 'Wowhead Client.exe.bak']) {
      expect(isWowProcess(n)).toBe(false)
    }
  })
})

describe('running game on macOS and Linux', () => {
  const MAC = [
    '/sbin/launchd                     /sbin/launchd',
    '/Applications/World of Warcraft/_classic_era_/World of Warcraft Classic.app/Contents/MacOS/World of Warcraft Classic /Applications/World of Warcraft/_classic_era_/World of Warcraft Classic.app/Contents/MacOS/World of Warcraft Classic',
    '/Applications/Battle.net.app/Contents/MacOS/Battle.net /Applications/Battle.net.app/Contents/MacOS/Battle.net'
  ]
  const WINE = [
    'systemd           /sbin/init',
    'Wow.exe           Z:\\home\\me\\Games\\battlenet\\drive_c\\Program Files (x86)\\World of Warcraft\\_classic_era_\\Wow.exe',
    'wine64-preloader  C:\\Program Files (x86)\\World of Warcraft\\_forever_\\WowClassic.exe -managerlogin'
  ]
  const EOL = String.fromCharCode(10)

  it('finds the macOS app bundle, and a Windows client under Wine, by process line', () => {
    expect(isWowPsLine(MAC[1]!)).toBe(true)
    expect(isWowPsLine('World of Warcraft  /Applications/x')).toBe(true)
    expect(isWowPsLine(WINE[1]!)).toBe(true)
    expect(isWowPsLine(WINE[2]!)).toBe(true)
    expect(isWowPsLine('WowB.exe  Z:\\x\\WowB.exe')).toBe(true)
    for (const other of [MAC[0]!, MAC[2]!, WINE[0]!, 'vim /home/me/notes-about-Wow.exe.txt', 'bash -c cd "/Applications/World of Warcraft"', 'Battle.net.exe  C:\\Battle.net\\Battle.net.exe']) {
      expect(isWowPsLine(other)).toBe(false)
    }
  })

  it('reads a whole ps listing', () => {
    expect(parsePs(MAC.join(EOL))).toBe(true)
    expect(parsePs(MAC.filter((l) => !l.includes('World of Warcraft')).join(EOL))).toBe(false)
    expect(parsePs(WINE.join(EOL))).toBe(true)
    expect(parsePs('')).toBe(false)
  })

  it('asks ps on macOS and Linux and tasklist on Windows', async () => {
    const calls: string[] = []
    const exec = (out: string | null) => async (file: string, args: string[]) => {
      calls.push([file, ...args].join(' '))
      return out
    }
    expect(await isGameRunning('classic_era', { platform: 'darwin', exec: exec(MAC.join(EOL)) })).toBe(true)
    expect(await isGameRunning('classic_era', { platform: 'linux', exec: exec(WINE.join(EOL)) })).toBe(true)
    expect(await isGameRunning('classic_era', { platform: 'linux', exec: exec('systemd /sbin/init') })).toBe(false)
    expect(await isGameRunning('classic_era', { platform: 'win32', exec: exec('"Wow.exe","1","Console","1","1 K"') })).toBe(true)
    expect(calls).toEqual([
      'ps -A -o comm=,args=',
      'ps -A -o comm=,args=',
      'ps -A -o comm=,args=',
      'tasklist /FO CSV /NH'
    ])
  })

  it('is false, and does not throw, when the command is missing or fails', async () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(await isGameRunning('classic_era', { platform, exec: async () => null })).toBe(false)
    }
    expect(await isGameRunning('classic_era', { platform: 'linux', exec: () => Promise.reject(new Error('ENOENT')) })).toBe(false)
  })

  it('the default command runner survives a command that does not exist', async () => {
    // Real ps or tasklist on this machine: only that it answers true or false without throwing.
    expect(typeof (await isGameRunning())).toBe('boolean')
  })
})

describe('what the window may open', () => {
  it('allows https links on GitHub hosts and the site only', () => {
    expect(isAllowedExternalUrl('https://github.com/rusty-key/spoken-wow/releases')).toBe(true)
    expect(isAllowedExternalUrl('https://raw.githubusercontent.com/a/b/c')).toBe(true)
    expect(isAllowedExternalUrl('https://objects.githubusercontent.com/x')).toBe(true)
    expect(isAllowedExternalUrl('https://spoken.rusty.one/profile?pair=K7QM-2XPA')).toBe(true)
    for (const bad of [
      'http://github.com/x',
      'https://evil.com/github.com',
      'https://github.com.evil.com/',
      'https://user:pw@github.com/',
      'https://github.com:8443/',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-msdt:/x',
      'not a url',
      '',
      42,
      null
    ]) {
      expect(isAllowedExternalUrl(bad)).toBe(false)
    }
  })

  it('allows paths inside the known roots only', () => {
    const roots = [path.resolve('x', 'AddOns'), path.resolve('data')]
    expect(isAllowedOpenPath(path.resolve('x', 'AddOns', 'Spoken'), roots)).toBe(true)
    expect(isAllowedOpenPath(path.resolve('data', 'logs'), roots)).toBe(true)
    expect(isAllowedOpenPath(path.resolve('x', 'AddOns', '..', 'WTF'), roots)).toBe(false)
    expect(isAllowedOpenPath(path.resolve('elsewhere'), roots)).toBe(false)
    expect(isAllowedOpenPath('relative/path', roots)).toBe(false)
    expect(isAllowedOpenPath('', roots)).toBe(false)
    expect(isAllowedOpenPath(7, roots)).toBe(false)
  })
})
