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

type ThenFn = (
  this: unknown,
  onFulfilled: (value: unknown) => void,
  onRejected: (error: unknown) => void,
) => void

function readThen(value: unknown): { produced: object; then: ThenFn } | undefined {
  if (typeof value !== 'object' && typeof value !== 'function') {
    return undefined
  }
  if (!value) {
    return undefined
  }
  const then = (value as { then?: unknown }).then
  if (!isThen(then)) {
    return undefined
  }
  return { produced: value, then }
}

function isThen(value: unknown): value is ThenFn {
  return typeof value === 'function'
}

function park(job: Job, produced: object, then: ThenFn, resume: (job: Job) => void): void {
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
    then.call(
      produced,
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
  let bound: { produced: object; then: ThenFn } | undefined
  try {
    bound = readThen(next.value)
  } catch (error) {
    finish(job, () => {
      job.reject(error)
    })
    return
  }
  if (bound === undefined) {
    // Голый yield не ждёт промис. Пока бюджет среза не вышел, этот же генератор продолжают сразу.
    resume(job)
    return
  }
  park(job, bound.produced, bound.then, resume)
}
