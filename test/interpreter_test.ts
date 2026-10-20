import * as P from '@algosail/ply'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as F from '../src/mod.ts'

function controlled<E, A>() {
  const runs: {
    reject: (e: E) => void
    resolve: (a: A) => void
    cancellations: number
  }[] = []
  const future = F.future<E, A> ((reject, resolve) => {
    const run = { reject, resolve, cancellations: 0 }
    runs.push (run)
    return () => {
      run.cancellations++
    }
  })
  return { future, runs }
}

function observe<E, A>(future: F.Future<E, A>) {
  const events: { tag: string; value: unknown }[] = []
  const cancel = F.forkCatch ((value) => {
    events.push ({ tag: 'crash', value })
  }) (
    (value: E) => {
      events.push ({ tag: 'reject', value })
    },
  ) ((value: A) => {
    events.push ({ tag: 'resolve', value })
  }) (future)
  return { events, cancel }
}

test ('interpreter: 100000 maps execute synchronously and can be forked twice', () => {
  let task = F.resolve<never, number> (0)
  for (let i = 0; i < 100000; i++) task = task.map ((n) => n + 1)
  assert.deepStrictEqual (observe (task).events, [{ tag: 'resolve', value: 100000 }])
  assert.deepStrictEqual (observe (task).events, [{ tag: 'resolve', value: 100000 }])
})

test ('interpreter: recursive chain flattens returned transformations', () => {
  const loop = (n: number): F.Future<never, number> =>
    n === 100000 ? F.resolve (n) : F.resolve<never, number> (n + 1).chain (loop)
  assert.deepStrictEqual (observe (loop (0)).events, [{ tag: 'resolve', value: 100000 }])
})

test ('interpreter: 100000 rejected transformations preserve order', () => {
  let task = F.reject<number, never> (0)
  for (let i = 0; i < 100000; i++) task = F.mapRej ((n: number) => n + 1) (task)
  assert.deepStrictEqual (observe (task).events, [{ tag: 'reject', value: 100000 }])
})

test ('interpreter: branches share immutable transformations and independent runs', () => {
  const source = controlled<string, number> ()
  const base = source.future.map ((n) => n + 1)
  const left = observe (base.map ((n) => n * 2))
  const right = observe (base.chain ((n) => F.resolve (n * 3)))
  source.runs[1].resolve (2)
  source.runs[0].resolve (5)
  assert.deepStrictEqual (left.events, [{ tag: 'resolve', value: 12 }])
  assert.deepStrictEqual (right.events, [{ tag: 'resolve', value: 9 }])
})

test ('interpreter: 10000 nested concurrent and cached computations are stack safe', () => {
  let task = F.resolve<string, number> (1)
  for (let i = 0; i < 10000; i++) {
    task = F.cache (
      F.both (F.resolve<string, number> (1)) (task).map ((p) =>
        P.toTuple (p)[1] + 1,
      ),
    )
  }
  assert.deepStrictEqual (observe (task).events, [{ tag: 'resolve', value: 10001 }])
})

test ('ply.chainRec: lazy, stack safe and preserves inferred result types', async () => {
  let starts = 0
  const step = (n: number): F.Future<string, P.Step<number, number>> => {
    starts++
    return F.resolve (n < 100000 ? P.loop (n + 1) : P.done (n))
  }
  const task: F.Future<string, number> = P.chainRec (F.Future, step, 0)
  assert.deepStrictEqual (starts, 0)
  assert.deepStrictEqual (await F.promise (task), 100000)
  assert.deepStrictEqual (starts, 100001)
})

test ('cancel: idempotent and suppresses every late outcome and transformation', () => {
  const source = controlled<string, number> ()
  let mapped = 0
  const result = observe (source.future.map ((n) => {
    mapped++
    return n
  }))
  result.cancel ()
  result.cancel ()
  source.runs[0].resolve (1)
  source.runs[0].reject ('late')
  assert.deepStrictEqual (source.runs[0].cancellations, 1)
  assert.deepStrictEqual (mapped, 0)
  assert.deepStrictEqual (result.events, [])
})

test ('cancel: reaches only the active chain step', () => {
  const a = controlled<string, number> (), b = controlled<string, number> ()
  const result = observe (a.future.chain (() => b.future))
  a.runs[0].resolve (1)
  result.cancel ()
  b.runs[0].resolve (2)
  assert.deepStrictEqual (a.runs[0].cancellations, 0)
  assert.deepStrictEqual (b.runs[0].cancellations, 1)
  assert.deepStrictEqual (result.events, [])
})

test ('cancel: handles reentrant cancellation before the next executor returns', () => {
  const source = controlled<string, number> ()
  let cleaned = 0
  const result = observe (
    source.future.chain (() =>
      F.future<string, number> (() => {
        result.cancel ()
        return () => {
          cleaned++
        }
      }),
    ),
  )
  source.runs[0].resolve (1)
  assert.deepStrictEqual (cleaned, 1)
  assert.deepStrictEqual (result.events, [])
})

test ('cancel: finished runs do not invoke source cancellation', () => {
  let cancelled = 0
  const result = observe (F.future<never, number> ((_, resolve) => {
    resolve (1)
    return () => {
      cancelled++
    }
  }))
  result.cancel ()
  assert.deepStrictEqual (cancelled, 0)
  assert.deepStrictEqual (result.events, [{ tag: 'resolve', value: 1 }])
})

test ('cancel: timers are released immediately', () => {
  observe (F.after (60000) (1)).cancel ()
  observe (F.rejectAfter (60000) ('late')).cancel ()
})

test ('cancel: Promise results and errors are ignored after unsubscribe', async () => {
  const success = Promise.withResolvers<number> ()
  const failure = Promise.withResolvers<number> ()
  const a = observe (F.attemptP (() => success.promise)),
    b = observe (F.attemptP (() => failure.promise))
  a.cancel ()
  b.cancel ()
  success.resolve (1)
  failure.reject ('late')
  await Promise.allSettled ([success.promise, failure.promise])
  assert.deepStrictEqual (a.events, [])
  assert.deepStrictEqual (b.events, [])
})

test ('ap: agrees with chain plus map in start order and failure short circuit', () => {
  for (const fails of [false, true]) {
    const run = (viaChain: boolean) => {
      const events: string[] = []
      const ff = F.future<string, (n: number) => number> ((reject, resolve) => {
        events.push ('function')
        if (fails) reject ('failure')
        else resolve ((n) => n + 1)
      })
      const fa = F.future<string, number> ((_, resolve) => {
        events.push ('value')
        resolve (2)
      })
      const result = observe (
        viaChain ? ff.chain ((f) => fa.map (f)) : P.ap (ff) (fa),
      )
      return { events, outcomes: result.events }
    }
    assert.deepStrictEqual (run (false), run (true))
    assert.deepStrictEqual (
      run (false).events,
      fails ? ['function'] : ['function', 'value'],
    )
  }
})

test ('pap: starts independent tasks concurrently and cancels on rejection', () => {
  const fa = controlled<string, number> (),
    ff = controlled<string, (a: number) => number> ()
  const result = observe (F.pap (fa.future) (ff.future))
  assert.deepStrictEqual ([fa.runs.length, ff.runs.length], [1, 1])
  fa.runs[0].reject ('failed')
  assert.deepStrictEqual (ff.runs[0].cancellations, 1)
  assert.deepStrictEqual (result.events, [{ tag: 'reject', value: 'failed' }])
})

test ('pap: applies its function only after both results, in either order', () => {
  for (const functionFirst of [false, true]) {
    const fa = controlled<string, number> (),
      ff = controlled<string, (a: number) => number> ()
    const result = observe (F.pap (fa.future) (ff.future))
    const functionReady = () => ff.runs[0].resolve ((n) => n + 4)
    const valueReady = () => fa.runs[0].resolve (2)
    ;(functionFirst ? functionReady : valueReady) ()
    assert.deepStrictEqual (result.events, [])
    ;(functionFirst ? valueReady : functionReady) ()
    assert.deepStrictEqual (result.events, [{ tag: 'resolve', value: 6 }])
  }
})

test ('ConcurrentFuture: ply of, map, ap, alt, zero and is preserve the parallel type', async () => {
  const a = controlled<string, number> (),
    f = controlled<string, (n: number) => number> ()
  const wrapped: F.ConcurrentFuture<string, number> = P.ap (F.Par (f.future)) (
    F.Par (a.future),
  )
  const result = observe (F.seq (wrapped))
  assert.deepStrictEqual ([a.runs.length, f.runs.length], [1, 1])
  f.runs[0].resolve ((n) => n + 1)
  a.runs[0].resolve (2)
  assert.deepStrictEqual (result.events, [{ tag: 'resolve', value: 3 }])
  assert.deepStrictEqual (
    await F.promise (F.seq (P.map ((n: number) => n * 2) (P.of (F.Par) (3)))),
    6,
  )
  assert.deepStrictEqual (
    await F.promise (F.seq (P.alt (F.Par (F.resolve (4))) (P.zero (F.Par)))),
    4,
  )
  assert.deepStrictEqual (P.is (F.ConcurrentFuture) (wrapped), true)
  assert.deepStrictEqual (P.is (F.Par) (wrapped), true)
  assert.deepStrictEqual ('chain' in wrapped, false)
  assert.deepStrictEqual (P.show (wrapped), 'ConcurrentFuture')
})

test ('race: synchronous completion skips unnecessary work, including transformed sources', () => {
  let starts = 0
  const spare = F.future<string, number> (() => {
    starts++
  })
  assert.deepStrictEqual (
    observe (F.race (F.resolve<string, number> (1).map ((n) => n + 1)) (spare))
      .events,
    [{ tag: 'resolve', value: 2 }],
  )
  assert.deepStrictEqual (starts, 0)
})

test ('race: cancelling or settling cancels pending competitors exactly once', () => {
  const a = controlled<string, number> (), b = controlled<string, number> ()
  const result = observe (F.race (a.future) (b.future))
  a.runs[0].resolve (1)
  result.cancel ()
  assert.deepStrictEqual ([a.runs[0].cancellations, b.runs[0].cancellations], [0, 1])
  const other = observe (F.race (a.future) (b.future))
  other.cancel ()
  assert.deepStrictEqual ([a.runs[1].cancellations, b.runs[1].cancellations], [1, 1])
})

test ('parallel: rejection cancels active tasks before notifying its observer', () => {
  const a = controlled<string, number> (),
    b = controlled<string, number> (),
    c = controlled<string, number> ()
  let cancelledAtNotification = 0
  F.parallel (2) ([a.future, b.future, c.future]).fork (() => {
    cancelledAtNotification = a.runs[0].cancellations
  }, () => {})
  b.runs[0].reject ('stop')
  assert.deepStrictEqual (cancelledAtNotification, 1)
  assert.deepStrictEqual (c.runs.length, 0)
})

test ('parallel: crash stops the queue and cancels siblings', () => {
  const a = controlled<string, number> (),
    b = controlled<string, number> (),
    c = controlled<string, number> ()
  const error = new Error ('broken mapper')
  const result = observe (
    F.parallel (2) ([
      a.future,
      b.future.map (() => {
        throw error
      }),
      c.future,
    ]),
  )
  b.runs[0].resolve (1)
  assert.deepStrictEqual (a.runs[0].cancellations, 1)
  assert.deepStrictEqual (c.runs.length, 0)
  assert.deepStrictEqual (result.events, [{ tag: 'crash', value: error }])
})

test ('parallel: synchronous crash does not start the next task', () => {
  const next = controlled<string, number> ()
  const broken = F.resolve<string, number> (1).map (() => {
    throw 'broken'
  })
  assert.deepStrictEqual (observe (F.parallel (2) ([broken, next.future])).events, [{
    tag: 'crash',
    value: 'broken',
  }])
  assert.deepStrictEqual (next.runs.length, 0)
})

test ('parallel: 100000 synchronous tasks respect order without recursion', () => {
  const tasks = Array.from ({ length: 100000 }, (_, i) => F.resolve (i))
  const result = observe (F.parallel (1) (tasks))
  assert.deepStrictEqual (result.events, [{
    tag: 'resolve',
    value: Array.from ({ length: 100000 }, (_, i) => i),
  }])
})

test ('parallel: cancellation clears deep compositions without recursive cancellation', () => {
  const source = controlled<string, number> ()
  let task = source.future
  for (let i = 0; i < 10000; i++) task = F.race (task) (F.never)
  const result = observe (task)
  result.cancel ()
  assert.deepStrictEqual (source.runs[0].cancellations, 1)
  assert.deepStrictEqual (result.events, [])
})

test ('cache: subscriptions cancel independently; the last one cancels and resets the run', () => {
  const source = controlled<string, number> ()
  const cached = F.cache (source.future)
  const a = observe (cached), b = observe (cached)
  assert.deepStrictEqual (source.runs.length, 1)
  a.cancel ()
  assert.deepStrictEqual (source.runs[0].cancellations, 0)
  b.cancel ()
  assert.deepStrictEqual (source.runs[0].cancellations, 1)
  const c = observe (cached)
  assert.deepStrictEqual (source.runs.length, 2)
  source.runs[0].resolve (99)
  source.runs[1].resolve (2)
  assert.deepStrictEqual ([a.events, b.events], [[], []])
  assert.deepStrictEqual (c.events, [{ tag: 'resolve', value: 2 }])
  assert.deepStrictEqual (observe (cached).events, c.events)
})

test ('hook: releases once after success, rejection, crash and a throwing consumer factory', () => {
  for (const mode of ['resolve', 'reject', 'crash', 'throw'] as const) {
    const events: string[] = []
    const error = new Error ('consumer')
    const task = F.hook (F.resolve<string, number> (3)) (
      (r) =>
        F.future<never, void> ((_, resolve) => {
          events.push (`dispose ${r}`)
          resolve ()
        }),
    ) (() => {
      events.push ('consume')
      if (mode === 'throw') throw error
      if (mode === 'reject') return F.reject<string, number> ('failure')
      if (mode === 'crash') {
        return F.resolve<string, number> (0).map (() => {
          throw error
        })
      }
      return F.resolve<string, number> (4)
    })
    const result = observe (task)
    assert.deepStrictEqual (events, ['consume', 'dispose 3'])
    assert.deepStrictEqual (result.events, [{
      tag: mode === 'throw' ? 'crash' : mode,
      value: mode === 'resolve' ? 4 : mode === 'reject' ? 'failure' : error,
    }])
  }
})

test ('hook: acquisition failure or cancellation never consumes or disposes', () => {
  const source = controlled<string, number> ()
  let calls = 0
  const task = F.hook (source.future) (() => {
    calls++
    return F.resolve (undefined)
  }) (() => {
    calls++
    return F.resolve (1)
  })
  const first = observe (task)
  first.cancel ()
  source.runs[0].resolve (1)
  const second = observe (task)
  source.runs[1].reject ('acquire failed')
  assert.deepStrictEqual (calls, 0)
  assert.deepStrictEqual (source.runs[0].cancellations, 1)
  assert.deepStrictEqual (second.events, [{ tag: 'reject', value: 'acquire failed' }])
})

test ('hook: cancellation stops consumption and lets asynchronous disposal finish', () => {
  const consume = controlled<string, number> (),
    dispose = controlled<never, void> ()
  const result = observe (
    F.hook (F.resolve (1)) (() => dispose.future) (() => consume.future),
  )
  result.cancel ()
  result.cancel ()
  assert.deepStrictEqual (consume.runs[0].cancellations, 1)
  assert.deepStrictEqual (dispose.runs.length, 1)
  assert.deepStrictEqual (dispose.runs[0].cancellations, 0)
  dispose.runs[0].resolve ()
  assert.deepStrictEqual (result.events, [])
})

test ('hook: cancellation during disposal does not interrupt disposal', () => {
  const dispose = controlled<never, void> ()
  const result = observe (
    F.hook (F.resolve (1)) (() => dispose.future) (() => F.resolve (2)),
  )
  result.cancel ()
  assert.deepStrictEqual (dispose.runs[0].cancellations, 0)
  dispose.runs[0].resolve ()
  assert.deepStrictEqual (result.events, [])
})

test ('hook: a disposal rejection is a crash with the original reason', () => {
  const reason = { code: 'cannot close' }
  const result = observe (
    F.hook (F.resolve (1)) (() => F.reject (reason)) (() => F.resolve (2)),
  )
  assert.deepStrictEqual (result.events.length, 1)
  assert.deepStrictEqual (result.events[0].tag, 'crash')
  assert.deepStrictEqual ((result.events[0].value as Error).cause, reason)
})

test ('lastly: cleanup errors are reflected in the result type', () => {
  const cleanup = F.reject<number, void> (42)
  const task: F.Future<string | number, string> = F.lastly (cleanup) (
    F.resolve<string, string> ('ok'),
  )
  assert.deepStrictEqual (observe (task).events, [{ tag: 'reject', value: 42 }])
  // @ts-expect-error Cleanup can reject with a number.
  const invalid: F.Future<string, string> = F.lastly (cleanup) (
    F.resolve<string, string> ('ok'),
  )
  void invalid
})

test ('validation: invalid callbacks fail at composition and invalid chain results crash', () => {
  assert.throws (
    () => F.resolve (1).map (null as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('map'),
  )
  assert.throws (
    () => F.future (null as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('future'),
  )
  assert.throws (
    () => F.parallel (2) ([null as never]),
    (error: unknown) => error instanceof TypeError && error.message.includes ('parallel'),
  )
  assert.throws (
    () => F.race (null as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('race'),
  )
  const result = observe (F.resolve (1).chain (() => 3 as never))
  assert.deepStrictEqual (result.events[0].tag, 'crash')
  assert.deepStrictEqual (
    String (result.events[0].value),
    'TypeError: chain: expected a Future from the handler',
  )
  assert.deepStrictEqual (observe (F.attemptP (() => 2 as never)).events[0].tag, 'crash')
  assert.deepStrictEqual (observe (F.future (() => 2 as never)).events[0].tag, 'crash')
})

test ('interpreter: user callbacks are called without a receiver', () => {
  const receivers: unknown[] = []
  const f = function(this: unknown, n: number) {
    receivers.push (this)
    return n + 1
  }
  const task = F.future<string, number> (function(this: unknown, _, resolve) {
    receivers.push (this)
    resolve (1)
  }).map (f).chain (function(this: unknown, n) {
    receivers.push (this)
    return F.resolve (n)
  })
  assert.deepStrictEqual (observe (task).events, [{ tag: 'resolve', value: 2 }])
  assert.deepStrictEqual (receivers, [undefined, undefined, undefined])
})

test ('description: transformations can be inspected without running effects', () => {
  let runs = 0
  const task = F.future<string, number> (() => {
    runs++
  }).map ((n) => n + 1).chain ((n) => F.resolve (n))
  assert.deepStrictEqual (String (task), 'future → map → chain')
  assert.deepStrictEqual (P.show (task), 'Future')
  assert.deepStrictEqual (runs, 0)
})

test ('cancel: chainRec cancellation stops before another iteration', () => {
  const step = controlled<string, P.Step<number, number>> ()
  let calls = 0
  const task = F.Future.chainRec ((_: number) => {
    calls++
    return step.future
  }, 0)
  const result = observe (task)
  step.runs[0].resolve (P.loop (1))
  result.cancel ()
  step.runs[1].resolve (P.loop (2))
  assert.deepStrictEqual (calls, 2)
  assert.deepStrictEqual (step.runs[1].cancellations, 1)
  assert.deepStrictEqual (result.events, [])
})

test ('both: a crash cancels its other branch', () => {
  const a = controlled<string, number> (), b = controlled<string, number> ()
  const result = observe (
    F.both (a.future) (b.future.map (() => {
      throw 'failed'
    })),
  )
  b.runs[0].resolve (2)
  assert.deepStrictEqual (a.runs[0].cancellations, 1)
  assert.deepStrictEqual (result.events, [{ tag: 'crash', value: 'failed' }])
})

test ('parallel: input is snapshotted when composed', () => {
  const inputs = [F.resolve (1), F.resolve (2)]
  const task = F.parallel (1) (inputs)
  inputs[1] = F.resolve (99)
  assert.deepStrictEqual (observe (task).events, [{ tag: 'resolve', value: [1, 2] }])
})

test ('cache: cancellation of one subscriber preserves the others and cached rejection', () => {
  const source = controlled<string, number> ()
  const cached = F.cache (source.future)
  const a = observe (cached), b = observe (cached)
  a.cancel ()
  source.runs[0].reject ('failed')
  assert.deepStrictEqual (a.events, [])
  assert.deepStrictEqual (b.events, [{ tag: 'reject', value: 'failed' }])
  assert.deepStrictEqual (observe (cached).events, b.events)
  assert.deepStrictEqual (source.runs[0].cancellations, 0)
})

test ('hook: invalid consumer and disposal results crash without leaking resources', () => {
  let disposed = 0
  const invalidConsumer = F.hook (F.resolve (1)) (() => {
    disposed++
    return F.resolve (undefined)
  }) (() => 3 as never)
  assert.deepStrictEqual (observe (invalidConsumer).events[0].tag, 'crash')
  assert.deepStrictEqual (disposed, 1)
  const invalidDisposal = F.hook (F.resolve (1)) (() => 3 as never) (() =>
    F.resolve (2),
  )
  assert.deepStrictEqual (observe (invalidDisposal).events[0].tag, 'crash')
})

test ('hook: a failing parallel sibling cancels consumption but not disposal', () => {
  const use = controlled<string, number> (),
    cleanup = controlled<never, void> (),
    other = controlled<string, number> ()
  const hooked = F.hook (F.resolve (1)) (() => cleanup.future) (() => use.future)
  const result = observe (F.parallel (2) ([hooked, other.future]))
  other.runs[0].reject ('stop')
  assert.deepStrictEqual (use.runs[0].cancellations, 1)
  assert.deepStrictEqual (cleanup.runs.length, 1)
  assert.deepStrictEqual (cleanup.runs[0].cancellations, 0)
  cleanup.runs[0].resolve ()
  assert.deepStrictEqual (result.events, [{ tag: 'reject', value: 'stop' }])
})

test ('hook: awaits disposal before forwarding the consumer outcome', () => {
  const cleanup = controlled<never, void> ()
  const result = observe (
    F.hook (F.resolve (1)) (() => cleanup.future) (() => F.reject ('failed')),
  )
  assert.deepStrictEqual (result.events, [])
  cleanup.runs[0].resolve ()
  assert.deepStrictEqual (result.events, [{ tag: 'reject', value: 'failed' }])
})

test ('hook: a throwing disposer is reported through the crash channel', () => {
  const error = new Error ('dispose failed')
  const result = observe (
    F.hook (F.resolve (1)) (() => {
      throw error
    }) (() => F.resolve (2)),
  )
  assert.deepStrictEqual (result.events, [{ tag: 'crash', value: error }])
})

test ('observer errors: Promise callbacks do not swallow errors or turn them into task rejections', async () => {
  const errors: unknown[] = []
  process.setUncaughtExceptionCaptureCallback ((error) => {
    errors.push (error)
  })
  try {
    let rejected = 0
    const error = new Error ('observer failed')
    F.attemptP (() => Promise.resolve (1)).fork (() => {
      rejected++
    }, () => {
      throw error
    })
    await new Promise ((resolve) => setTimeout (resolve, 10))
    assert.deepStrictEqual (errors, [error])
    assert.deepStrictEqual (rejected, 0)
  } finally {
    process.setUncaughtExceptionCaptureCallback (null)
  }
})

test ('cache: a throwing observer does not prevent other subscribers receiving the result', async () => {
  const errors: unknown[] = []
  process.setUncaughtExceptionCaptureCallback ((error) => {
    errors.push (error)
  })
  try {
    const source = controlled<string, number> ()
    const cached = F.cache (source.future)
    const error = new Error ('observer failed')
    cached.fork (() => {}, () => {
      throw error
    })
    const other = observe (cached)
    source.runs[0].resolve (2)
    await new Promise ((resolve) => setTimeout (resolve, 10))
    assert.deepStrictEqual (other.events, [{ tag: 'resolve', value: 2 }])
    assert.deepStrictEqual (errors, [error])
  } finally {
    process.setUncaughtExceptionCaptureCallback (null)
  }
})

test ('cache: cancelling the last subscriber from inside the source cancels it', async () => {
  let cleaned = 0
  let allow = false
  const cancel = { run: (): void => {} }
  const cached = F.cache (F.future<string, number> ((_, resolve) => {
    queueMicrotask (() => {
      if (!allow) cancel.run ()
      else resolve (3)
    })
    return () => {
      cleaned++
    }
  }))
  const first = observe (cached)
  cancel.run = first.cancel
  await new Promise ((resolve) => setTimeout (resolve, 0))
  assert.deepStrictEqual (cleaned, 1)
  assert.deepStrictEqual (first.events, [])
  allow = true
  const second = observe (cached)
  await new Promise ((resolve) => setTimeout (resolve, 0))
  assert.deepStrictEqual (second.events, [{ tag: 'resolve', value: 3 }])
  assert.deepStrictEqual (cleaned, 1)
})

test ('cache: cancelling the last subscriber inside map drops that run', () => {
  const source = controlled<string, number> ()
  let cancelNext = true
  const cancel = { run: (): void => {} }
  const cached = F.cache (source.future.map (() => {
    if (cancelNext) {
      cancelNext = false
      cancel.run ()
    }
    return 2
  }))
  const first = observe (cached)
  cancel.run = first.cancel
  source.runs[0].resolve (1)
  assert.deepStrictEqual (first.events, [])
  assert.deepStrictEqual (source.runs[0].cancellations, 0)
  const second = observe (cached)
  assert.deepStrictEqual (source.runs.length, 2)
  source.runs[1].resolve (1)
  assert.deepStrictEqual (second.events, [{ tag: 'resolve', value: 2 }])
  assert.deepStrictEqual (observe (cached).events, second.events)
})

test ('cache: cancelling one of two subscribers inside map keeps the run', () => {
  const source = controlled<string, number> ()
  const cancel = { run: (): void => {} }
  const cached = F.cache (source.future.map ((n) => {
    cancel.run ()
    return n + 1
  }))
  const first = observe (cached)
  cancel.run = first.cancel
  const second = observe (cached)
  source.runs[0].resolve (1)
  assert.deepStrictEqual (first.events, [])
  assert.deepStrictEqual (second.events, [{ tag: 'resolve', value: 2 }])
  assert.deepStrictEqual (source.runs.length, 1)
  assert.deepStrictEqual (source.runs[0].cancellations, 0)
})

test ('cache: cancelling the last subscriber inside chain does not run the next task', () => {
  const source = controlled<string, number> ()
  const next = controlled<string, number> ()
  const cancel = { run: (): void => {} }
  const cached = F.cache (source.future.chain (() => {
    cancel.run ()
    return next.future
  }))
  const first = observe (cached)
  cancel.run = first.cancel
  source.runs[0].resolve (1)
  assert.deepStrictEqual (next.runs.length, 0)
  assert.deepStrictEqual (first.events, [])
  assert.deepStrictEqual (source.runs[0].cancellations, 0)
  const second = observe (cached)
  assert.deepStrictEqual (source.runs.length, 2)
  source.runs[1].resolve (1)
  next.runs[0].resolve (5)
  assert.deepStrictEqual (second.events, [{ tag: 'resolve', value: 5 }])
})

test ('cache: a crash inside the last subscriber is not replayed', () => {
  const source = controlled<string, number> ()
  const error = new Error ('dropped')
  const cancel = { run: (): void => {} }
  const cached = F.cache (source.future.map (() => {
    cancel.run ()
    throw error
  }))
  const first = observe (cached)
  cancel.run = first.cancel
  source.runs[0].resolve (1)
  assert.deepStrictEqual (first.events, [])
  const second = observe (cached)
  assert.deepStrictEqual (source.runs.length, 2)
  source.runs[1].resolve (4)
  assert.deepStrictEqual (second.events, [{ tag: 'crash', value: error }])
})

test ('hook: cancelling inside consume does not run that consumption', () => {
  const acquire = controlled<string, number> ()
  const consume = controlled<string, number> ()
  const events: string[] = []
  const cancel = { run: (): void => {} }
  const task = F.hook (acquire.future) (() =>
    F.future<never, void> ((_, resolve) => {
      events.push ('dispose')
      resolve ()
    }),
  ) (() => {
    events.push ('consume')
    cancel.run ()
    return consume.future
  })
  const result = observe (task)
  cancel.run = result.cancel
  acquire.runs[0].resolve (1)
  assert.deepStrictEqual (events, ['consume', 'dispose'])
  assert.deepStrictEqual (consume.runs.length, 0)
  assert.deepStrictEqual (result.events, [])
})

test ('hook: a throw after cancelling inside consume is reported and disposed', async () => {
  const errors: unknown[] = []
  process.setUncaughtExceptionCaptureCallback ((error) => {
    errors.push (error)
  })
  try {
    const acquire = controlled<string, number> ()
    const error = new Error ('consume failed')
    const events: string[] = []
    const cancel = { run: (): void => {} }
    const task = F.hook (acquire.future) (() =>
      F.future<never, void> ((_, resolve) => {
        events.push ('dispose')
        resolve ()
      }),
    ) (() => {
      cancel.run ()
      throw error
    })
    const result = observe (task)
    cancel.run = result.cancel
    acquire.runs[0].resolve (1)
    await new Promise ((resolve) => setTimeout (resolve, 10))
    assert.deepStrictEqual (events, ['dispose'])
    assert.deepStrictEqual (result.events, [])
    assert.deepStrictEqual (errors, [error])
  } finally {
    process.setUncaughtExceptionCaptureCallback (null)
  }
})

test ('hook: disposal failure after cancelling inside dispose is reported', async () => {
  const errors: unknown[] = []
  process.setUncaughtExceptionCaptureCallback ((error) => {
    errors.push (error)
  })
  try {
    const consume = controlled<string, number> ()
    const reason = { code: 'cannot close' }
    const cancel = { run: (): void => {} }
    const task = F.hook (F.resolve (1)) (() => {
      cancel.run ()
      return F.reject (reason)
    }) (() => consume.future)
    const result = observe (task)
    cancel.run = result.cancel
    consume.runs[0].resolve (1)
    await new Promise ((resolve) => setTimeout (resolve, 10))
    assert.deepStrictEqual (result.events, [])
    assert.deepStrictEqual (errors.length, 1)
    assert.deepStrictEqual ((errors[0] as Error).cause, reason)
  } finally {
    process.setUncaughtExceptionCaptureCallback (null)
  }
})

test ('hook: a throw after cancelling inside dispose is reported', async () => {
  const errors: unknown[] = []
  process.setUncaughtExceptionCaptureCallback ((error) => {
    errors.push (error)
  })
  try {
    const consume = controlled<string, number> ()
    const error = new Error ('dispose failed')
    const cancel = { run: (): void => {} }
    const task = F.hook (F.resolve (1)) (() => {
      cancel.run ()
      throw error
    }) (() => consume.future)
    const result = observe (task)
    cancel.run = result.cancel
    consume.runs[0].resolve (1)
    await new Promise ((resolve) => setTimeout (resolve, 10))
    assert.deepStrictEqual (result.events, [])
    assert.deepStrictEqual (errors, [error])
  } finally {
    process.setUncaughtExceptionCaptureCallback (null)
  }
})

test ('names: argument errors use the operation the caller wrote', () => {
  assert.throws (
    () => new F.ConcurrentFuture (1 as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('ConcurrentFuture: expected a Future'),
  )
  assert.throws (
    () => F.Par (1 as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('Par: expected a Future'),
  )
  assert.deepStrictEqual (
    String (observe (F.pap (F.resolve (1)) (F.resolve (2 as never))).events[0].value),
    'TypeError: pap: expected a function',
  )
  const parallel = F.Par (F.resolve (1)).ap (F.Par (F.resolve (2 as never)))
  assert.deepStrictEqual (
    String (observe (F.seq (parallel)).events[0].value),
    'TypeError: ap: expected a function',
  )
})

test ('hook: disposal errors after cancellation are still reported', async () => {
  const errors: unknown[] = []
  process.setUncaughtExceptionCaptureCallback ((error) => {
    errors.push (error)
  })
  try {
    const use = controlled<string, number> (),
      cleanup = controlled<string, void> ()
    const result = observe (
      F.hook (F.resolve (1)) (() => cleanup.future) (() => use.future),
    )
    result.cancel ()
    cleanup.runs[0].reject ('cannot close')
    await new Promise ((resolve) => setTimeout (resolve, 10))
    assert.deepStrictEqual (result.events, [])
    assert.deepStrictEqual (errors.length, 1)
    assert.deepStrictEqual ((errors[0] as Error).cause, 'cannot close')
  } finally {
    process.setUncaughtExceptionCaptureCallback (null)
  }
})

test ('cancellation errors: all pending siblings are still cancelled', async () => {
  const errors: unknown[] = []
  process.setUncaughtExceptionCaptureCallback ((error) => {
    errors.push (error)
  })
  try {
    const error = new Error ('cancel failed')
    const broken = F.future<string, number> (() => () => {
      throw error
    })
    const other = controlled<string, number> ()
    const result = observe (F.both (broken) (other.future))
    result.cancel ()
    await new Promise ((resolve) => setTimeout (resolve, 10))
    assert.deepStrictEqual (other.runs[0].cancellations, 1)
    assert.deepStrictEqual (errors, [error])
    assert.deepStrictEqual (result.events, [])
  } finally {
    process.setUncaughtExceptionCaptureCallback (null)
  }
})

test ('observers: direct callbacks have no receiver on any channel or subscription', () => {
  const receivers: unknown[] = []
  const values: unknown[] = []
  function record(this: unknown, value: unknown): void {
    receivers.push (this)
    values.push (value)
  }
  F.resolve<string, number> (1).fork (record, record)
  F.fork (record) (record) (F.reject<string, number> ('rejected'))
  F.forkCatch (record) (record) (record) (
    F.resolve<string, number> (0).map (() => {
      throw 'crashed'
    }),
  )
  const source = controlled<string, number> ()
  const cached = F.cache (source.future)
  F.forkCatch (record) (record) (record) (cached)
  source.runs[0].resolve (2)
  F.forkCatch (record) (record) (record) (cached)
  assert.deepStrictEqual (values, [1, 'rejected', 'crashed', 2, 2])
  assert.deepStrictEqual (receivers, [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})
