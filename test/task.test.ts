import assert from 'node:assert/strict'
import { test } from 'node:test'
import { task } from '../src/index.ts'
import { open } from '../src/slice.ts'
import type { Turn } from '../src/turn.ts'

test('the package exports a task function', () => {
  assert.equal(typeof task, 'function')
})

test('a throw before the generator rejects the promise', async () => {
  const error = new Error('early')
  const loop = open({
    now: () => 0,
    later() {},
    lag: () => 0,
  })
  function work(_turn: Turn): Generator<unknown, unknown, unknown> {
    throw error
  }
  await assert.rejects(loop.task(work), error)
})

test('a non-generator rejects', async () => {
  const loop = open({
    now: () => 0,
    later() {},
    lag: () => 0,
  })
  const result = loop.task(() => undefined)
  await assert.rejects(result, /oneturn: task expects a generator/)
})

test('an already aborted signal rejects before the queue', async () => {
  const error = new Error('stop')
  const controller = new AbortController()
  controller.abort(error)
  const queued: Array<() => void> = []
  let entered = false
  const loop = open({
    now: () => 0,
    later(fn) {
      queued.push(fn)
    },
    lag: () => 0,
  })
  const result = loop.task(
    function* () {
      entered = true
      yield
    },
    { signal: controller.signal },
  )
  await assert.rejects(result, (reason: unknown) => reason === error)
  assert.equal(entered, false)
  assert.equal(queued.length, 0)
})

test('two opens do not run each others jobs', () => {
  const leftQueued: Array<() => void> = []
  const rightQueued: Array<() => void> = []
  const left = open({
    now: () => 0,
    later(fn) {
      leftQueued.push(fn)
    },
    lag: () => 0,
  })
  const right = open({
    now: () => 0,
    later(fn) {
      rightQueued.push(fn)
    },
    lag: () => 0,
  })
  let ran = false
  left.task(function* () {
    ran = true
  })
  const rightFn = rightQueued.shift()
  assert.equal(rightFn, undefined)
  const leftFn = leftQueued.shift()
  if (leftFn === undefined) {
    throw new Error('left was not scheduled')
  }
  leftFn()
  assert.equal(ran, true)
  assert.equal(rightQueued.length, 0)
})
