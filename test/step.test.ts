import assert from 'node:assert/strict'
import { test } from 'node:test'
import { step, type Job } from '../src/step.ts'
import { makeTurn } from '../src/turn.ts'

type Box = {
  value: unknown
  reason: unknown
  settles: number
  resumed: number
}

function makeJob(gen: Generator<unknown, unknown, unknown>, signal?: AbortSignal): { job: Job; box: Box } {
  const box: Box = { value: undefined, reason: undefined, settles: 0, resumed: 0 }
  const job: Job = {
    gen,
    turn: makeTurn(() => 0),
    sent: undefined,
    signal,
    settled: false,
    resolve(value) {
      box.settles += 1
      box.value = value
    },
    reject(reason) {
      box.settles += 1
      box.reason = reason
    },
  }
  return { job, box }
}

function resume(box: Box): (job: Job) => void {
  return () => {
    box.resumed += 1
  }
}

test('a bare yield resumes once and does not settle', () => {
  const { job, box } = makeJob(
    (function* () {
      yield
    })(),
  )
  step(job, 5, resume(box))
  assert.equal(box.resumed, 1)
  assert.equal(box.settles, 0)
  assert.equal(job.settled, false)
})

test('return resolves the value and does not resume', () => {
  const { job, box } = makeJob(
    (function* () {
      return 7
    })(),
  )
  step(job, 5, resume(box))
  assert.equal(box.value, 7)
  assert.equal(box.settles, 1)
  assert.equal(box.resumed, 0)
})

test('a throw rejects and does not resume', () => {
  const error = new Error('boom')
  const { job, box } = makeJob(
    (function* () {
      throw error
    })(),
  )
  step(job, 5, resume(box))
  assert.equal(box.reason, error)
  assert.equal(box.resumed, 0)
})

test('yielding a number resumes like a bare yield', () => {
  const { job, box } = makeJob(
    (function* () {
      yield 4
    })(),
  )
  step(job, 5, resume(box))
  assert.equal(box.resumed, 1)
  assert.equal(box.settles, 0)
})

test('yielding a plain object resumes like a bare yield', () => {
  const { job, box } = makeJob(
    (function* () {
      yield { id: 1 }
    })(),
  )
  step(job, 5, resume(box))
  assert.equal(box.resumed, 1)
  assert.equal(box.settles, 0)
})

test('a resolved promise resumes later with the value', async () => {
  const { job, box } = makeJob(
    (function* () {
      yield Promise.resolve(3)
    })(),
  )
  step(job, 5, resume(box))
  assert.equal(box.resumed, 0)
  await Promise.resolve()
  assert.equal(box.resumed, 1)
  assert.equal(job.sent, 3)
  assert.equal(box.settles, 0)
})

test('a rejected promise rejects the job', async () => {
  const error = new Error('no')
  const { job, box } = makeJob(
    (function* () {
      yield Promise.reject(error)
    })(),
  )
  step(job, 5, resume(box))
  await Promise.resolve()
  assert.equal(box.reason, error)
  assert.equal(box.resumed, 0)
  assert.equal(box.settles, 1)
})

test('a throwing then getter rejects the job', () => {
  const error = new Error('getter')
  const { job, box } = makeJob(
    (function* () {
      yield {
        get then() {
          throw error
        },
      }
    })(),
  )
  step(job, 5, resume(box))
  assert.equal(box.reason, error)
  assert.equal(box.resumed, 0)
  assert.equal(box.settles, 1)
})

test('a thenable that throws rejects the job', () => {
  const error = new Error('then')
  const { job, box } = makeJob(
    (function* () {
      yield {
        then() {
          throw error
        },
      }
    })(),
  )
  step(job, 5, resume(box))
  assert.equal(box.reason, error)
  assert.equal(box.resumed, 0)
})

test('an aborted signal before the first step does not run the generator', () => {
  const error = new Error('stop')
  const controller = new AbortController()
  controller.abort(error)
  let entered = false
  const { job, box } = makeJob(
    (function* () {
      entered = true
      yield
    })(),
    controller.signal,
  )
  step(job, 5, resume(box))
  assert.equal(entered, false)
  assert.equal(box.reason, error)
  assert.equal(box.resumed, 0)
  assert.equal(job.gen.next().done, true)
})

test('abort before the next step runs finally and skips the rest', () => {
  const error = new Error('stop')
  const controller = new AbortController()
  let after = false
  let cleaned = false
  const { job, box } = makeJob(
    (function* () {
      try {
        yield
        after = true
      } finally {
        cleaned = true
      }
    })(),
    controller.signal,
  )
  step(job, 5, resume(box))
  controller.abort(error)
  step(job, 5, resume(box))
  assert.equal(after, false)
  assert.equal(cleaned, true)
  assert.equal(box.reason, error)
  assert.equal(box.resumed, 1)
})

test('a throw from finally replaces the abort reason', () => {
  const stop = new Error('stop')
  const cleanup = new Error('cleanup')
  const controller = new AbortController()
  const { job, box } = makeJob(
    (function* () {
      try {
        yield
      } finally {
        throw cleanup
      }
    })(),
    controller.signal,
  )
  step(job, 5, resume(box))
  controller.abort(stop)
  step(job, 5, resume(box))
  assert.equal(box.reason, cleanup)
  assert.equal(box.settles, 1)
})

test('abort during a hanging promise rejects once', async () => {
  const error = new Error('stop')
  const controller = new AbortController()
  let cleaned = false
  let resolveHang: (value: number) => void = () => {}
  const hanging = new Promise<number>((resolve) => {
    resolveHang = resolve
  })
  const { job, box } = makeJob(
    (function* () {
      try {
        yield hanging
      } finally {
        cleaned = true
      }
    })(),
    controller.signal,
  )
  step(job, 5, resume(box))
  controller.abort(error)
  assert.equal(cleaned, true)
  assert.equal(box.reason, error)
  assert.equal(box.settles, 1)
  resolveHang(1)
  await Promise.resolve()
  assert.equal(box.resumed, 0)
  assert.equal(box.settles, 1)
})

test('a second step after settle does nothing', () => {
  const { job, box } = makeJob(
    (function* () {
      return 1
    })(),
  )
  step(job, 5, resume(box))
  step(job, 9, resume(box))
  assert.equal(box.settles, 1)
  assert.equal(box.value, 1)
  assert.equal(box.resumed, 0)
})

test('two jobs keep their own turns', () => {
  const left = makeJob(
    (function* () {
      yield
    })(),
  )
  const right = makeJob(
    (function* () {
      yield
    })(),
  )
  step(left.job, 4, resume(left.box))
  step(right.job, 9, resume(right.box))
  assert.equal(left.job.turn.deadline, 4)
  assert.equal(right.job.turn.deadline, 9)
})
