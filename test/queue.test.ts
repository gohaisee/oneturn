import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeQueue } from '../src/queue.ts'

test('an empty queue has nothing to shift', () => {
  const queue = makeQueue<number>()
  assert.equal(queue.has(), false)
  assert.equal(queue.shift(), undefined)
})

test('shift returns items in push order', () => {
  const queue = makeQueue<number>()
  queue.push(1)
  queue.push(2)
  queue.push(3)
  assert.equal(queue.shift(), 1)
  assert.equal(queue.shift(), 2)
  assert.equal(queue.shift(), 3)
  assert.equal(queue.has(), false)
  queue.push(4)
  queue.push(5)
  assert.equal(queue.shift(), 4)
  queue.push(6)
  assert.equal(queue.shift(), 5)
  assert.equal(queue.shift(), 6)
})

test('a push after the queue drains is the next shift', () => {
  const queue = makeQueue<number>()
  queue.push(1)
  queue.push(2)
  assert.equal(queue.shift(), 1)
  assert.equal(queue.shift(), 2)
  queue.push(3)
  assert.equal(queue.shift(), 3)
  assert.equal(queue.shift(), undefined)
})

test('a drained object does not come back after the next push', () => {
  const queue = makeQueue<{ id: number }>()
  const first = { id: 1 }
  const second = { id: 2 }
  queue.push(first)
  assert.equal(queue.shift(), first)
  queue.push(second)
  assert.equal(queue.shift(), second)
  assert.equal(queue.shift(), undefined)
})
