export type Queue<T> = {
  push(item: T): void
  shift(): T | undefined
  has(): boolean
}

export function makeQueue<T>(): Queue<T> {
  const items: T[] = []
  let head = 0
  return {
    push(item) {
      items.push(item)
    },
    shift() {
      if (head >= items.length) {
        return undefined
      }
      const item = items[head]
      head += 1
      if (head === items.length) {
        head = 0
        items.length = 0
      }
      return item
    },
    has() {
      return head < items.length
    },
  }
}
