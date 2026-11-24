import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HIDDEN_ARG, updateLinuxAutostart } from '../src/main/startup'
import { tmpDir } from './helpers'

const execLine = (appData: string): string | undefined =>
  fs
    .readFileSync(path.join(appData, 'autostart', 'spoken-manager.desktop'), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('Exec='))

describe('manager startup settings', () => {
  it('writes and removes the Linux autostart entry', () => {
    const appData = tmpDir()
    updateLinuxAutostart(appData, '/opt/Spoken Manager/spoken-manager', true, true)
    expect(execLine(appData)).toBe(`Exec="/opt/Spoken Manager/spoken-manager" ${HIDDEN_ARG}`)

    updateLinuxAutostart(appData, '/opt/Spoken Manager/spoken-manager', true, false)
    expect(execLine(appData)).toBe('Exec="/opt/Spoken Manager/spoken-manager"')

    updateLinuxAutostart(appData, '/opt/Spoken Manager/spoken-manager', false, false)
    expect(fs.existsSync(path.join(appData, 'autostart', 'spoken-manager.desktop'))).toBe(false)
  })

  it('escapes quotes and backslashes in the executable path', () => {
    const appData = tmpDir()
    updateLinuxAutostart(appData, '/opt/Spoken "Manager"\\manager', true, false)
    expect(execLine(appData)).toBe('Exec="/opt/Spoken \\"Manager\\"\\\\manager"')
  })
})
