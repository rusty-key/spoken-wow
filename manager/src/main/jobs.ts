// Runs install and uninstall jobs: one at a time per game folder, the rest wait in a queue.
import { randomUUID } from 'node:crypto'
import type { JobProgress } from '../shared/types'
import { isAbortError, plainMessage, PlainError } from './errors'
import { log } from './state'

export interface JobSpec {
  gameId: string
  productId: string
  action: JobProgress['action']
  /** The work. Emits its own progress and `done`; throws to fail. */
  run: (ctx: { jobId: string; signal: AbortSignal; emit: (p: JobProgress) => void }) => Promise<void>
  version?: string
  /** Called when the job is cancelled while queued, since `run` will then never be called. */
  onDropped?: () => void
  /** Called once with how the job ended. */
  onEnded?: (phase: 'done' | 'error' | 'cancelled') => void
}

interface Job {
  id: string
  spec: JobSpec
  controller: AbortController
  state: 'queued' | 'running' | 'finished'
}

export class JobManager {
  private queues = new Map<string, Job[]>()
  private running = new Set<string>()
  private jobs = new Map<string, Job>()
  private waiters: (() => void)[] = []

  constructor(private broadcast: (p: JobProgress) => void) {}

  /** Queues a job and returns its id. The same product on the same game while one is waiting or running gives that job's id. */
  enqueue(spec: JobSpec): string {
    for (const j of this.jobs.values()) {
      if (
        j.state !== 'finished' &&
        j.spec.gameId === spec.gameId &&
        j.spec.productId === spec.productId &&
        j.spec.action === spec.action
      ) {
        return j.id
      }
    }
    const job: Job = { id: randomUUID(), spec, controller: new AbortController(), state: 'queued' }
    this.jobs.set(job.id, job)
    const q = this.queues.get(spec.gameId) ?? []
    q.push(job)
    this.queues.set(spec.gameId, q)
    this.publish(job, 'queued', q.length > 1 || this.running.has(spec.gameId) ? 'Waiting for another job on this game' : undefined)
    void this.pump(spec.gameId)
    return job.id
  }

  /** Stops a job: a queued one is dropped, a running one is aborted. */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (!job || job.state === 'finished') return false
    if (job.state === 'queued') {
      const q = this.queues.get(job.spec.gameId) ?? []
      this.queues.set(
        job.spec.gameId,
        q.filter((j) => j !== job)
      )
      job.state = 'finished'
      this.jobs.delete(job.id)
      job.spec.onDropped?.()
      job.spec.onEnded?.('cancelled')
      this.publish(job, 'cancelled', 'Cancelled.')
      this.settle()
      return true
    }
    job.controller.abort()
    return true
  }

  /** Stops every job (queued ones are dropped, running ones roll back) and resolves when all have ended. */
  async cancelAll(): Promise<void> {
    for (const id of this.active()) this.cancel(id)
    if (this.jobs.size === 0) return
    await new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  private settle(): void {
    if (this.jobs.size > 0) return
    for (const resolve of this.waiters.splice(0)) resolve()
  }

  /** Jobs that are waiting or running. */
  active(): string[] {
    return [...this.jobs.values()].filter((j) => j.state !== 'finished').map((j) => j.id)
  }

  private publish(job: Job, phase: JobProgress['phase'], message?: string): void {
    this.emit(job, {
      jobId: job.id,
      gameId: job.spec.gameId,
      productId: job.spec.productId,
      action: job.spec.action,
      phase,
      received: 0,
      total: 0,
      bytesPerSecond: 0,
      ...(job.spec.version ? { version: job.spec.version } : {}),
      ...(message ? { message } : {})
    })
  }

  private emit(job: Job, progress: JobProgress): void {
    try {
      this.broadcast(progress)
    } catch (err) {
      log('Could not send job progress:', err)
    }
  }

  private async pump(gameId: string): Promise<void> {
    if (this.running.has(gameId)) return
    const q = this.queues.get(gameId) ?? []
    const job = q.shift()
    if (!job) return
    this.running.add(gameId)
    job.state = 'running'
    let ended = false
    let outcome: 'done' | 'error' | 'cancelled' = 'done'
    try {
      await job.spec.run({
        jobId: job.id,
        signal: job.controller.signal,
        emit: (p) => {
          if (p.phase === 'done') {
            // Over from here on: a new request for the same thing is a new job, not this one.
            ended = true
            job.state = 'finished'
            this.jobs.delete(job.id)
          }
          this.emit(job, p)
        }
      })
      if (!ended) this.publish(job, 'done')
    } catch (err) {
      // A plain error wins over a cancel: a cancelled install whose rollback failed must say so.
      if (!(err instanceof PlainError) && (isAbortError(err) || job.controller.signal.aborted)) {
        outcome = 'cancelled'
        this.publish(job, 'cancelled', 'Cancelled.')
      } else {
        outcome = 'error'
        log(`Job ${job.spec.action} ${job.spec.productId} failed:`, err)
        this.publish(job, 'error', plainMessage(err))
      }
    } finally {
      job.state = 'finished'
      this.jobs.delete(job.id)
      this.running.delete(gameId)
      job.spec.onEnded?.(outcome)
      this.settle()
      void this.pump(gameId)
    }
  }
}
