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
  cachedVoices,
  localKeys,
  NotPaired,
  pollPairing,
  runRound,
  SITE_URL,
  startPairing,
  whoAmI,
  type GenerateProvider
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
const MODES_TTL_MS = 60_000

export interface GeneratingOptions {
  dataPath: string
  appVersion: string
  siteUrl?: string
  fetchImpl?: typeof fetch
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
  private voices: ReturnType<typeof cachedVoices>
  /** When the site was last asked what this account generates here. */
  private refreshedAt = 0

  constructor(private opts: GeneratingOptions) {
    this.vault = this.load()
    this.voices = cachedVoices(opts.fetchImpl)
    this.status = {
      pairedAs: null,
      keys: { elevenlabs: Boolean(this.vault.keys.elevenlabs), fish: Boolean(this.vault.keys.fish) },
      modes: { elevenlabs: 'site', fish: 'site' },
      current: [],
      done: 0,
      failed: 0
    }
  }

  /** Where the site is, and who is asking. */
  private site(token?: string) {
    return {
      siteUrl: this.opts.siteUrl ?? SITE_URL,
      userAgent: `SpokenManager/${this.opts.appVersion}`,
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      ...(token ? { token } : {})
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

  /** Drops fields from the status without telling the window; whatever follows does. */
  private clear(...fields: ('error' | 'pairing')[]): void {
    const status = { ...this.status }
    for (const field of fields) delete status[field]
    this.status = status
  }

  /** The next round after `ms`, or after the tests' wait. */
  private later(ms: number): void {
    this.schedule(this.opts.idleMs ?? ms)
  }

  /** Asks the site who this token belongs to, and what it generates here. */
  async refresh(): Promise<void> {
    this.refreshedAt = Date.now()
    if (!this.vault.token) return this.update({ pairedAs: null })
    try {
      const me = await whoAmI(this.site(this.vault.token))
      this.clear('error')
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
    const pairing = await startPairing(this.site(), label)
    this.update({ pairing: { code: pairing.code, verifyUrl: pairing.verifyUrl, expiresAt: pairing.expiresAt } })
    this.opts.openExternal(pairing.verifyUrl)
    if (this.pairingPoll) clearInterval(this.pairingPoll)
    this.pairingPoll = setInterval(() => {
      void pollPairing(this.site(), pairing.poll)
        .then(async (result) => {
          if (result.status === 'pending') return
          if (this.pairingPoll) clearInterval(this.pairingPoll)
          this.pairingPoll = null
          this.clear('pairing')
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
    this.clear('pairing', 'error')
    this.update({ pairedAs: null })
  }

  setKey(provider: GenerateProvider, key: string): void {
    const trimmed = key.trim()
    if (trimmed) this.vault.keys[provider] = trimmed
    else delete this.vault.keys[provider]
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

  /** One round, then the next one scheduled: at once while there is work, later when there is none. */
  async round(): Promise<void> {
    if (!this.running) return
    // The author may switch a provider between the site and here at any time on the site.
    if (Date.now() - this.refreshedAt > MODES_TTL_MS) await this.refresh()
    const token = this.vault.token
    // Only the providers the account generates here and this computer has a key for.
    const keys = localKeys(this.vault.keys, this.status.modes)
    if (!token || Object.keys(keys).length === 0) return this.later(IDLE_MS)
    try {
      const result = await runRound({
        ...this.site(token),
        keys,
        onWarning: (message, err) => log(`Generating: ${message}:`, err),
        width: WIDTH,
        voices: () => this.voices(keys.elevenlabs),
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
        this.clear('error')
        this.opts.send(this.status)
      }
      if (result.unreachable) {
        // Offline, or a provider that will not answer: the lines went back, and waiting is
        // all there is to do.
        this.update({ error: `Could not reach the provider: ${result.unreachable}`, current: [] })
        return this.later(FAILED_MS)
      }
      if (result.claimed > 0) this.schedule(0)
      else this.later(IDLE_MS)
    } catch (err) {
      if (err instanceof NotPaired) {
        this.forget()
        return this.later(IDLE_MS)
      }
      log('Generating: a round failed:', err)
      this.update({ error: err instanceof Error ? err.message : String(err), current: [] })
      this.later(FAILED_MS)
    }
  }

}
