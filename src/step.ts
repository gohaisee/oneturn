import type { Turn } from './turn.ts'

export type Job = {
  gen: Generator<unknown, unknown, unknown>
  turn: Turn
  sent: unknown
  signal: AbortSignal | undefined
  settled: boolean
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

function finish(job: Job, settle: () => void): void {
  if (job.settled) {
    return
  }
  job.settled = true
  settle()
}

function stop(job: Job, reason: unknown): void {
  if (job.settled) {
    return
  }
  let cleanup: unknown
  let threw = false
  try {
    job.gen.return(undefined)
  } catch (error) {
    cleanup = error
    threw = true
  }
  if (job.settled) {
    return
  }
  job.settled = true
  job.reject(threw ? cleanup : reason)
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (typeof value !== 'object' && typeof value !== 'function') {
    return false
  }
  if (!value || typeof (value as { then?: unknown }).then !== 'function') {
    return false
  }
  return true
}

function park(job: Job, produced: PromiseLike<unknown>, resume: (job: Job) => void): void {
  let closed = false
  const onAbort = () => {
    if (closed || job.settled) {
      return
    }
    closed = true
    stop(job, job.signal?.reason)
  }
  if (job.signal?.aborted) {
    onAbort()
    return
  }
  if (job.signal) {
    job.signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    produced.then(
      (value) => {
        if (closed || job.settled) {
          return
        }
        closed = true
        job.signal?.removeEventListener('abort', onAbort)
        job.sent = value
        resume(job)
      },
      (error) => {
        if (closed || job.settled) {
          return
        }
        closed = true
        job.signal?.removeEventListener('abort', onAbort)
        finish(job, () => {
          job.reject(error)
        })
      },
    )
  } catch (error) {
    job.signal?.removeEventListener('abort', onAbort)
    if (closed || job.settled) {
      return
    }
    closed = true
    finish(job, () => {
      job.reject(error)
    })
  }
}

export function step(job: Job, deadline: number, resume: (job: Job) => void): void {
  if (job.settled) {
    return
  }
  // Сигнал смотрят в начале шага. Текущий синхронный кусок уже не остановить.
  if (job.signal?.aborted) {
    stop(job, job.signal.reason)
    return
  }
  job.turn.deadline = deadline
  let next: IteratorResult<unknown>
  try {
    next = job.gen.next(job.sent)
  } catch (error) {
    finish(job, () => {
      job.reject(error)
    })
    return
  }
  job.sent = undefined
  if (next.done) {
    finish(job, () => {
      job.resolve(next.value)
    })
    return
  }
  if (isThenable(next.value)) {
    park(job, next.value, resume)
    return
  }
  // Голый yield не ждёт промис. Пока бюджет среза не вышел, этот же генератор продолжают сразу.
  resume(job)
}
