import { open, type TaskOpts } from './slice.ts'
import type { Turn } from './turn.ts'

const main = open()

export function task(work: (turn: Turn) => unknown, opts?: TaskOpts): Promise<unknown> {
  return main.task(work, opts)
}
