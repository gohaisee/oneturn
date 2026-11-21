export type Turn = {
  deadline: number
  due(): boolean
}

export function makeTurn(now: () => number): Turn {
  return {
    deadline: 0,
    due() {
      return now() >= this.deadline
    },
  }
}
