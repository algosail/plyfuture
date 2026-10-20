# plyfuture

Lazy, cancellable computations integrated with
[ply](https://github.com/algosail/ply). Inspired by
[Fluture](https://github.com/fluture-js/Fluture).

```ts
import * as P from '@algosail/ply'
import * as F from '@algosail/plyfuture'

const task = P.map((n: number) => n + 1)(F.resolve(41))
await F.promise(task) // 42
```
