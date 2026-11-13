import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEED_URL } from '../src/main/updater'

describe('manager update feed', () => {
  it('is the generic manager-latest release, in the code and in the electron-builder config', () => {
    expect(FEED_URL).toBe('https://github.com/rusty-key/spoken-wow/releases/download/manager-latest')
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    expect(pkg.build.publish).toEqual([{ provider: 'generic', url: FEED_URL }])
  })

  it('the production CSP header matches the meta tag of the window', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8')
    const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1]
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8')
    expect(code).not.toContain('avatars.githubusercontent.com')
    const header = /return \[("default-src[^\]]+)\]\.join/.exec(code)?.[1]
    const parse = (s: string): string[] => s.split(';').map((x) => x.trim()).filter(Boolean).sort()
    expect(parse(header!.replace(/",\s*"/g, '; ').replace(/^"|"$/g, '').replace(/"/g, ''))).toEqual(parse(meta!))
  })
})
