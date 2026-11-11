import fs from 'node:fs'
import path from 'node:path'

export const HIDDEN_ARG = '--hidden'

export function startedHidden(argv: readonly string[]): boolean {
  return argv.includes(HIDDEN_ARG)
}

export function linuxAutostartFile(appDataPath: string): string {
  return path.join(appDataPath, 'autostart', 'spoken-manager.desktop')
}

// Escapes only " and \: a path holding $, ` or % would need the spec's further escaping.
function desktopQuote(value: string): string {
  return `"${value.replace(/([\\"])/g, '\\$1')}"`
}

export function linuxAutostartEntry(executable: string, hidden: boolean): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Spoken Manager',
    `Exec=${desktopQuote(executable)}${hidden ? ` ${HIDDEN_ARG}` : ''}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

export function updateLinuxAutostart(appDataPath: string, executable: string, enabled: boolean, hidden: boolean): void {
  const file = linuxAutostartFile(appDataPath)
  if (!enabled) {
    fs.rmSync(file, { force: true })
    return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, linuxAutostartEntry(executable, hidden), 'utf8')
}
