import * as P from '@algosail/ply'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as F from '../src/mod.ts'

test ('future: construction does not start the task', async () => {
  let runs = 0

  function executeTask(
    _: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    runs += 1
    onResolved (42)
  }

  const example = F.future<string, number> (executeTask)

  assert.deepStrictEqual (runs, 0)
  assert.deepStrictEqual (await outcomeOf (example), { ok: 42 })
  assert.deepStrictEqual (runs, 1)
})

test ('resolve: succeeds with the supplied value', async () => {
  assert.deepStrictEqual (await outcomeOf (F.resolve<string, number> (7)), { ok: 7 })
})

test ('resolve: fork calls the success handler', () => {
  const log: string[] = []

  function recordError(error: string) {
    log.push (error)
  }

  function recordValue(value: number) {
    log.push (String (value))
  }

  F.fork (recordError) (recordValue) (F.resolve (42))

  assert.deepStrictEqual (log, ['42'])
})

test ('reject: fails with the supplied error', async () => {
  assert.deepStrictEqual (await outcomeOf (F.reject<string, number> ('pain')), {
    err: 'pain',
  })
})

test ('reject: fork calls the failure handler', () => {
  const log: string[] = []

  function recordError(error: string) {
    log.push (error)
  }

  function recordValue(value: number) {
    log.push (String (value))
  }

  F.fork (recordError) (recordValue) (F.reject ('no'))

  assert.deepStrictEqual (log, ['no'])
})

test ('fork: calls only the success handler for a resolved task', () => {
  const errors: Error[] = []
  const values: number[] = []

  function recordError(error: Error) {
    errors.push (error)
  }

  function recordValue(value: number) {
    values.push (value)
  }

  F.fork (recordError) (recordValue) (F.resolve (1))

  assert.deepStrictEqual ([errors.length, values], [0, [1]])
})

test ('fork: handlers can be reused for success and failure', () => {
  const log: string[] = []

  function recordSuccess(a: number) {
    log.push ('res:' + a)
  }

  function recordError(e: string) {
    log.push ('rej:' + e)
  }

  const runBoth = F.fork (recordError) (recordSuccess)
  runBoth (F.resolve<string, number> (1))
  runBoth (F.reject<string, number> ('bad'))

  assert.deepStrictEqual (log, ['res:1', 'rej:bad'])
  assert.deepStrictEqual (typeof runBoth (F.resolve<string, number> (2)), 'function')
})

test ('promise: resolves with a synchronous value', async () => {
  assert.deepStrictEqual (await F.promise (F.resolve (42)), 42)
})

test ('promise: rejects with a synchronous error', async () => {
  assert.deepStrictEqual (
    await F.promise (F.reject<string, number> ('trouble')).then (
      () => 'did not reject',
      (e) => e,
    ),
    'trouble',
  )
})

test ('promise: waits for an asynchronous success', async () => {
  assert.deepStrictEqual (await F.promise (resolveAfter (10, 3)), 3)
})

test ('promise: waits for an asynchronous rejection', async () => {
  assert.deepStrictEqual (
    await F.promise (rejectAfter<number> (10, 'late')).then (
      () => 'did not reject',
      (e) => e,
    ),
    'late',
  )
})

test ('race: returns the first completed value', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.race (F.after (10)<string, number> (1)) (F.after (20) (2))),
    { ok: 1 },
  )
  await delay (40)
})

test ('race: the first task can win', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.race (resolveAfter (10, 'fast')) (resolveAfter (80, 'slow'))),
    {
      ok: 'fast',
    },
  )
  await delay (100)
})

test ('race: the second task can win', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.race (resolveAfter (80, 'slow')) (resolveAfter (10, 'fast'))),
    {
      ok: 'fast',
    },
  )
  await delay (100)
})

test ('both: returns the two values as a Pair', async () => {
  const out = await outcomeOf (
    F.both (F.resolve<string, number> (1)) (F.resolve<string, string> ('a')),
  )

  assert.deepStrictEqual (out, { ok: P.pair (1, 'a') })
})

test ('both: preserves argument order when the second task finishes first', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.both (resolveAfter (30, 1)) (resolveAfter (5, 'a')).map (P.toTuple),
    ),
    { ok: [1, 'a'] },
  )
})

test ('both: preserves argument order when the first task finishes first', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.both (resolveAfter (5, 1)) (resolveAfter (30, 'a')).map (P.toTuple),
    ),
    { ok: [1, 'a'] },
  )
})

test ('parallel: returns values in input order', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.parallel (2) ([F.after (30) (1), F.after (10) (2), F.after (20) (3)]),
    ),
    { ok: [1, 2, 3] },
  )
})

test ('parallel: completion order does not change result order', async () => {
  const activity = trackTasks ()

  assert.deepStrictEqual (
    await outcomeOf (
      F.parallel (Infinity) ([
        activity.resolveAfter (60, 'a'),
        activity.resolveAfter (30, 'b'),
        activity.resolveAfter (5, 'c'),
      ]),
    ),
    { ok: ['a', 'b', 'c'] },
  )
  assert.deepStrictEqual (activity.completedLabels (), ['c', 'b', 'a'])
})

test ('parallel: accepts a single task', async () => {
  assert.deepStrictEqual (await outcomeOf (F.parallel (3) ([resolveAfter (10, 'one')])), {
    ok: ['one'],
  })
})

test ('after: succeeds after a delay', async () => {
  assert.deepStrictEqual (await outcomeOf (F.after (100)<string, number> (42)), { ok: 42 })
})

test ('after: preserves an object value', async () => {
  assert.deepStrictEqual (await outcomeOf (F.after (5) ({ a: 1 })), { ok: { a: 1 } })
})

test ('rejectAfter: fails after a delay', async () => {
  assert.deepStrictEqual (await outcomeOf (F.rejectAfter (100)<string, number> ('late')), {
    err: 'late',
  })
})

test ('attempt: succeeds with a synchronous result', async () => {
  function computeValue() {
    return 6 * 7
  }

  assert.deepStrictEqual (await outcomeOf (F.attempt (computeValue)), { ok: 42 })
})

test ('mapRej: transforms an error', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.mapRej ((e: string) => e.length) (F.reject ('ow'))),
    {
      err: 2,
    },
  )
})

test ('mapRej: transforms an asynchronous error', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.mapRej (addExclamation) (rejectAfter<number> (10, 'late'))),
    {
      err: 'late!',
    },
  )
})

test ('chainRej: recovers with the handler’s task', async () => {
  function recoverFromError(e: string) {
    return F.resolve<never, number> (e.length)
  }

  assert.deepStrictEqual (
    await outcomeOf (F.chainRej (recoverFromError) (F.reject ('ow'))),
    { ok: 2 },
  )
})

test ('bichain: chooses a task from the error or value', async () => {
  function continueFromValue(a: number) {
    return F.resolve<never, number> (a + 1)
  }

  function continueFromError(e: string) {
    return F.resolve<never, number> (e.length)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.bichain (continueFromError) (continueFromValue) (
        F.reject<string, number> ('ow'),
      ),
    ),
    { ok: 2 },
  )
})

test ('bichain: continues from a rejection', async () => {
  function onRejected(e: string) {
    return F.resolve<string, string> ('from rejection:' + e)
  }

  function onResolved(a: number) {
    return F.resolve<string, string> ('from success:' + a)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.bichain (onRejected) (onResolved) (F.reject<string, number> ('ow')),
    ),
    {
      ok: 'from rejection:ow',
    },
  )
})

test ('bichain: continues from a success', async () => {
  function onRejected(e: string) {
    return F.resolve<string, string> ('from rejection:' + e)
  }

  function onResolved(a: number) {
    return F.resolve<string, string> ('from success:' + a)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.bichain (onRejected) (onResolved) (F.resolve<string, number> (4)),
    ),
    {
      ok: 'from success:4',
    },
  )
})

test ('coalesce: turns a rejection into a successful value', async () => {
  function describeValue(a: number) {
    return 'yes: ' + a
  }

  function describeError(e: string) {
    return 'no: ' + e
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.coalesce (describeError) (describeValue) (
        F.reject<string, number> ('ow'),
      ),
    ),
    { ok: 'no: ow' },
  )
})

test ('coalesce: transforms a successful value', async () => {
  function onRejected(e: string) {
    return 'rejected:' + e
  }

  function onResolved(a: number) {
    return 'resolved:' + a
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.coalesce (onRejected) (onResolved) (F.resolve<string, number> (7)),
    ),
    {
      ok: 'resolved:7',
    },
  )
})

test ('coalesce: recovers from an asynchronous rejection', async () => {
  function onRejected(e: string) {
    return 'rejected:' + e
  }

  function onResolved(a: number) {
    return 'resolved:' + a
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.coalesce (onRejected) (onResolved) (rejectAfter<number> (10, 'late')),
    ),
    {
      ok: 'rejected:late',
    },
  )
})

test ('lastly: runs cleanup and preserves the value', async () => {
  const closed: string[] = []

  assert.deepStrictEqual (
    await outcomeOf (
      F.lastly (F.attempt (() => closed.push ('closed'))) (
        F.resolve<string, number> (1),
      ),
    ),
    { ok: 1 },
  )
  assert.deepStrictEqual (closed, ['closed'])
})

test ('cache: runs the source only once', async () => {
  const log: string[] = []

  function computeValue() {
    log.push ('once')
    return 1
  }

  const c = F.cache (F.attempt<unknown, number> (computeValue))
  await F.promise (c)
  await F.promise (c)

  assert.deepStrictEqual (log, ['once'])
})

test ('isFuture: recognizes tasks from the public constructors', () => {
  assert.deepStrictEqual (F.isFuture (F.resolve (1)), true)
  assert.deepStrictEqual (F.isFuture (F.reject<string, number> ('e')), true)
  assert.deepStrictEqual (F.isFuture (F.future<string, number> (() => {})), true)
  assert.deepStrictEqual (F.isFuture (F.never), true)
  assert.deepStrictEqual (F.isFuture (F.after (1) (1)), true)
  assert.deepStrictEqual (F.isFuture (F.cache (F.resolve<string, number> (1))), true)
  assert.deepStrictEqual (
    F.isFuture (F.resolve<string, number> (1).map (doubleNumber)),
    true,
  )

  function computeValue() {
    return 1
  }

  assert.deepStrictEqual (F.isFuture (F.attempt (computeValue)), true)
  assert.deepStrictEqual (F.isFuture (F.parallel (2) ([])), true)
})

test ('swap: turns a rejection into success', async () => {
  assert.deepStrictEqual (await outcomeOf (F.swap (F.reject<string, number> ('ow'))), {
    ok: 'ow',
  })
})

test ('swap: turns success into rejection', async () => {
  assert.deepStrictEqual (await outcomeOf (F.swap (F.resolve<string, number> (1))), {
    err: 1,
  })
})

test ('swap: exchanges asynchronous outcomes', async () => {
  assert.deepStrictEqual (await outcomeOf (F.swap (resolveAfter (10, 5))), { err: 5 })
  assert.deepStrictEqual (await outcomeOf (F.swap (rejectAfter<number> (10, 'ow'))), {
    ok: 'ow',
  })
})

test ('map: composes transformations of the value', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.resolve<string, number> (5).map (doubleNumber).map (increment),
    ),
    {
      ok: 11,
    },
  )
})

test ('ap: applies a wrapped function to a wrapped value', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.resolve<string, number> (5).ap (
        F.resolve<string, (n: number) => number> ((n) => n * 3),
      ),
    ),
    { ok: 15 },
  )
})

test ('ap: waits for both tasks in either completion order', async () => {
  assert.deepStrictEqual (
    await outcomeOf (resolveAfter (5, 5).ap (resolveAfter (30, doubleNumber))),
    { ok: 10 },
  )
  assert.deepStrictEqual (
    await outcomeOf (resolveAfter (30, 5).ap (resolveAfter (5, doubleNumber))),
    { ok: 10 },
  )
})

test ('alt: uses the fallback after rejection', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.reject<string, number> ('no').alt (F.resolve<string, number> (9)),
    ),
    { ok: 9 },
  )
})

test ('alt: recovers from an asynchronous rejection', async () => {
  assert.deepStrictEqual (
    await outcomeOf (rejectAfter<number> (10, 'no').alt (resolveAfter (10, 9))),
    { ok: 9 },
  )
})

test ('show: describes either outcome without running it', () => {
  assert.deepStrictEqual (F.resolve<string, number> (1).show (), 'Future')
  assert.deepStrictEqual (F.reject<string, number> ('e').show (), 'Future')
})

test ('parallel: changing concurrency preserves the result', async () => {
  function same() {
    return [
      resolveAfter (20, 1),
      resolveAfter (5, 2),
      resolveAfter (15, 3),
      resolveAfter (10, 4),
    ]
  }

  const atOne = await outcomeOf (F.parallel (1) (same ()))
  const atTwo = await outcomeOf (F.parallel (2) (same ()))
  const atInf = await outcomeOf (F.parallel (Infinity) (same ()))

  assert.deepStrictEqual (atOne, { ok: [1, 2, 3, 4] })
  assert.deepStrictEqual (atTwo, atOne)
  assert.deepStrictEqual (atInf, atOne)
})

test ('parallel: one task agrees with wrapping its result in an array', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.parallel (3) ([resolveAfter (10, 7)])),
    await outcomeOf (resolveAfter (10, 7).map ((a) => [a])),
  )
})

test ('parallel: two tasks agree with both', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.parallel (Infinity) ([resolveAfter (20, 1), resolveAfter (10, 2)]),
    ),
    await outcomeOf (
      F.both (resolveAfter (20, 1)) (resolveAfter (10, 2)).map (P.toTuple),
    ),
  )
})

test ('mapRej: identity law', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.mapRej (identityValue) (F.reject<string, number> ('e'))),
    await outcomeOf (F.reject<string, number> ('e')),
  )
})

test ('mapRej: composition law', async () => {
  function transformError(e: string) {
    return stringLength (addExclamation (e))
  }

  assert.deepStrictEqual (
    await outcomeOf (F.mapRej (transformError) (F.reject<string, number> ('ow'))),
    await outcomeOf (
      F.mapRej (stringLength) (
        F.mapRej (addExclamation) (F.reject<string, number> ('ow')),
      ),
    ),
  )
})

test ('mapRej: agrees with bimap on the error channel', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.mapRej (addExclamation) (rejectAfter<number> (10, 'ow'))),
    await outcomeOf (
      rejectAfter<number> (10, 'ow').bimap (addExclamation, identityValue),
    ),
  )
})

test ('chainRej: returning the same rejection preserves the outcome', async () => {
  function recoverFromError(e: string) {
    return F.reject<string, number> (e)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.chainRej (recoverFromError) (F.reject<string, number> ('ow')),
    ),
    await outcomeOf (F.reject<string, number> ('ow')),
  )
})

test ('chainRej: a constant recovery agrees with alt', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.chainRej (() => F.resolve<string, number> (9)) (
        rejectAfter<number> (10, 'ow'),
      ),
    ),
    await outcomeOf (
      rejectAfter<number> (10, 'ow').alt (F.resolve<string, number> (9)),
    ),
  )
})

test ('bichain: returning the original outcome is an identity', async () => {
  function identityBichain(task: F.Future<string, number>) {
    function continueFromValue(a: number) {
      return F.resolve<string, number> (a)
    }

    function continueFromError(e: string) {
      return F.reject<string, number> (e)
    }

    return F.bichain (continueFromError) (continueFromValue) (task)
  }

  assert.deepStrictEqual (
    await outcomeOf (identityBichain (resolveAfter (10, 5))),
    await outcomeOf (resolveAfter (10, 5)),
  )
  assert.deepStrictEqual (
    await outcomeOf (identityBichain (rejectAfter<number> (10, 'ow'))),
    await outcomeOf (rejectAfter<number> (10, 'ow')),
  )
})

test ('coalesce: success agrees with bimap', async () => {
  function onRejected(e: string) {
    return 'rejected:' + e
  }

  function onResolved(a: number) {
    return 'resolved:' + a
  }

  assert.deepStrictEqual (
    await outcomeOf (F.coalesce (onRejected) (onResolved) (resolveAfter (10, 7))),
    await outcomeOf (resolveAfter (10, 7).bimap (onRejected, onResolved)),
  )
})

test ('lastly: successful cleanup preserves success', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.lastly (F.resolve<string, string> ('c')) (resolveAfter (10, 5)),
    ),
    await outcomeOf (resolveAfter (10, 5)),
  )
})

test ('lastly: successful cleanup preserves rejection', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.lastly (F.resolve<string, string> ('c')) (rejectAfter<number> (10, 'ow')),
    ),
    await outcomeOf (rejectAfter<number> (10, 'ow')),
  )
})

test ('swap: applying it twice preserves the outcome', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.swap (F.swap (resolveAfter (10, 5)))),
    await outcomeOf (resolveAfter (10, 5)),
  )
  assert.deepStrictEqual (
    await outcomeOf (F.swap (F.swap (rejectAfter<number> (10, 'ow')))),
    await outcomeOf (rejectAfter<number> (10, 'ow')),
  )
})

test ('swap: map after swap agrees with mapRej before swap', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.swap (rejectAfter<number> (10, 'ow')).map (addExclamation)),
    await outcomeOf (
      F.swap (F.mapRej (addExclamation) (rejectAfter<number> (10, 'ow'))),
    ),
  )
})

test ('map: identity and composition laws', async () => {
  for (
    const task of [
      F.resolve<string, number> (5),
      F.reject<string, number> ('fell'),
      resolveAfter (10, 5),
      rejectAfter<number> (10, 'fell'),
    ]
  ) {
    assert.deepStrictEqual (
      await outcomeOf (task.map (identityValue)),
      await outcomeOf (task),
      'identity',
    )
    assert.deepStrictEqual (
      await outcomeOf (task.map (doubleThenIncrement)),
      await outcomeOf (task.map (doubleNumber).map (increment)),
      'composition',
    )
  }
})

test ('ap: composition law', async () => {
  const va = F.resolve<string, number> (3)
  const uf = F.resolve<string, (n: number) => number> (increment)
  const ag = F.resolve<string, (n: number) => number> ((n) => n * 10)

  function compose2(f: (n: number) => number) {
    return (g: (n: number) => number) => (x: number) => f (g (x))
  }

  assert.deepStrictEqual (
    await outcomeOf (va.ap (uf.ap (ag.map (compose2)))),
    await outcomeOf (va.ap (uf).ap (ag)),
  )
  assert.deepStrictEqual (await outcomeOf (va.ap (uf).ap (ag)), { ok: 40 })
})

test ('ap: agrees with chain and map for successful tasks', async () => {
  const task = resolveAfter (30, 5)
  const ff = resolveAfter (10, (n: number) => n * 3)

  assert.deepStrictEqual (
    await outcomeOf (task.ap (ff)),
    await outcomeOf (ff.chain ((f) => task.map (f))),
  )
})

test ('chain: associativity for synchronous tasks', async () => {
  const source = F.resolve<string, number> (2)

  function addThree(n: number): F.Future<string, number> {
    return F.resolve<string, number> (n + 3)
  }

  function multiplyByFour(n: number): F.Future<string, number> {
    return F.resolve<string, number> (n * 4)
  }

  assert.deepStrictEqual (
    await outcomeOf (source.chain (addThree).chain (multiplyByFour)),
    await outcomeOf (source.chain ((x) => addThree (x).chain (multiplyByFour))),
  )
  assert.deepStrictEqual (await outcomeOf (source.chain (addThree).chain (multiplyByFour)), {
    ok: 20,
  })
})

test ('chain: associativity for asynchronous tasks', async () => {
  const source = resolveAfter (5, 2)

  function addThreeLater(n: number): F.Future<string, number> {
    return resolveAfter (5, n + 3)
  }

  function multiplyByFourLater(n: number): F.Future<string, number> {
    return resolveAfter (5, n * 4)
  }

  assert.deepStrictEqual (
    await outcomeOf (source.chain (addThreeLater).chain (multiplyByFourLater)),
    await outcomeOf (
      source.chain ((x) => addThreeLater (x).chain (multiplyByFourLater)),
    ),
  )
})

test ('chain: left identity', async () => {
  function f(n: number): F.Future<string, number> {
    return F.resolve<string, number> (n + 3)
  }

  assert.deepStrictEqual (
    await outcomeOf (F.Future.of<string, number> (2).chain (f)),
    await outcomeOf (f (2)),
  )
})

test ('chain: right identity', async () => {
  const m = resolveAfter (10, 2)

  assert.deepStrictEqual (
    await outcomeOf (m.chain ((a) => F.resolve<string, number> (a))),
    await outcomeOf (m),
  )
})

test ('bimap: identity for success', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.resolve<string, number> (3).bimap (identityValue, identityValue),
    ),
    await outcomeOf (F.resolve<string, number> (3)),
  )
})

test ('bimap: identity for rejection', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.reject<string, number> ('e').bimap (identityValue, identityValue),
    ),
    await outcomeOf (F.reject<string, number> ('e')),
  )
})

test ('bimap: composition on the error channel', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.reject<string, number> ('ow').bimap (
        lengthAfterExclamation,
        doubleThenIncrement,
      ),
    ),
    await outcomeOf (
      F.reject<string, number> ('ow').bimap (addExclamation, doubleNumber)
        .bimap (stringLength, increment),
    ),
  )
})

test ('bimap: composition on the value channel', async () => {
  function transformError(e: string) {
    return stringLength (addExclamation (e))
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.resolve<string, number> (4).bimap (
        transformError,
        doubleThenIncrement,
      ),
    ),
    await outcomeOf (
      F.resolve<string, number> (4).bimap (addExclamation, doubleNumber).bimap (
        stringLength,
        increment,
      ),
    ),
  )
})

test ('bimap: transforming only the value agrees with map', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.resolve<string, number> (4).bimap (identityValue, doubleNumber),
    ),
    await outcomeOf (F.resolve<string, number> (4).map (doubleNumber)),
  )
})

test ('ply.bimap: composition law', async () => {
  for (
    const task of [
      F.resolve<string, number> (4),
      F.reject<string, number> ('oops'),
    ]
  ) {
    assert.deepStrictEqual (
      await outcomeOf (
        P.bimap (lengthAfterExclamation) (doubleThenIncrement) (task) as F.Future<
          number,
          number
        >,
      ),
      await outcomeOf (
        P.bimap (stringLength) (increment) (
          P.bimap (addExclamation) (doubleNumber) (task),
        ) as F.Future<number, number>,
      ),
    )
  }
})

test ('ply.mapLeft: agrees with bimap on a rejection', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      P.mapLeft (addExclamation) (F.reject<string, number> ('ow')) as F.Future<
        string,
        number
      >,
    ),
    await outcomeOf (
      P.bimap (addExclamation) (identityValue) (F.reject<string, number> ('ow')),
    ),
  )
})

test ('alt: associativity and distributivity', async () => {
  function mk(spec: number | string): F.Future<string, number> {
    return typeof spec === 'number'
      ? F.resolve<string, number> (spec)
      : F.reject<string, number> (spec)
  }

  for (const a of ['A', 1] as const) {
    for (const b of ['B', 2] as const) {
      for (const c of ['C', 3] as const) {
        assert.deepStrictEqual (
          await outcomeOf (mk (a).alt (mk (b)).alt (mk (c))),
          await outcomeOf (mk (a).alt (mk (b).alt (mk (c)))),
          `associativity ${a}/${b}/${c}`,
        )
      }

      assert.deepStrictEqual (
        await outcomeOf (mk (a).alt (mk (b)).map (doubleNumber)),
        await outcomeOf (mk (a).map (doubleNumber).alt (mk (b).map (doubleNumber))),
        `distributivity ${a}/${b}`,
      )
    }
  }
})

test ('future: each run starts the task again', async () => {
  let calls = 0

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    calls += 1
    onResolved (calls)
  }

  const counted = F.future<string, number> (executeTask)

  assert.deepStrictEqual (await outcomeOf (counted), { ok: 1 })
  assert.deepStrictEqual (await outcomeOf (counted), { ok: 2 })
  assert.deepStrictEqual (calls, 2)
})

test ('map and chain: composing a task does not start it', async () => {
  const events: string[] = []

  function execute(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    events.push ('execute')
    onResolved (1)
  }

  function incrementValue(value: number) {
    events.push ('map')
    return value + 1
  }

  function doubleValue(value: number): F.Future<string, number> {
    events.push ('chain')
    return F.resolve (value * 2)
  }

  const source = F.future (execute)
  const composed = source.map (incrementValue).chain (doubleValue).bimap (
    identityValue,
    identityValue,
  ).alt (F.resolve (0))

  assert.deepStrictEqual (events, [])
  await delay (20)

  assert.deepStrictEqual (events, [])
  assert.deepStrictEqual (await outcomeOf (composed), { ok: 4 })
  assert.deepStrictEqual (events, ['execute', 'map', 'chain'])
})

test ('fork: waits for an asynchronous outcome', async () => {
  const late: string[] = []

  function recordSuccess(a: number) {
    late.push ('res:' + a)
  }

  function recordError(e: string) {
    late.push ('rej:' + e)
  }

  F.fork (recordError) (recordSuccess) (resolveAfter (10, 7))

  assert.deepStrictEqual (late, [])
  await delay (60)

  assert.deepStrictEqual (late, ['res:7'])
})

test ('promise: starts the task exactly once', async () => {
  let runs = 0

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    runs += 1
    onResolved (1)
  }

  assert.deepStrictEqual (
    await F.promise (F.future<string, number> (executeTask)),
    1,
  )
  assert.deepStrictEqual (runs, 1)
})

test ('attemptP: does not call fetch during construction', () => {
  const lazyFetch = F.attemptP (() => fetch ('/api'))

  assert.deepStrictEqual (F.isFuture (lazyFetch), true)
})

test ('attemptP: creates a new Promise on each run', async () => {
  let made = 0

  function createPromise() {
    made += 1
    return Promise.resolve (42)
  }

  const fp = F.attemptP (createPromise)

  assert.deepStrictEqual (made, 0)
  assert.deepStrictEqual (await outcomeOf (fp), { ok: 42 })
  assert.deepStrictEqual (made, 1)
  await outcomeOf (fp)

  assert.deepStrictEqual (made, 2)
})

test ('race: cancels the losing task', async () => {
  const activity = trackTasks ()
  const fast = activity.resolveAfter (5, 'fast')
  const slow = activity.resolveAfter (200, 'slow')

  assert.deepStrictEqual (await outcomeOf (F.race (fast) (slow)), { ok: 'fast' })
  assert.deepStrictEqual (activity.startedCount (), 2)
  assert.deepStrictEqual (activity.completedLabels (), ['fast'])
  await delay (250)

  assert.deepStrictEqual (activity.completedLabels (), ['fast'])
})

test ('race: delivers only one outcome even if the loser rejects', async () => {
  assert.deepStrictEqual (
    await observeOutcomes (
      F.race (resolveAfter (10, 'fast')) (rejectAfter<string> (30, 'late')),
      80,
    ),
    ['res:fast'],
  )
})

test ('both: runs both tasks concurrently', async () => {
  const activity = trackTasks ()

  assert.deepStrictEqual (
    await outcomeOf (
      F.both (activity.resolveAfter (30, 1)) (activity.resolveAfter (30, 'a')).map (
        P.toTuple,
      ),
    ),
    { ok: [1, 'a'] },
  )
  assert.deepStrictEqual (activity.startedCount (), 2)
  assert.deepStrictEqual (activity.maxConcurrent (), 2)
})

test ('parallel: Infinity starts every task', async () => {
  const unlimited = trackTasks ()
  const five = [20, 20, 20, 20, 20].map ((d, i) =>
    unlimited.resolveAfter (d, 'f' + i),
  )

  assert.deepStrictEqual (await outcomeOf (F.parallel (Infinity) (five)), {
    ok: ['f0', 'f1', 'f2', 'f3', 'f4'],
  })
  assert.deepStrictEqual (unlimited.maxConcurrent (), 5)
})

test ('parallel: a limit of two starts at most two tasks at once', async () => {
  const twoAtATime = trackTasks ()
  const six = [15, 15, 15, 15, 15, 15].map ((d, i) =>
    twoAtATime.resolveAfter (d, 'g' + i),
  )

  assert.deepStrictEqual (await outcomeOf (F.parallel (2) (six)), {
    ok: ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'],
  })
  assert.deepStrictEqual (twoAtATime.maxConcurrent (), 2)
  assert.deepStrictEqual (twoAtATime.startedCount (), 6)
})

test ('parallel: a limit of one runs tasks sequentially', async () => {
  const oneAtATime = trackTasks ()
  const four = [10, 10, 10, 10].map ((d, i) =>
    oneAtATime.resolveAfter (d, 'h' + i),
  )

  assert.deepStrictEqual (await outcomeOf (F.parallel (1) (four)), {
    ok: ['h0', 'h1', 'h2', 'h3'],
  })
  assert.deepStrictEqual (oneAtATime.maxConcurrent (), 1)
  assert.deepStrictEqual (oneAtATime.completedLabels (), ['h0', 'h1', 'h2', 'h3'])
})

test ('parallel: a limit larger than the input starts every task', async () => {
  const wideLimit = trackTasks ()
  const three = [10, 10, 10].map ((d, i) => wideLimit.resolveAfter (d, 'w' + i))

  assert.deepStrictEqual (await outcomeOf (F.parallel (10) (three)), {
    ok: ['w0', 'w1', 'w2'],
  })
  assert.deepStrictEqual (wideLimit.maxConcurrent (), 3)
})

test ('after: starts its timer only when run', async () => {
  const built: F.Future<string, string> = F.after (20) ('on time')
  await delay (50)
  const start = Date.now ()

  assert.deepStrictEqual (await outcomeOf (built), { ok: 'on time' })
  assert.deepStrictEqual (Date.now () - start >= 10, true)
})

test ('attempt: is lazy and repeats the function on each run', async () => {
  let runs = 0

  function computeValue() {
    runs += 1
    return runs
  }

  const counted = F.attempt<string, number> (computeValue)

  assert.deepStrictEqual (runs, 0)
  assert.deepStrictEqual (await outcomeOf (counted), { ok: 1 })
  assert.deepStrictEqual (await outcomeOf (counted), { ok: 2 })
})

test ('lastly: waits for cleanup after success', async () => {
  const trace: string[] = []

  function traced(name: string, ms: number, ok: boolean) {
    function executeTask(
      onRejected: (error: string) => void,
      onResolved: (value: string) => void,
    ) {
      trace.push (name + ':start')
      setTimeout (() => {
        trace.push (name + ':end')
        if (ok) onResolved (name)
        else onRejected (name)
      }, ms)
    }

    return F.future<string, string> (executeTask)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.lastly (traced ('cleanup', 5, true)) (traced ('work', 20, true)),
    ),
    { ok: 'work' },
  )
  assert.deepStrictEqual (trace, [
    'work:start',
    'work:end',
    'cleanup:start',
    'cleanup:end',
  ])
})

test ('lastly: waits for cleanup after failure', async () => {
  const trace: string[] = []

  function traced(name: string, ms: number, ok: boolean) {
    function executeTask(
      onRejected: (error: string) => void,
      onResolved: (value: string) => void,
    ) {
      trace.push (name + ':start')
      setTimeout (() => {
        trace.push (name + ':end')
        if (ok) onResolved (name)
        else onRejected (name)
      }, ms)
    }

    return F.future<string, string> (executeTask)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.lastly (traced ('cleanup', 5, true)) (traced ('work', 20, false)),
    ),
    { err: 'work' },
  )
  assert.deepStrictEqual (trace, [
    'work:start',
    'work:end',
    'cleanup:start',
    'cleanup:end',
  ])
})

test ('lastly: is lazy and repeats cleanup on every run', async () => {
  let times = 0

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: string) => void,
  ) {
    times += 1
    onResolved ('c')
  }

  const counting = F.future<string, string> (executeTask)
  const wrapped = F.lastly (counting) (resolveAfter (5, 1))

  assert.deepStrictEqual (times, 0)
  await outcomeOf (wrapped)
  await outcomeOf (wrapped)

  assert.deepStrictEqual (times, 2)
})

test ('cache: shares pending work and replays its successful result', async () => {
  let runs = 0

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    runs += 1
    setTimeout (() => onResolved (runs), 20)
  }

  const slow = F.future<string, number> (executeTask)
  const cached = F.cache (slow)

  assert.deepStrictEqual (runs, 0)
  assert.deepStrictEqual (
    await Promise.all ([
      outcomeOf (cached),
      outcomeOf (cached),
      outcomeOf (cached),
    ]),
    [
      { ok: 1 },
      { ok: 1 },
      { ok: 1 },
    ],
  )
  assert.deepStrictEqual (runs, 1)
  assert.deepStrictEqual (await outcomeOf (cached), { ok: 1 })
  assert.deepStrictEqual (runs, 1)
})

test ('cache: separate caches run the source independently', async () => {
  let twice = 0

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    twice += 1
    onResolved (twice)
  }

  const shared = F.future<string, number> (executeTask)

  assert.deepStrictEqual (await outcomeOf (F.cache (shared)), { ok: 1 })
  assert.deepStrictEqual (await outcomeOf (F.cache (shared)), { ok: 2 })
  assert.deepStrictEqual (twice, 2)
})

test ('isFuture: does not start the task', () => {
  let touched = 0

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    touched += 1
    onResolved (1)
  }

  F.isFuture (F.future<string, number> (executeTask))

  assert.deepStrictEqual (touched, 0)
})

test ('swap: is lazy and repeats its source on each run', async () => {
  let runs = 0

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    runs += 1
    onResolved (1)
  }

  const src = F.swap (F.future<string, number> (executeTask))

  assert.deepStrictEqual (runs, 0)
  await outcomeOf (src)
  await outcomeOf (src)

  assert.deepStrictEqual (runs, 2)
})

test ('ap: runs the function and value tasks sequentially', async () => {
  const activity = trackTasks ()

  assert.deepStrictEqual (
    await outcomeOf (
      activity.resolveAfter (30, 5).ap (activity.resolveAfter (30, doubleNumber)),
    ),
    { ok: 10 },
  )
  assert.deepStrictEqual (activity.maxConcurrent (), 1)
})

test ('chain: starts the next task after the first succeeds', async () => {
  const seq: string[] = []

  function step(
    name: string,
    ms: number,
    val: number,
  ): F.Future<string, number> {
    function executeTask(
      _onRejected: (error: string) => void,
      onResolved: (value: number) => void,
    ) {
      seq.push (name + ':start')
      setTimeout (() => {
        seq.push (name + ':end')
        onResolved (val)
      }, ms)
    }

    return F.future<string, number> (executeTask)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      step ('first', 20, 1).chain ((n) => step ('second', 5, n + 1)),
    ),
    { ok: 2 },
  )
  assert.deepStrictEqual (seq, [
    'first:start',
    'first:end',
    'second:start',
    'second:end',
  ])
})

test ('alt: does not start the fallback after success', async () => {
  let runs = 0

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    runs += 1
    onResolved (9)
  }

  const backup = F.future<string, number> (executeTask)

  assert.deepStrictEqual (await outcomeOf (F.resolve<string, number> (1).alt (backup)), {
    ok: 1,
  })
  assert.deepStrictEqual (runs, 0)
})

test ('ply.show: does not start the task', () => {
  let runs = 0

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    runs += 1
    onResolved (1)
  }

  assert.deepStrictEqual (
    P.show (F.future<string, number> (executeTask)),
    'Future',
  )
  assert.deepStrictEqual (runs, 0)
})

test ('future: delivers only the first success', async () => {
  function reportMultipleOutcomes(
    onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    onResolved (1)
    onResolved (2)
    onRejected ('late')
  }

  const twicer = F.future<string, number> (reportMultipleOutcomes)

  assert.deepStrictEqual (await observeOutcomes (twicer, 20), ['res:1'])
})

test ('future: delivers only the first rejection', async () => {
  function executeTask(
    onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    onRejected ('one')
    onRejected ('two')
    onResolved (3)
  }

  const rejFirst = F.future<string, number> (executeTask)

  assert.deepStrictEqual (await observeOutcomes (rejFirst, 20), ['rej:one'])
})

test ('future: ignores repeated asynchronous callbacks', async () => {
  function reportMultipleOutcomes(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    setTimeout (() => {
      onResolved (1)
      onResolved (2)
    }, 5)
  }

  const asyncTwicer = F.future<string, number> (reportMultipleOutcomes)

  assert.deepStrictEqual (await observeOutcomes (asyncTwicer, 40), ['res:1'])
})

test ('future: each run can settle independently', async () => {
  function reportMultipleOutcomes(
    onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    onResolved (1)
    onResolved (2)
    onRejected ('late')
  }

  const twicer = F.future<string, number> (reportMultipleOutcomes)

  assert.deepStrictEqual (await observeOutcomes (twicer, 20), ['res:1'])
  assert.deepStrictEqual (await observeOutcomes (twicer, 20), ['res:1'])
})

test ('map: ignores repeated outcomes from the source', async () => {
  function twicer() {
    function reportMultipleOutcomes(
      onRejected: (error: string) => void,
      onResolved: (value: number) => void,
    ) {
      onResolved (1)
      onResolved (2)
      onRejected ('late')
    }

    return F.future<string, number> (reportMultipleOutcomes)
  }

  assert.deepStrictEqual (await observeOutcomes (twicer ().map (doubleNumber), 20), ['res:2'])
})

test ('chain: ignores repeated outcomes from the source', async () => {
  function twicer() {
    function reportMultipleOutcomes(
      onRejected: (error: string) => void,
      onResolved: (value: number) => void,
    ) {
      onResolved (1)
      onResolved (2)
      onRejected ('late')
    }

    return F.future<string, number> (reportMultipleOutcomes)
  }

  function continueWithValue(n: number) {
    return F.resolve<string, number> (n * 10)
  }

  assert.deepStrictEqual (
    await observeOutcomes (
      twicer ().chain (continueWithValue),
      20,
    ),
    ['res:10'],
  )
})

test ('bimap: ignores repeated outcomes from the source', async () => {
  function twicer() {
    function reportMultipleOutcomes(
      onRejected: (error: string) => void,
      onResolved: (value: number) => void,
    ) {
      onResolved (1)
      onResolved (2)
      onRejected ('late')
    }

    return F.future<string, number> (reportMultipleOutcomes)
  }

  assert.deepStrictEqual (
    await observeOutcomes (twicer ().bimap (identityValue, doubleNumber), 20),
    ['res:2'],
  )
})

test ('alt: ignores repeated outcomes from the source', async () => {
  function rejTwicer() {
    function executeTask(
      onRejected: (error: string) => void,
      onResolved: (value: number) => void,
    ) {
      onRejected ('one')
      onRejected ('two')
      onResolved (3)
    }

    return F.future<string, number> (executeTask)
  }

  assert.deepStrictEqual (
    await observeOutcomes (rejTwicer ().alt (F.resolve (8)), 20),
    ['res:8'],
  )
})

test ('ap: ignores repeated outcomes from the source', async () => {
  function twicer() {
    function reportMultipleOutcomes(
      onRejected: (error: string) => void,
      onResolved: (value: number) => void,
    ) {
      onResolved (1)
      onResolved (2)
      onRejected ('late')
    }

    return F.future<string, number> (reportMultipleOutcomes)
  }

  assert.deepStrictEqual (
    await observeOutcomes (
      twicer ().ap (F.resolve<string, (n: number) => number> (doubleNumber)),
      20,
    ),
    ['res:2'],
  )
})

test ('attemptP: forwards a rejected Promise', async () => {
  assert.deepStrictEqual (
    await outcomeOf (F.attemptP<number> (() => Promise.reject ('failed'))),
    { err: 'failed' },
  )
})

test ('attemptP: forwards an asynchronous rejection', async () => {
  function createPromise() {
    return new Promise<number> ((_onResolved, onRejected) =>
      setTimeout (() => onRejected ('failed late'), 10),
    )
  }

  assert.deepStrictEqual (
    await outcomeOf (F.attemptP<number> (createPromise)),
    { err: 'failed late' },
  )
})

test ('attemptP: catches an error thrown before returning a Promise', async () => {
  function createPromise(): never {
    throw 'before the promise'
  }

  assert.deepStrictEqual (
    await outcomeOf (F.attemptP<number> (createPromise)),
    { err: 'before the promise' },
  )
})

test ('race: an early rejection wins over a later success', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.race (rejectAfter<string> (10, 'early rejection')) (
        resolveAfter (80, 'late'),
      ),
    ),
    { err: 'early rejection' },
  )
  await delay (100)
})

test ('race: an early success wins over a later rejection', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.race (resolveAfter (10, 'early')) (
        rejectAfter<string> (80, 'late rejection'),
      ),
    ),
    { ok: 'early' },
  )
  await delay (100)
})

test ('race: a synchronous success in the first argument wins', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.race (F.resolve<string, number> (1)) (F.reject<string, number> ('no')),
    ),
    { ok: 1 },
  )
})

test ('race: a synchronous rejection in the first argument wins', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.race (F.reject<string, number> ('no')) (F.resolve<string, number> (1)),
    ),
    { err: 'no' },
  )
})

test ('race: never leaves the outcome to the other task', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.race (resolveAfter (15, 'ok')) (F.never as F.Future<string, string>),
    ),
    { ok: 'ok' },
  )
  assert.deepStrictEqual (
    await outcomeOf (
      F.race (F.never as F.Future<string, string>) (resolveAfter (15, 'ok')),
    ),
    { ok: 'ok' },
  )
  assert.deepStrictEqual (
    await outcomeOf (F.race (F.never as F.Future<never, number>) (F.after (10) (1))),
    {
      ok: 1,
    },
  )
})

test ('both: fails when the first task rejects', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.both (rejectAfter<number> (10, 'left')) (resolveAfter (60, 'a')),
    ),
    {
      err: 'left',
    },
  )
  await delay (80)
})

test ('both: fails when the second task rejects', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.both (resolveAfter (60, 1)) (rejectAfter<string> (10, 'right')),
    ),
    {
      err: 'right',
    },
  )
  await delay (80)
})

test ('both: delivers the earliest rejection', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.both (rejectAfter<number> (50, 'late')) (rejectAfter<string> (10, 'early')),
    ),
    { err: 'early' },
  )
  await delay (70)
})

test ('both: delivers only one rejection', async () => {
  assert.deepStrictEqual (
    (await observeOutcomes (
      F.both (rejectAfter<number> (10, 'A')) (rejectAfter<string> (30, 'B')),
      70,
    ))
      .length,
    1,
  )
})

test ('both: remains pending if one task never settles', async () => {
  assert.deepStrictEqual (
    await observeOutcomes (
      F.both (resolveAfter (10, 1)) (F.never as F.Future<string, string>),
      60,
    ),
    [],
  )
})

test ('parallel: an empty input succeeds with an array', async () => {
  assert.deepStrictEqual (await outcomeOf (F.parallel (2) ([])), { ok: [] })
  assert.deepStrictEqual (await outcomeOf (F.parallel (Infinity) ([])), { ok: [] })
  assert.deepStrictEqual (
    await outcomeOf (F.parallel (2) ([]).map ((xs) => Array.isArray (xs))),
    { ok: true },
  )
})

test ('parallel: starts no further tasks after a rejection', async () => {
  const activity = trackTasks ()
  const seq = [
    activity.resolveAfter<string> (10, 'a'),
    activity.resolveAfter<string> (10, 'b'),
    activity.rejectAfter<string> (10, 'boom'),
    activity.resolveAfter<string> (10, 'd'),
    activity.resolveAfter<string> (10, 'e'),
  ]

  assert.deepStrictEqual (await outcomeOf (F.parallel (1) (seq)), { err: 'boom' })
  await delay (60)

  assert.deepStrictEqual (activity.startedCount (), 3)
})

test ('parallel: multiple rejections produce one outcome', async () => {
  assert.deepStrictEqual (
    (await observeOutcomes (
      F.parallel (Infinity) ([
        rejectAfter<number> (10, 'A'),
        rejectAfter<number> (20, 'B'),
        rejectAfter<number> (30, 'C'),
      ]),
      70,
    )).length,
    1,
  )
})

test ('parallel: stops on a synchronous rejection', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.parallel (2) ([
        F.resolve<string, number> (1),
        F.reject<string, number> ('at once'),
        F.resolve<string, number> (3),
      ]),
    ),
    { err: 'at once' },
  )
})

test ('after: accepts a zero delay', async () => {
  assert.deepStrictEqual (await outcomeOf (F.after (0) ('at once')), { ok: 'at once' })
})

test ('after: delivers one outcome', async () => {
  assert.deepStrictEqual ((await observeOutcomes (F.after (10) (1), 50)).length, 1)
})

test ('rejectAfter: delivers one rejection', async () => {
  assert.deepStrictEqual (await observeOutcomes (F.rejectAfter (10) ('too late'), 50), [
    'rej:too late',
  ])
})

test ('rejectAfter: can lose a race to an earlier success', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.race (F.after (10)<string, string> ('in time')) (
        F.rejectAfter (80) ('too late'),
      ),
    ),
    { ok: 'in time' },
  )
  await delay (100)
})

test ('never: stays pending, including after map', async () => {
  assert.deepStrictEqual (typeof F.never, 'object')
  assert.deepStrictEqual (F.isFuture (F.never), true)
  assert.deepStrictEqual (await observeOutcomes (F.never, 60), [])
  assert.deepStrictEqual (
    await observeOutcomes (
      (F.never as F.Future<string, number>).map (doubleNumber),
      40,
    ),
    [],
  )
})

test ('attempt: turns a thrown SyntaxError into a rejection', async () => {
  const broken = await outcomeOf (
    F.attempt<unknown, unknown> (() => JSON.parse ('{')),
  )

  assert.deepStrictEqual ('err' in broken && broken.err instanceof SyntaxError, true)
})

test ('attempt: can reject with a thrown string', async () => {
  function computeValue(): never {
    throw 'thrown'
  }

  assert.deepStrictEqual (
    await outcomeOf (F.attempt<string, number> (computeValue)),
    { err: 'thrown' },
  )
})

test ('attempt: preserves the identity of a thrown object', async () => {
  const sentinel = { code: 7 }

  function computeValue(): never {
    throw sentinel
  }

  const thrown = await outcomeOf (F.attempt<unknown, number> (computeValue))

  assert.deepStrictEqual ('err' in thrown && thrown.err === sentinel, true)
})

test ('attempt: can succeed with undefined', async () => {
  function computeValue() {
    return undefined
  }

  assert.deepStrictEqual (
    await outcomeOf (F.attempt (computeValue).map ((u) => u === undefined)),
    { ok: true },
  )
})

test ('mapRej: skips the handler after success', async () => {
  let seen = 0

  function transformError(e: string) {
    seen += 1
    return addExclamation (e)
  }

  assert.deepStrictEqual (
    await outcomeOf (F.mapRej (transformError) (F.resolve<string, number> (5))),
    { ok: 5 },
  )
  assert.deepStrictEqual (seen, 0)
})

test ('chainRej: skips the handler after success', async () => {
  let seen = 0

  function recoverFromError(_e: string) {
    seen += 1
    return F.resolve<string, number> (0)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.chainRej (recoverFromError) (F.resolve<string, number> (9)),
    ),
    { ok: 9 },
  )
  assert.deepStrictEqual (seen, 0)
})

test ('chainRej: can fail with a new error', async () => {
  function recoverFromError(e: string) {
    return F.reject<string, number> ('again:' + e)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.chainRej (recoverFromError) (F.reject<string, number> ('one')),
    ),
    { err: 'again:one' },
  )
})

test ('bichain: calls only the success handler', async () => {
  let rejectionCalls = 0
  let successCalls = 0

  function onRejected(_error: string) {
    rejectionCalls += 1
    return F.resolve<string, string> ('l')
  }

  function onResolved(_value: number) {
    successCalls += 1
    return F.resolve<string, string> ('r')
  }

  const source = F.resolve<string, number> (1)
  await outcomeOf (F.bichain (onRejected) (onResolved) (source))

  assert.deepStrictEqual (rejectionCalls, 0)
  assert.deepStrictEqual (successCalls, 1)
})

test ('bichain: calls only the rejection handler', async () => {
  let rejectionCalls = 0
  let successCalls = 0

  function onRejected(_error: string) {
    rejectionCalls += 1
    return F.resolve<string, string> ('l')
  }

  function onResolved(_value: number) {
    successCalls += 1
    return F.resolve<string, string> ('r')
  }

  const source = F.reject<string, number> ('e')
  await outcomeOf (F.bichain (onRejected) (onResolved) (source))

  assert.deepStrictEqual (rejectionCalls, 1)
  assert.deepStrictEqual (successCalls, 0)
})

test ('bichain: the selected handler can reject', async () => {
  function continueFromValue(_a: number) {
    return F.resolve<string, string> ('ok')
  }

  function continueFromError(e: string) {
    return F.reject<string, string> ('still ' + e)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      F.bichain (continueFromError) (continueFromValue) (
        F.reject<string, number> ('bad'),
      ),
    ),
    { err: 'still bad' },
  )
})

test ('coalesce: delivers recovery only through the success handler', async () => {
  function onRejected(e: string) {
    return 'rejected:' + e
  }

  function onResolved(a: number) {
    return 'resolved:' + a
  }

  assert.deepStrictEqual (
    await observeOutcomes (
      F.coalesce (onRejected) (onResolved) (rejectAfter<number> (10, 'ow')),
      50,
    ),
    ['res:rejected:ow'],
  )
})

test ('lastly: cleanup failure replaces a successful outcome', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.lastly (rejectAfter<string> (10, 'cleanup failed')) (
        resolveAfter (10, 'work'),
      ),
    ),
    { err: 'cleanup failed' },
  )
})

test ('lastly: cleanup failure replaces the original error', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.lastly (rejectAfter<string> (10, 'cleanup failed')) (
        rejectAfter<string> (10, 'work failed'),
      ),
    ),
    { err: 'cleanup failed' },
  )
})

test ('cache: shares pending work and replays its rejection', async () => {
  let failRuns = 0

  function executeTask(onRejected: (error: string) => void) {
    failRuns += 1
    setTimeout (() => onRejected ('trouble ' + failRuns), 10)
  }

  const cachedFail = F.cache (F.future<string, number> (executeTask))

  assert.deepStrictEqual (
    await Promise.all ([outcomeOf (cachedFail), outcomeOf (cachedFail)]),
    [
      { err: 'trouble 1' },
      { err: 'trouble 1' },
    ],
  )
  assert.deepStrictEqual (await outcomeOf (cachedFail), { err: 'trouble 1' })
  assert.deepStrictEqual (failRuns, 1)
})

test ('cache: returns the same object reference', async () => {
  const marker = { mark: 'one and the same' }

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: { mark: string }) => void,
  ) {
    setTimeout (() => onResolved (marker), 5)
  }

  const cachedObj = F.cache (F.future<string, { mark: string }> (executeTask))
  const first = await outcomeOf (cachedObj)
  const second = await outcomeOf (cachedObj)

  assert.deepStrictEqual ('ok' in first && first.ok === marker, true)
  assert.deepStrictEqual ('ok' in first && 'ok' in second && first.ok === second.ok, true)
})

test ('isFuture: rejects lookalikes and other values', () => {
  assert.deepStrictEqual (F.isFuture ({ fork: () => {} }), false)
  for (
    const value of [
      null,
      undefined,
      42,
      'Future',
      {},
      [1, 2],
      () => {},
      P.pair (1, 2),
      new Date (0),
    ]
  ) {
    assert.deepStrictEqual (F.isFuture (value), false)
  }
})

test ('map: skips the handler after rejection', async () => {
  let seen = 0

  function transformValue(n: number) {
    seen += 1
    return n
  }

  assert.deepStrictEqual (
    await outcomeOf (F.reject<string, number> ('fell').map (transformValue)),
    { err: 'fell' },
  )
  assert.deepStrictEqual (seen, 0)
})

test ('ap: fails when the function task rejects', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.resolve<string, number> (1).ap (
        F.reject<string, (n: number) => number> ('no function'),
      ),
    ),
    { err: 'no function' },
  )
})

test ('ap: fails when the value task rejects', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.reject<string, number> ('no value').ap (
        F.resolve<string, (n: number) => number> (identityValue),
      ),
    ),
    { err: 'no value' },
  )
})

test ('ap: a synchronous function rejection takes precedence', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.reject<string, number> ('val').ap (
        F.reject<string, (n: number) => number> ('fn'),
      ),
    ),
    { err: 'fn' },
  )
})

test ('ap: delivers only one rejection', async () => {
  assert.deepStrictEqual (
    (await observeOutcomes (
      F.reject<string, number> ('A').ap (
        F.reject<string, (n: number) => number> ('B'),
      ),
      20,
    )).length,
    1,
  )
})

test ('chain: skips the next task after rejection', async () => {
  let runs = 0

  function continueWithValue(n: number) {
    runs += 1
    return F.resolve<string, number> (n)
  }

  assert.deepStrictEqual (
    await outcomeOf (
      rejectAfter<number> (10, 'late stop').chain (continueWithValue),
    ),
    { err: 'late stop' },
  )
  assert.deepStrictEqual (runs, 0)
})

test ('chain: forwards a rejection from the next task', async () => {
  function continueWithValue() {
    return F.reject<string, number> ('inside')
  }

  assert.deepStrictEqual (
    await outcomeOf (F.resolve<string, number> (1).chain (continueWithValue)),
    { err: 'inside' },
  )
})

test ('bimap: calls only the success handler', async () => {
  let rejectionCalls = 0
  let successCalls = 0

  function onRejected(_error: string) {
    rejectionCalls += 1
    return 'x'
  }

  function onResolved(value: number) {
    successCalls += 1
    return value
  }

  const source = F.resolve<string, number> (1)
  await outcomeOf (source.bimap (onRejected, onResolved))

  assert.deepStrictEqual (rejectionCalls, 0)
  assert.deepStrictEqual (successCalls, 1)
})

test ('bimap: calls only the rejection handler', async () => {
  let rejectionCalls = 0
  let successCalls = 0

  function onRejected(_error: string) {
    rejectionCalls += 1
    return 'x'
  }

  function onResolved(value: number) {
    successCalls += 1
    return value
  }

  const source = F.reject<string, number> ('e')
  await outcomeOf (source.bimap (onRejected, onResolved))

  assert.deepStrictEqual (rejectionCalls, 1)
  assert.deepStrictEqual (successCalls, 0)
})

test ('alt: forwards a rejection from the fallback', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      F.reject<string, number> ('A').alt (F.reject<string, number> ('B')),
    ),
    { err: 'B' },
  )
})

test ('ply.show: does not evaluate a throwing task', () => {
  function throwOnStart() {
    throw new Error ('boom')
  }

  assert.deepStrictEqual (
    P.show (F.future<string, number> (throwOnStart)),
    'Future',
  )
})

test ('future: supplies exactly the rejection and resolution handlers', async () => {
  const calls: unknown[][] = []

  function execute(
    ...args: [(error: string) => void, (value: number) => void]
  ) {
    calls.push (args)
    args[1] (1)
  }

  assert.deepStrictEqual (await outcomeOf (F.future (execute)), { ok: 1 })
  assert.deepStrictEqual (calls.length, 1)
  assert.deepStrictEqual (calls[0].length, 2)
  assert.deepStrictEqual (typeof calls[0][0], 'function')
  assert.deepStrictEqual (typeof calls[0][1], 'function')
})

test ('fork: passes only the error to its rejection handler', () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return undefined
  }

  function ignoreOutcome(_value: unknown): void {}

  F.fork (recordArguments) (ignoreOutcome) (F.reject<string, number> ('e'))

  assert.deepStrictEqual (calls, [['e']])
})

test ('fork: passes only the value to its success handler', () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return undefined
  }

  function ignoreOutcome(_value: unknown): void {}

  F.fork (ignoreOutcome) (recordArguments) (F.resolve<string, number> (1))

  assert.deepStrictEqual (calls, [[1]])
})

test ('attempt: calls its function without arguments', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return 1
  }

  await outcomeOf (F.attempt (recordArguments))

  assert.deepStrictEqual (calls, [[]])
})

test ('attemptP: calls its Promise factory without arguments', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return Promise.resolve (1)
  }

  await outcomeOf (F.attemptP (recordArguments))

  assert.deepStrictEqual (calls, [[]])
})

test ('mapRej: passes only the error', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return 'e'
  }

  await outcomeOf (F.mapRej (recordArguments) (F.reject<string, number> ('e')))

  assert.deepStrictEqual (calls, [['e']])
})

test ('chainRej: passes only the error', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return F.resolve<string, number> (1)
  }

  await outcomeOf (F.chainRej (recordArguments) (F.reject<string, number> ('e')))

  assert.deepStrictEqual (calls, [['e']])
})

test ('bichain: passes only the error to its rejection handler', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return F.resolve<string, number> (1)
  }

  function resolveValue(value: number) {
    return F.resolve<string, number> (value)
  }

  await outcomeOf (
    F.bichain (recordArguments) (resolveValue) (F.reject<string, number> ('e')),
  )

  assert.deepStrictEqual (calls, [['e']])
})

test ('bichain: passes only the value to its success handler', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return F.resolve<string, number> (1)
  }

  function rejectError(error: string) {
    return F.reject<string, number> (error)
  }

  await outcomeOf (
    F.bichain (rejectError) (recordArguments) (F.resolve<string, number> (1)),
  )

  assert.deepStrictEqual (calls, [[1]])
})

test ('coalesce: passes only the error to its rejection handler', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return 1
  }

  function keepNumber(value: number) {
    return value
  }

  await outcomeOf (
    F.coalesce (recordArguments) (keepNumber) (F.reject<string, number> ('e')),
  )

  assert.deepStrictEqual (calls, [['e']])
})

test ('coalesce: passes only the value to its success handler', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return 1
  }

  await outcomeOf (
    F.coalesce (stringLength) (recordArguments) (F.resolve<string, number> (1)),
  )

  assert.deepStrictEqual (calls, [[1]])
})

test ('ply.map: passes only the value', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return 1
  }

  await outcomeOf (P.map (recordArguments) (F.resolve<string, number> (1)))

  assert.deepStrictEqual (calls, [[1]])
})

test ('ply.chain: passes only the value', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return F.resolve<string, number> (1)
  }

  await outcomeOf (P.chain (recordArguments) (F.resolve<string, number> (1)))

  assert.deepStrictEqual (calls, [[1]])
})

test ('bimap: passes only the error to its rejection handler', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return 'e'
  }

  await outcomeOf (
    F.reject<string, number> ('e').bimap (recordArguments, identityValue),
  )

  assert.deepStrictEqual (calls, [['e']])
})

test ('bimap: passes only the value to its success handler', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return 1
  }

  await outcomeOf (
    F.resolve<string, number> (1).bimap (identityValue, recordArguments),
  )

  assert.deepStrictEqual (calls, [[1]])
})

test ('ap: passes only the value to the wrapped function', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return 1
  }

  await outcomeOf (
    F.resolve<string, number> (1).ap (
      F.resolve<string, typeof recordArguments> (recordArguments),
    ),
  )

  assert.deepStrictEqual (calls, [[1]])
})

test ('ply.ap: passes only the value to the wrapped function', async () => {
  const calls: unknown[][] = []

  function recordArguments(...args: unknown[]) {
    calls.push (args)
    return 2
  }

  await outcomeOf (
    P.ap (F.resolve<string, typeof recordArguments> (recordArguments)) (
      F.resolve<string, number> (1),
    ),
  )

  assert.deepStrictEqual (calls, [[1]])
})

test ('ply operations: composing a task does not start it', async () => {
  let runs = 0

  function executeTask(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    runs += 1
    onResolved (1)
  }

  const base = F.future<string, number> (executeTask)
  const step1 = P.map (increment) (base)

  function resolveDouble(value: number): F.Future<string, number> {
    return F.resolve (value * 2)
  }

  const step2 = P.chain (resolveDouble) (step1)

  function keepError(error: string) {
    return error
  }

  function keepValue(value: number) {
    return value
  }

  const step3 = P.bimap (keepError) (keepValue) (step2)
  const step4 = P.alt (F.resolve (0)) (step3)

  assert.deepStrictEqual (runs, 0)
  assert.deepStrictEqual (await outcomeOf (step4), { ok: 4 })
  assert.deepStrictEqual (runs, 1)
})

test ('Future.of: creates the same task as resolve', async () => {
  assert.deepStrictEqual (F.Future['@@type'], 'Future')
  assert.deepStrictEqual (await outcomeOf (F.Future.of<string, number> (7)), { ok: 7 })
  assert.deepStrictEqual (await outcomeOf (P.of (F.Future) (7)), { ok: 7 })
  assert.deepStrictEqual (
    await outcomeOf (F.Future.of<string, number> (7)),
    await outcomeOf (F.resolve<string, number> (7)),
  )
})

test ('Future: the public class recognizes every task variant', async () => {
  const success = F.resolve<string, number> (7)
  const failure = F.reject<string, number> ('missing')
  const { is, of } = F.Future

  assert.deepStrictEqual (F.Future.name, 'Future')
  assert.deepStrictEqual (success instanceof F.Future, true)
  assert.deepStrictEqual (failure instanceof F.Future, true)
  assert.deepStrictEqual (is (success), true)
  assert.deepStrictEqual (is (failure), true)
  assert.deepStrictEqual (is ({ fork() {} }), false)
  assert.deepStrictEqual (await outcomeOf (of<string, number> (7)), { ok: 7 })
})

test ('Future: has no zero or empty operation', () => {
  const rep = F.Future as unknown as Record<string, unknown>

  assert.deepStrictEqual (rep.zero, undefined)
  assert.deepStrictEqual (rep.empty, undefined)
})

test ('coalesce: the result has no rejection type', async () => {
  function onRejected(e: string) {
    return 'rejected:' + e
  }

  function onResolved(a: number) {
    return 'resolved:' + a
  }

  const safe: F.Future<never, string> = F.coalesce (onRejected) (onResolved) (
    F.reject<string, number> ('ow'),
  )

  assert.deepStrictEqual (await outcomeOf (safe), { ok: 'rejected:ow' })
})

test ('ply.map: transforms a Future value', async () => {
  assert.deepStrictEqual (
    await outcomeOf (P.map (doubleNumber) (F.resolve<string, number> (5))),
    {
      ok: 10,
    },
  )
})

test ('ply.ap: applies a wrapped function to a Future value', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      P.ap (F.resolve<string, (n: number) => number> ((n) => n * 3)) (
        F.resolve<string, number> (5),
      ),
    ),
    { ok: 15 },
  )
})

test ('ply.ap: preserves the first argument’s rejection', async () => {
  const both = P.ap (F.reject<string, (n: number) => number> ('first')) (
    F.reject<string, number> ('second'),
  ) as F.Future<string, number>
  const got = await new Promise<string> ((resolve) =>
    both.fork (resolve, () => resolve ('resolved?!')),
  )

  assert.deepStrictEqual (got, 'first')
})

test ('ply.bimap: transforms the error', async () => {
  function multiplyByFive(value: number) {
    return value * 5
  }

  const source = F.reject<string, number> ('ow')
  const transformed = P.bimap (addExclamation) (multiplyByFive) (source)

  assert.deepStrictEqual (await outcomeOf (transformed), { err: 'ow!' })
})

test ('ply.mapLeft: preserves a successful value', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      P.mapLeft (addExclamation) (F.resolve<string, number> (1)) as F.Future<
        string,
        number
      >,
    ),
    { ok: 1 },
  )
})

test ('ply.alt: uses the fallback after rejection', async () => {
  assert.deepStrictEqual (
    await outcomeOf (
      P.alt (F.resolve<string, number> (9)) (F.reject<string, number> ('no')),
    ),
    { ok: 9 },
  )
})

test ('ply.show: formats tasks inside an array', () => {
  assert.deepStrictEqual (
    P.show ([F.resolve<string, number> (1), F.reject<string, number> ('e')]),
    '[Future, Future]',
  )
})

test ('lte: rejects Future as an unsupported type', () => {
  const task = F.resolve<string, number> (1)
  assert.throws (
    () => P.lte (task as never) (task as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('has no Ord'),
  )
})

test ('reduce: rejects Future as an unsupported type', () => {
  const task = F.resolve<string, number> (1)
  assert.throws (
    () => P.reduce ((acc: number, n: number) => acc + n) (0) (task as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('reduce: Future has no Foldable'),
  )
})

test ('concat: rejects Future as an unsupported type', () => {
  const task = F.resolve<string, number> (1)
  assert.throws (
    () => P.concat (task as never) (task as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('concat: Future has no Semigroup'),
  )
})

test ('filter: rejects Future as an unsupported type', () => {
  const task = F.resolve<string, number> (1)
  assert.throws (
    () => P.filter (() => true) (task as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('filter: Future has no Filterable'),
  )
})

test ('traverse: rejects Future as an unsupported type', () => {
  const task = F.resolve<string, number> (1)
  assert.throws (
    () => P.traverse (F.Future as never) ((a: never) => a) (task as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('traverse: Future has no Traversable'),
  )
})

test ('zero: rejects Future as an unsupported type', () => {
  assert.throws (
    () => P.zero (F.Future as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('zero: Future has no Plus'),
  )
})

test ('empty: rejects Future as an unsupported type', () => {
  assert.throws (
    () => P.empty (F.Future as never),
    (error: unknown) => error instanceof TypeError && error.message.includes ('empty: Future has no Monoid'),
  )
})

test ('Future: every kind of task shares the methods and the representative', () => {
  const sample = F.resolve<string, number> (1)
  const kinds: F.Future<unknown, unknown>[] = [
    sample,
    F.reject<string, number> ('e'),
    F.future<string, number> (() => {}),
    F.swap (sample),
    sample.map (doubleNumber),
    sample.chain (() => sample),
    F.never,
    F.cache (sample),
    F.parallel (2) ([sample]),
    F.both (sample) (sample),
    F.race (sample) (sample),
    F.attempt (() => 1),
    F.attemptP (() => Promise.resolve (1)),
    F.after (1) (1),
    F.lastly (sample) (sample),
    F.mapRej (String) (sample),
    F.rejectAfter (1) ('e'),
    sample.bimap (String, doubleNumber),
    F.chainRej (() => sample) (sample),
    F.bichain (() => sample) (() => sample) (sample),
    F.coalesce (String) (String) (sample),
    sample.alt (sample),
    sample.ap (F.resolve<string, (n: number) => number> (doubleNumber)),
  ] as F.Future<unknown, unknown>[]

  for (const task of kinds) {
    const own = task as unknown as Record<string, unknown>
    assert.deepStrictEqual (F.isFuture (task), true)
    for (const m of ['fork', 'map', 'ap', 'chain', 'bimap', 'alt', 'show']) {
      assert.deepStrictEqual (typeof own[m], 'function', m)
      assert.deepStrictEqual (Object.hasOwn (task, m), false, m)
    }
    for (
      const m of [
        'equals',
        'lte',
        'reduce',
        'traverse',
        'concat',
        'empty',
        'filter',
        'zero',
      ]
    ) {
      assert.deepStrictEqual (typeof own[m], 'undefined', m)
    }
    const rep = task.constructor
    assert.deepStrictEqual (Object.getPrototypeOf (rep), F.Future)
    assert.deepStrictEqual (rep['@@type'], 'Future')
    let got: number | undefined
    rep.of<never, number> (3).fork (() => {}, (a) => got = a)
    assert.deepStrictEqual (got, 3)
  }

  assert.deepStrictEqual (Object.keys (sample as unknown as object), ['value'])
  assert.deepStrictEqual (Object.keys (sample.map (doubleNumber) as unknown as object), [
    'source',
    'transformations',
  ])
})

test ('map: infers the transformed value type', async () => {
  const slotA: F.Future<string, boolean> = F.resolve<string, number> (1).map ((
    n,
  ) => n > 0)

  assert.deepStrictEqual (await outcomeOf (slotA), { ok: true })
})

test ('bimap: infers the transformed error and value types', async () => {
  function transformValue(n: number) {
    return n > 0
  }

  const slotB: F.Future<number, boolean> = F.reject<string, number> ('broken')
    .bimap ((e) => e.length, transformValue)

  assert.deepStrictEqual (await outcomeOf (slotB), { err: 6 })
})

test ('equals: rejects distinct Future values', () => {
  assert.throws (
    () =>
      P.equals (F.resolve<string, number> (1) as never) (
        F.resolve<string, number> (1) as never,
      ),
    (error: unknown) => error instanceof TypeError && error.message.includes ('Future has no Setoid'),
  )
})

test ('lte: rejects Future values', () => {
  assert.throws (
    () =>
      P.lte (F.resolve<string, number> (1) as never) (
        F.resolve<string, number> (1) as never,
      ),
    (error: unknown) => error instanceof TypeError && error.message.includes ('lte: Future has no Ord'),
  )
})

test ('equals: recognizes the same Future reference', () => {
  const task = F.resolve<string, number> (1)

  assert.deepStrictEqual (P.equals (task as never) (task as never), true)
})

function identityValue<A>(a: A): A {
  return a
}

function increment(n: number): number {
  return n + 1
}

function doubleNumber(n: number): number {
  return n * 2
}

function stringLength(s: string): number {
  return s.length
}

function addExclamation(s: string): string {
  return s + '!'
}

type Outcome =
  | { readonly ok: unknown }
  | { readonly err: unknown }
  | { readonly timeout: true }

const TEST_TIMEOUT_MS = 2000

function delay(ms: number): Promise<void> {
  return new Promise ((resolve) => setTimeout (resolve, ms))
}

function label(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify (v)
}

test ('map: what the function throws crashes instead of rejecting', async () => {
  function broken(_value: number): number {
    throw new Error ('not today')
  }

  assert.deepStrictEqual (
    await channelOf (P.map (broken) (F.resolve<string, number> (1))),
    { crash: 'Error: not today' },
  )
})

test ('chain: what the function throws crashes instead of rejecting', async () => {
  function broken(_value: number): F.Future<string, number> {
    throw new Error ('not today')
  }

  assert.deepStrictEqual (
    await channelOf (P.chain (broken) (F.resolve<string, number> (1))),
    { crash: 'Error: not today' },
  )
})

test ('chain: a crash arrives from a continuation that waited', async () => {
  function broken(_done: void): F.Future<string, number> {
    throw new Error ('interrupted')
  }

  const late = P.chain (broken) (F.after (0)<string, void> (undefined))

  assert.deepStrictEqual (await channelOf (late), { crash: 'Error: interrupted' })
})

test ('ap: what the function throws crashes', async () => {
  function broken(_value: number): number {
    throw new Error ('not today')
  }

  assert.deepStrictEqual (
    await channelOf (
      P.ap (F.resolve<string, (value: number) => number> (broken)) (
        F.resolve<string, number> (1),
      ),
    ),
    { crash: 'Error: not today' },
  )
})

test ('bimap: a throwing handler crashes on either side', async () => {
  function broken(_x: unknown): never {
    throw new Error ('not today')
  }

  function keep(value: number): number {
    return value
  }

  assert.deepStrictEqual (
    await channelOf (P.bimap (broken) (keep) (F.reject<string, number> ('e'))),
    { crash: 'Error: not today' },
  )
  assert.deepStrictEqual (
    await channelOf (P.bimap (keep) (broken) (F.resolve<number, number> (1))),
    { crash: 'Error: not today' },
  )
})

test ('alt: a crash walks past the fallback', async () => {
  let tried = 0

  function count(): F.Future<string, number> {
    tried += 1
    return F.resolve<string, number> (2)
  }

  function broken(_value: number): number {
    throw new Error ('not today')
  }

  const crashing = P.map (broken) (F.resolve<string, number> (1))

  assert.deepStrictEqual (await channelOf (P.alt (count ()) (crashing)), {
    crash: 'Error: not today',
  })
  assert.deepStrictEqual (tried, 1)
})

test ('coalesce: a crash walks past a task with no rejection channel', async () => {
  function broken(_value: number): string {
    throw new Error ('not today')
  }

  function describe(error: string): string {
    return 'failed: ' + error
  }

  const folded = F.coalesce (describe) (broken) (F.resolve<string, number> (1))

  assert.deepStrictEqual (await channelOf (folded), { crash: 'Error: not today' })
})

test ('mapRej: a throwing handler crashes', async () => {
  function broken(_error: string): string {
    throw new Error ('not today')
  }

  assert.deepStrictEqual (
    await channelOf (F.mapRej (broken) (F.reject<string, number> ('e'))),
    { crash: 'Error: not today' },
  )
})

test ('chainRej: a throwing handler crashes', async () => {
  function broken(_error: string): F.Future<string, number> {
    throw new Error ('not today')
  }

  assert.deepStrictEqual (
    await channelOf (F.chainRej (broken) (F.reject<string, number> ('e'))),
    { crash: 'Error: not today' },
  )
})

test ('bichain: a throwing handler crashes', async () => {
  function broken(_value: number): F.Future<string, number> {
    throw new Error ('not today')
  }

  function recover(_error: string): F.Future<string, number> {
    return F.resolve (0)
  }

  assert.deepStrictEqual (
    await channelOf (F.bichain (recover) (broken) (F.resolve<string, number> (1))),
    { crash: 'Error: not today' },
  )
})

test ('promise: a crash arrives as a rejected promise', async () => {
  function broken(_value: number): number {
    throw new Error ('not today')
  }

  const said = await F.promise (P.map (broken) (F.resolve<string, number> (1)))
    .then (() => 'resolved', (e: unknown) => String (e))

  assert.deepStrictEqual (said, 'Error: not today')
})

test ('future: what the body throws after answering wins', async () => {
  function answerThenBreak(
    _onRejected: (error: string) => void,
    onResolved: (value: number) => void,
  ) {
    onResolved (1)
    throw new Error ('too late to be right')
  }

  assert.deepStrictEqual (await channelOf (F.future<string, number> (answerThenBreak)), {
    crash: 'Error: too late to be right',
  })
})

test ('cache: a crash is shared and the work runs once', async () => {
  let runs = 0

  function countRuns(value: number): number {
    runs += 1
    throw new Error ('run ' + String (value))
  }

  const once = F.cache (P.map (countRuns) (F.resolve<string, number> (1)))

  assert.deepStrictEqual (await channelOf (once), { crash: 'Error: run 1' })
  assert.deepStrictEqual (await channelOf (once), { crash: 'Error: run 1' })
  assert.deepStrictEqual (runs, 1)
})

test ('attempt: what the thunk throws is still a rejection', async () => {
  function broken(): number {
    throw new Error ('not today')
  }

  assert.deepStrictEqual (await channelOf (F.attempt<unknown, number> (broken)), {
    err: 'Error: not today',
  })
})

function channelOf<E, A>(
  task: F.Future<E, A>,
  ms = TEST_TIMEOUT_MS,
): Promise<
  { crash: string } | { err: string } | { ok: A } | { timeout: true }
> {
  return new Promise ((resolve) => {
    const timer = setTimeout (() => resolve ({ timeout: true }), ms)

    function settle(
      o: { crash: string } | { err: string } | { ok: A } | { timeout: true },
    ) {
      clearTimeout (timer)
      resolve (o)
    }

    F.forkCatch ((e: unknown) => settle ({ crash: String (e) })) (
      (e: E) => settle ({ err: String (e) }),
    ) ((a: A) => settle ({ ok: a })) (task)
  })
}

function outcomeOf<E, A>(
  task: F.Future<E, A>,
  ms = TEST_TIMEOUT_MS,
): Promise<Outcome> {
  return new Promise<Outcome> ((resolve) => {
    const timer = setTimeout (() => resolve ({ timeout: true }), ms)

    function settle(o: Outcome) {
      clearTimeout (timer)
      resolve (o)
    }

    task.fork ((e) => settle ({ err: e }), (a) => settle ({ ok: a }))
  })
}

function observeOutcomes<E, A>(
  task: F.Future<E, A>,
  ms = 60,
): Promise<string[]> {
  const log: string[] = []
  task.fork (
    (e) => {
      log.push ('rej:' + label (e))
    },
    (a) => {
      log.push ('res:' + label (a))
    },
  )
  return delay (ms).then (() => log)
}

function resolveAfter<A>(ms: number, a: A): F.Future<string, A> {
  return F.future<string, A> ((_onRejected, onResolved) => {
    setTimeout (() => onResolved (a), ms)
  })
}

function rejectAfter<A>(ms: number, e: string): F.Future<string, A> {
  return F.future<string, A> ((onRejected) => {
    setTimeout (() => onRejected (e), ms)
  })
}

interface Tracker {
  readonly resolveAfter: <A>(ms: number, a: A) => F.Future<string, A>
  readonly rejectAfter: <A>(ms: number, e: string) => F.Future<string, A>
  readonly startedCount: () => number
  readonly maxConcurrent: () => number
  readonly completedLabels: () => string[]
}

function trackTasks(): Tracker {
  let startedCount = 0
  let runningCount = 0
  let maxConcurrent = 0
  const completedLabels: string[] = []

  function enter() {
    startedCount += 1
    runningCount += 1
    if (runningCount > maxConcurrent) maxConcurrent = runningCount
  }

  function leave(name: string) {
    runningCount -= 1
    completedLabels.push (name)
  }

  return {
    resolveAfter: <A>(ms: number, a: A) =>
      F.future<string, A> ((_onRejected, onResolved) => {
        enter ()
        const timer = setTimeout (() => {
          leave (label (a))
          onResolved (a)
        }, ms)
        return () => {
          clearTimeout (timer)
          runningCount -= 1
        }
      }),
    rejectAfter: <A>(ms: number, e: string) =>
      F.future<string, A> ((onRejected) => {
        enter ()
        const timer = setTimeout (() => {
          leave ('!' + e)
          onRejected (e)
        }, ms)
        return () => {
          clearTimeout (timer)
          runningCount -= 1
        }
      }),
    startedCount: () => startedCount,
    maxConcurrent: () => maxConcurrent,
    completedLabels: () => completedLabels.slice (),
  }
}

function lengthAfterExclamation(error: string): number {
  return stringLength (addExclamation (error))
}

function doubleThenIncrement(value: number): number {
  return increment (doubleNumber (value))
}
