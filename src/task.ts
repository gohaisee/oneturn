import { open, type TaskOpts } from './slice.ts'
import type { Turn } from './turn.ts'

const main = open()

export function task<T>(
  work: (turn: Turn) => Generator<unknown, T, unknown>,
  opts?: TaskOpts,
): Promise<T> {
  return main.task(work, opts)
}
