import assert from 'node:assert/strict'
import { test } from 'node:test'
import { open } from '../src/slice.ts'

type Clock = {
  t: number
}

type Harness = {
  clock: Clock
  queued: Array<() => void>
  loop: ReturnType<typeof open>
  run: () => void
}

function harness(lag = 0): Harness {
  const clock: Clock = { t: 0 }
  const queued: Array<() => void> = []
  const loop = open({
    now: () => clock.t,
    later(fn) {
      queued.push(fn)
    },
    lag: () => lag,
  })
  return {
    clock,
    queued,
    loop,
    run() {
      const fn = queued.shift()
      if (fn === undefined) {
        throw new Error('nothing scheduled')
      }
      fn()
    },
  }
}

test('two tasks share one callback', () => {
  const { loop, queued } = harness()
  loop.task(function* () {
    return 1
  })
  loop.task(function* () {
    return 2
  })
  assert.equal(queued.length, 1)
})

test('a hundred tasks share one callback', () => {
  const { loop, queued } = harness()
  for (let i = 0; i < 100; i++) {
    loop.task(function* () {
      return i
    })
  }
  assert.equal(queued.length, 1)
})

test('the last return does not schedule another callback', async () => {
  const { loop, queued, run } = harness()
  const result = loop.task(function* () {
    return 1
  })
  assert.equal(queued.length, 1)
  run()
  assert.equal(await result, 1)
  assert.equal(queued.length, 0)
})

test('lag 0 runs the step at 4 and the step at 5, then waits', () => {
  const box = harness(0)
  let phase = 0
  box.loop.task(function* () {
    phase = 1
    box.clock.t = 4
    yield
    phase = 2
    box.clock.t = 5
    yield
    phase = 3
    box.clock.t = 6
    yield
  })
  box.run()
  assert.equal(phase, 2)
  assert.equal(box.queued.length, 1)
})

test('lag 21 stops after the clock reaches 1', () => {
  const box = harness(21)
  let steps = 0
  box.loop.task(function* () {
    steps += 1
    box.clock.t = 1
    yield
    steps += 1
    yield
  })
  box.run()
  assert.equal(steps, 1)
})

test('lag 20 keeps the 5ms budget', () => {
  const box = harness(20)
  let phase = 0
  box.loop.task(function* () {
    phase = 1
    box.clock.t = 4
    yield
    phase = 2
    box.clock.t = 5
    yield
    phase = 3
  })
  box.run()
  assert.equal(phase, 2)
})

test('a throw does not drop the next job in the same slice', async () => {
  const { loop, run } = harness()
  let ran = false
  const failed = loop.task(function* () {
    throw new Error('a')
  })
  const ok = loop.task(function* () {
    ran = true
    return 1
  })
  const settled = Promise.allSettled([failed, ok])
  run()
  const [left, right] = await settled
  assert.equal(left.status, 'rejected')
  assert.equal(right.status, 'fulfilled')
  assert.equal(ran, true)
})

test('a step that jumps past the deadline blocks the next job', () => {
  const box = harness()
  let second = false
  box.loop.task(function* () {
    box.clock.t = 100
  })
  box.loop.task(function* () {
    second = true
  })
  box.run()
  assert.equal(second, false)
  assert.equal(box.queued.length, 1)
})

test('a bare yield continues in the same slice', () => {
  const { loop, queued, run } = harness()
  let n = 0
  loop.task(function* () {
    n += 1
    yield
    n += 1
    return n
  })
  assert.equal(queued.length, 1)
  run()
  assert.equal(n, 2)
  assert.equal(queued.length, 0)
})

test('a frozen clock leaves the slice and schedules again', () => {
  const { loop, queued, run } = harness()
  let yields = 0
  loop.task(function* () {
    while (true) {
      yields += 1
      yield
    }
  })
  run()
  assert.equal(yields, 8)
  assert.equal(queued.length, 1)
})

test('a promise yield lets the next job run', async () => {
  const { loop, run } = harness()
  let release: (value: number) => void = () => {}
  const gate = new Promise<number>((resolve) => {
    release = resolve
  })
  let other = false
  const parent = loop.task(function* () {
    return yield gate
  })
  loop.task(function* () {
    other = true
    return 1
  })
  run()
  assert.equal(other, true)
  release(9)
  await Promise.resolve()
  run()
  assert.equal(await parent, 9)
})

test('a nested task finishes and wakes its parent', async () => {
  const { loop, queued, run } = harness()
  const result = loop.task(function* () {
    const child = loop.task(function* () {
      return 4
    })
    return yield child
  })
  assert.equal(queued.length, 1)
  run()
  await Promise.resolve()
  assert.equal(queued.length, 1)
  run()
  assert.equal(await result, 4)
  assert.equal(queued.length, 0)
})

test('two opens do not share a queue', () => {
  const left = harness()
  const right = harness()
  let ran = false
  left.loop.task(function* () {
    ran = true
  })
  assert.equal(left.queued.length, 1)
  assert.equal(right.queued.length, 0)
  left.run()
  assert.equal(ran, true)
  right.loop.task(function* () {
    return 1
  })
  assert.equal(right.queued.length, 1)
  assert.equal(left.queued.length, 0)
})
