import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HIDDEN_ARG, linuxAutostartEntry, linuxAutostartFile, startedHidden, updateLinuxAutostart } from '../src/main/startup'
import { tmpDir } from './helpers'

describe('manager startup settings', () => {
  it('recognises the hidden startup argument', () => {
    expect(startedHidden(['/usr/bin/spoken-manager', HIDDEN_ARG])).toBe(true)
    expect(startedHidden(['/usr/bin/spoken-manager'])).toBe(false)
  })

  it('writes and removes the Linux autostart entry', () => {
    const appData = tmpDir()
    updateLinuxAutostart(appData, '/opt/Spoken Manager/spoken-manager', true, true)
    const file = linuxAutostartFile(appData)
    expect(fs.readFileSync(file, 'utf8')).toBe(linuxAutostartEntry('/opt/Spoken Manager/spoken-manager', true))
    expect(fs.readFileSync(file, 'utf8')).toContain(`Exec=\"/opt/Spoken Manager/spoken-manager\" ${HIDDEN_ARG}`)

    updateLinuxAutostart(appData, '/opt/Spoken Manager/spoken-manager', false, false)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('escapes quotes and backslashes in the executable path', () => {
    expect(linuxAutostartEntry('C:\\Apps\\Spoken "Manager"\\manager.exe', false)).toContain('Exec="C:\\\\Apps\\\\Spoken \\\"Manager\\\"\\\\manager.exe"')
  })
})
