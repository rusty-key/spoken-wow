// The generating loop, the pairing and the secrets it needs: what the service runs while
// Generating is on (main/generate.ts says what one round does).
//
// The token and the keys are kept in generate.json, each encrypted by the system's keychain
// (Electron's safeStorage, passed in as `cipher`). Nothing here ever sends a key to the site;
// the window is told only whether one is set.
//
// No electron imports, so it can be tested the way share.ts is.
import os from 'node:os'
import path from 'node:path'
import type { GenerateStatus } from '../shared/types'
import {
  listElevenLabsVoices,
  NotPaired,
  pollPairing,
  runRound,
  startPairing,
  whoAmI,
  type GenerateProvider,
  type SiteOptions
} from './generate'
import { log, readJsonFile, writeJsonAtomic } from './state'

export interface Cipher {
  encrypt(text: string): string
  decrypt(sealed: string): string
}

interface Vault {
  token?: string
  keys: Partial<Record<GenerateProvider, string>>
}

/** How long to wait before claiming again when the queue had nothing, or the site failed. */
const IDLE_MS = 15_000
const FAILED_MS = 60_000
const POLL_MS = 3_000
/** Lines at once. Each is one provider request at a time, inside every plan's concurrency. */
const WIDTH = 2
const VOICES_TTL_MS = 60_000
const MODES_TTL_MS = 60_000

export interface GeneratingOptions extends SiteOptions {
  dataPath: string
  cipher: Cipher
  send: (status: GenerateStatus) => void
  openExternal: (url: string) => void
  /** Replaces the waits between rounds (tests). */
  idleMs?: number
}

export class Generating {
  status: GenerateStatus
  private vault: Vault
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private pairingPoll: ReturnType<typeof setInterval> | null = null
  private voices: { at: number; value: { name: string; voiceId: string }[] } | null = null
  /** When the site was last asked what this account generates here. */
  private refreshedAt = 0

  constructor(private opts: GeneratingOptions) {
    this.vault = this.load()
    this.status = {
      pairedAs: null,
      keys: { elevenlabs: Boolean(this.vault.keys.elevenlabs), fish: Boolean(this.vault.keys.fish) },
      modes: { elevenlabs: 'site', fish: 'site' },
      current: [],
      done: 0,
      failed: 0
    }
  }

  private file(): string {
    return path.join(this.opts.dataPath, 'generate.json')
  }

  private load(): Vault {
    const raw = readJsonFile<{ token?: unknown; keys?: Record<string, unknown> }>(this.file(), {})
    const open = (v: unknown): string | undefined => {
      if (typeof v !== 'string' || !v) return undefined
      try {
        return this.opts.cipher.decrypt(v)
      } catch (err) {
        log('Generating: a stored secret could not be decrypted; set it again.', err)
        return undefined
      }
    }
    const keys: Vault['keys'] = {}
    for (const provider of ['elevenlabs', 'fish'] as const) {
      const key = open(raw.keys?.[provider])
      if (key) keys[provider] = key
    }
    const token = open(raw.token)
    return { ...(token ? { token } : {}), keys }
  }

  private save(): void {
    const seal = (v: string | undefined): string | undefined => (v ? this.opts.cipher.encrypt(v) : undefined)
    writeJsonAtomic(this.file(), {
      token: seal(this.vault.token),
      keys: { elevenlabs: seal(this.vault.keys.elevenlabs), fish: seal(this.vault.keys.fish) }
    })
  }

  private update(patch: Partial<GenerateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.opts.send(this.status)
  }

  /** Asks the site who this token belongs to, and what it generates here. */
  async refresh(): Promise<void> {
    this.refreshedAt = Date.now()
    if (!this.vault.token) return this.update({ pairedAs: null })
    try {
      const me = await whoAmI(this.opts, this.vault.token)
      const { error: _old, ...rest } = this.status
      this.status = rest
      this.update({ pairedAs: me.name ?? 'your account', modes: me.modes })
    } catch (err) {
      if (err instanceof NotPaired) this.forget()
      else this.update({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  private forget(): void {
    delete this.vault.token
    this.save()
    this.update({ pairedAs: null, error: new NotPaired().message })
  }

  async pair(): Promise<void> {
    const label = `Spoken Manager on ${os.hostname().slice(0, 40)}`
    const pairing = await startPairing(this.opts, label)
    this.update({ pairing: { code: pairing.code, verifyUrl: pairing.verifyUrl, expiresAt: pairing.expiresAt } })
    this.opts.openExternal(pairing.verifyUrl)
    if (this.pairingPoll) clearInterval(this.pairingPoll)
    this.pairingPoll = setInterval(() => {
      void pollPairing(this.opts, pairing.poll)
        .then(async (result) => {
          if (result.status === 'pending') return
          if (this.pairingPoll) clearInterval(this.pairingPoll)
          this.pairingPoll = null
          const { pairing: _done, ...rest } = this.status
          this.status = rest
          if (result.status === 'approved') {
            this.vault.token = result.token
            this.save()
            await this.refresh()
          } else {
            this.update({ error: 'The pairing code expired. Press Pair again.' })
          }
        })
        .catch((err) => log('Generating: pairing poll failed:', err))
    }, POLL_MS)
    this.pairingPoll.unref?.()
  }

  unpair(): void {
    if (this.pairingPoll) clearInterval(this.pairingPoll)
    this.pairingPoll = null
    delete this.vault.token
    this.save()
    const { pairing: _p, error: _e, ...rest } = this.status
    this.status = rest
    this.update({ pairedAs: null })
  }

  setKey(provider: GenerateProvider, key: string): void {
    const trimmed = key.trim()
    if (trimmed) this.vault.keys[provider] = trimmed
    else delete this.vault.keys[provider]
    if (provider === 'elevenlabs') this.voices = null
    this.save()
    this.update({ keys: { elevenlabs: Boolean(this.vault.keys.elevenlabs), fish: Boolean(this.vault.keys.fish) } })
  }

  /** Starts the loop; a round runs at once, then whenever the last one ends. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.refresh().then(() => this.schedule(0))
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(ms: number): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.round(), ms)
    this.timer.unref?.()
  }

  private async elevenLabsVoices(): Promise<{ name: string; voiceId: string }[] | null> {
    const key = this.vault.keys.elevenlabs
    if (!key) return null
    if (this.voices && Date.now() - this.voices.at < VOICES_TTL_MS) return this.voices.value
    const value = await listElevenLabsVoices(key, this.opts.fetchImpl)
    this.voices = { at: Date.now(), value }
    return value
  }

  /** One round, then the next one scheduled: at once while there is work, later when there is none. */
  async round(): Promise<void> {
    if (!this.running) return
    // The author may switch a provider between the site and here at any time on the site.
    if (Date.now() - this.refreshedAt > MODES_TTL_MS) await this.refresh()
    const token = this.vault.token
    // Only the providers the account generates here and this computer has a key for.
    const keys: Partial<Record<GenerateProvider, string>> = {}
    for (const provider of ['elevenlabs', 'fish'] as const) {
      if (this.status.modes[provider] === 'local' && this.vault.keys[provider]) keys[provider] = this.vault.keys[provider]
    }
    if (!token || Object.keys(keys).length === 0) return this.schedule(this.opts.idleMs ?? IDLE_MS)
    try {
      const result = await runRound({
        ...this.opts,
        token,
        keys,
        width: WIDTH,
        voices: () => this.elevenLabsVoices(),
        onLine: ({ job, answered }) => {
          const current = answered
            ? this.status.current.filter((line) => line.lineId !== job.lineId)
            : [...this.status.current, { lineId: job.lineId, npcName: job.npcName, preview: job.preview }]
          this.update({
            current,
            done: this.status.done + (answered?.status === 'done' ? 1 : 0),
            failed: this.status.failed + (answered?.status === 'failed' ? 1 : 0)
          })
          if (answered?.status === 'failed') log(`Generating: ${job.lineId} failed: ${answered.kind}: ${answered.message}`)
        }
      })
      if (this.status.error) {
        const { error: _old, ...rest } = this.status
        this.status = rest
        this.opts.send(this.status)
      }
      this.schedule(result.claimed > 0 ? 0 : (this.opts.idleMs ?? IDLE_MS))
    } catch (err) {
      if (err instanceof NotPaired) {
        this.forget()
        return this.schedule(this.opts.idleMs ?? IDLE_MS)
      }
      log('Generating: a round failed:', err)
      this.update({ error: err instanceof Error ? err.message : String(err), current: [] })
      this.schedule(this.opts.idleMs ?? FAILED_MS)
    }
  }

}
