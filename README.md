# oneturn

```bash
npm install oneturn
```

https://www.npmjs.com/package/oneturn

cpu work on the main thread has to give the event loop a turn, or timers and sockets sit still. a heartbeat, a health check, the next request.

oneturn keeps one queue for the process and runs it in slices of 5 ms. one `setImmediate`, not one per pause. if the loop is already late by more than 20 ms, the next slice is 1 ms.

```ts
import { task } from 'oneturn'

const rows = [1, 2, 3]

const total = await task(function* (turn) {
  let n = 0
  for (let i = 0; i < rows.length; i++) {
    n += rows[i]
    if ((i & 255) === 0 && turn.due()) yield
  }
  return n
})
```

a bare `yield` does not wait for the next turn of the loop while the 5 ms are still left. the same generator continues.

`await` inside the generator is not a pause. the scheduler cannot see it. outside work is `yield somePromise`. the value you get back is what that promise resolved to.

one synchronous call that runs longer than the budget is not cut in half. `JSON.parse` of a huge string, a heavy regexp, a wasm call: they finish, and only then the loop moves.

checking `due()` on every iteration of a tight loop costs more than the work. a step of 256 is enough.

a cpu quota in kubernetes is a different problem. if the process is not on a core, the slice waits with it.

needs node 26.5 or newer.

```bash
npm test
npm run check
```
