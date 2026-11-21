import { monitorEventLoopDelay } from 'node:perf_hooks'
import { makeQueue } from './queue.ts'
import { step, type Job } from './step.ts'
import { makeTurn, type Turn } from './turn.ts'

export type Deps = {
  now: () => number
  later: (fn: () => void) => void
  lag: () => number
}

export type TaskOpts = {
  signal?: AbortSignal
}

const SLICE_MS = 5
const SLOW_MS = 1
const LAG_MS = 20
const STUCK = 8

let histogram: ReturnType<typeof monitorEventLoopDelay> | undefined

function defaultLag(): number {
  histogram ??= monitorEventLoopDelay({ resolution: 20, samplePerIteration: true })
  histogram.enable()
  const lagMs = histogram.mean / 1e6
  // Среднее копится за всю жизнь процесса. Без сброса один старый лаг держит короткий срез навсегда.
  histogram.reset()
  return lagMs
}

function budget(lagMs: number): number {
  if (lagMs > LAG_MS) {
    return SLOW_MS
  }
  return SLICE_MS
}

function isGenerator(value: unknown): value is Generator<unknown, unknown, unknown> {
  if (typeof value !== 'object' && typeof value !== 'function') {
    return false
  }
  if (!value || typeof (value as { next?: unknown }).next !== 'function') {
    return false
  }
  return true
}

export function open(deps?: Partial<Deps>): {
  task: (work: (turn: Turn) => unknown, opts?: TaskOpts) => Promise<unknown>
} {
  const now = deps?.now ?? (() => performance.now())
  const later = deps?.later ?? ((fn: () => void) => {
    setImmediate(fn)
  })
  const lag = deps?.lag ?? defaultLag
  const queue = makeQueue<Job>()
  let slicing = false
  let scheduled = false

  function schedule(): void {
    if (scheduled) {
      return
    }
    scheduled = true
    // Один immediate на процесс. Сотня await scheduler.yield() встала бы в одну check-фазу и не пустила бы таймеры.
    later(run)
  }

  function enqueue(job: Job): void {
    queue.push(job)
    if (!slicing) {
      schedule()
    }
  }

  function run(): void {
    slicing = true
    scheduled = false
    try {
      const deadline = now() + budget(lag())
      let stuck = 0
      let last = now()
      while (now() < deadline && queue.has()) {
        const seen = now()
        if (seen === last) {
          stuck += 1
        } else {
          stuck = 0
        }
        last = seen
        // Если часы не сдвинулись, выходим из среза. Иначе генератор, который сдаётся сразу, крутится тут до бесконечности.
        if (stuck > STUCK) {
          break
        }
        const job = queue.shift()
        if (job === undefined) {
          break
        }
        step(job, deadline, enqueue)
      }
    } finally {
      slicing = false
      if (queue.has()) {
        schedule()
      }
    }
  }

  function task(work: (turn: Turn) => unknown, opts?: TaskOpts): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const turn = makeTurn(now)
      let gen: unknown
      try {
        gen = work(turn)
      } catch (error) {
        reject(error)
        return
      }
      if (!isGenerator(gen)) {
        reject(new Error('oneturn: task expects a generator'))
        return
      }
      const signal = opts?.signal
      if (signal?.aborted) {
        let cleanup: unknown
        let threw = false
        try {
          gen.return(undefined)
        } catch (error) {
          cleanup = error
          threw = true
        }
        reject(threw ? cleanup : signal.reason)
        return
      }
      enqueue({
        gen,
        turn,
        sent: undefined,
        signal,
        settled: false,
        resolve,
        reject,
      })
    })
  }

  return { task }
}
