import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeTurn } from '../src/turn.ts'

test('due is false before the deadline', () => {
  const turn = makeTurn(() => 4)
  turn.deadline = 5
  assert.equal(turn.due(), false)
})

test('due is true at the deadline', () => {
  const turn = makeTurn(() => 5)
  turn.deadline = 5
  assert.equal(turn.due(), true)
})

test('due is true after the deadline', () => {
  const turn = makeTurn(() => 6)
  turn.deadline = 5
  assert.equal(turn.due(), true)
})

test('two turns do not share a deadline', () => {
  let now = 3
  const left = makeTurn(() => now)
  const right = makeTurn(() => now)
  left.deadline = 5
  right.deadline = 2
  assert.equal(left.due(), false)
  assert.equal(right.due(), true)
  left.deadline = 1
  assert.equal(left.deadline, 1)
  assert.equal(right.deadline, 2)
  assert.equal(left.due(), true)
  assert.equal(right.due(), true)
  now = 0
  assert.equal(left.due(), false)
})
