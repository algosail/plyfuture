import type { Pair } from '@algosail/ply/pair'
import { is } from '@algosail/ply/checkable'
import { finiteFrom, integerFrom } from '@algosail/ply/define'
import { pair } from '@algosail/ply/pair'

import type { Cancel } from './interpreter.ts'
import { parallelApply } from './concurrent.ts'
import {
  After,
  Attempted,
  AttemptedP,
  Cached,
  Computation,
  Future,
  Never,
  Parallel,
  Raced,
  RejectAfter,
  Rejected,
  Resolved,
} from './future.ts'
import { Hook } from './resource.ts'
import {
  BichainTransformation,
  ChainRejTransformation,
  CoalesceTransformation,
  LastlyTransformation,
  MapRejTransformation,
  SwapTransformation,
} from './transformation.ts'
export type { Cancel } from './interpreter.ts'
export { ConcurrentFuture, seq } from './concurrent.ts'
export type {
  ConcurrentFutureShape,
  ConcurrentFutureTypeRep,
} from './concurrent.ts'
import type { FutureExecutor } from './future.ts'

export type { FutureShape } from './future.ts'
export type { FutureTypeRep } from './future.ts'
export type { FutureStatics } from './future.ts'
export type { FutureMethods } from './future.ts'
export type { FutureExecutor } from './future.ts'

export { Future }

/**
 * Creates a lazy task.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * function readAnswer(_onRejected: (error: string) => void, onResolved: (value: number) => void) {
 *   onResolved (42)
 * }
 *
 * const answer = F.future (readAnswer) // readAnswer has not run yet
 * await F.promise (answer) // => 42
 * ```
 */
export function future<E, A>(executor: FutureExecutor<E, A>): Future<E, A> {
  return new Computation (executor)
}

/**
 * Creates a task that succeeds with `a`.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const answer = F.resolve<string, number> (42)
 * await F.promise (answer) // => 42
 * ```
 */
export function resolve<E, A>(a: A): Future<E, A> {
  return new Resolved<E, A> (a)
}

/**
 * Creates a task that fails with `e`.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const failure = F.reject<string, number> ('not found')
 * await F.promise (failure).catch (String) // => 'not found'
 * ```
 */
export function reject<E, A>(e: E): Future<E, A> {
  return new Rejected<E, A> (e)
}

/**
 * Returns whether `x` is a Future from this package.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const value: unknown = F.resolve<string, number> (42)
 *
 * if (F.isFuture (value)) {
 *   await F.promise (value) // => 42
 * }
 *
 * F.isFuture ({ fork() {} }) // => false
 * ```
 */
export const isFuture = is (Future)

/**
 * Runs a task, calling one of the two handlers.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * function reportError(error: string): void {
 *   console.log ('Failed:', error)
 * }
 *
 * function reportValue(value: number): void {
 *   console.log ('Result:', value)
 * }
 *
 * const answer = F.resolve<string, number> (42)
 * F.fork (reportError) (reportValue) (answer) // logs: Result: 42
 * ```
 */
export function fork<E>(onRejected: (e: E) => void) {
  return <A>(onResolved: (a: A) => void) =>
    (t: Future<E, A>): Cancel =>
      t.fork (onRejected, onResolved)
}

/**
 * Runs a task with separate handlers for a thrown exception, a rejection, and a success.
 * @example
 * ```ts
 * import * as P from '@algosail/ply'
 * import * as F from '@algosail/plyfuture'
 *
 * function broken(_value: number): number {
 *   throw new Error ('not today')
 * }
 *
 * const task = P.map (broken) (F.resolve<string, number> (1))
 *
 * function reportCrash(error: unknown): void {
 *   console.log ('crashed:', String (error))
 * }
 *
 * function reportError(error: string): void {
 *   console.log ('rejected:', error)
 * }
 *
 * function reportValue(value: number): void {
 *   console.log ('resolved:', value)
 * }
 *
 * F.forkCatch (reportCrash) (reportError) (reportValue) (task)
 * // logs: crashed: Error: not today
 * ```
 */
export function forkCatch(onCrashed: (e: unknown) => void) {
  return <E>(onRejected: (e: E) => void) =>
    <A>(onResolved: (a: A) => void) =>
    (t: Future<E, A>): Cancel =>
      t._run (onCrashed, onRejected, onResolved)
}

/**
 * Runs a task and returns a Promise of its success value.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const answer = F.resolve<string, number> (42)
 * await F.promise (answer) // => 42
 *
 * const failure = F.reject<string, number> ('not found')
 * await F.promise (failure).catch (String) // => 'not found'
 * ```
 */
export function promise<E, A>(t: Future<E, A>): Promise<A> {
  return new Promise<A> ((resolve, reject) => t._run (reject, reject, resolve))
}

/**
 * Creates a task from a function that returns a Promise.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * function loadName(): Promise<string> {
 *   return Promise.resolve ('Ada')
 * }
 *
 * const name = F.attemptP (loadName)
 * await F.promise (name) // => 'Ada'
 * ```
 */
export function attemptP<A>(makePromise: () => Promise<A>): Future<unknown, A> {
  return new AttemptedP (makePromise)
}

/**
 * Runs both tasks and keeps the first success or failure.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const ready = F.resolve<string, string> ('ready')
 * const first = F.race (ready) (F.never)
 *
 * await F.promise (first) // => 'ready'
 * ```
 */
export function race<E, A>(a: Future<E, A>) {
  return (b: Future<E, A>): Future<E, A> => new Raced (a, b)
}

/**
 * Runs both tasks and returns a Pair in argument order.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const count = F.resolve<string, number> (2)
 * const name = F.resolve<string, string> ('Ada')
 * const result = F.both (count) (name)
 *
 * await F.promise (result) // => Pair (2) ("Ada")
 * ```
 */
export function both<E, A>(a: Future<E, A>) {
  return <B>(b: Future<E, B>): Future<E, Pair<A, B>> => {
    return new Parallel<E, unknown> ([a, b], 2, 'both')
      .map (([x, y]) => pair (x as A, y as B))
  }
}

/**
 * Runs at most `concurrency` tasks at once and returns results in input order.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const tasks = [
 *   F.after (3) ('first'),
 *   F.after (1) ('second'),
 *   F.after (2) ('third'),
 * ]
 * const results = F.parallel (2) (tasks)
 *
 * await F.promise (results) // => ['first', 'second', 'third']
 * ```
 */
export function parallel(concurrency: number) {
  if (concurrency !== Number.POSITIVE_INFINITY) {
    integerFrom ('parallel', 1, concurrency)
  }

  return <E, A>(fs: readonly Future<E, A>[]): Future<E, A[]> => {
    if (!Array.isArray (fs)) {
      throw new TypeError ('parallel: expected an array of Futures')
    }
    return new Parallel (fs.slice (), concurrency)
  }
}

/**
 * Succeeds with `a` after `ms` milliseconds.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const delayedAnswer = F.after (10) (42)
 * await F.promise (delayedAnswer) // => 42
 * ```
 */
export function after(ms: number) {
  finiteFrom ('after', 0, ms)
  return <E, A>(a: A): Future<E, A> => new After<E, A> (ms, a)
}

/**
 * Fails with `e` after `ms` milliseconds.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const timeout = F.rejectAfter (10) ('timed out')
 * await F.promise (timeout).catch (String) // => 'timed out'
 * ```
 */
export function rejectAfter(ms: number) {
  finiteFrom ('rejectAfter', 0, ms)
  return <E, A>(e: E): Future<E, A> => new RejectAfter<E, A> (ms, e)
}

/**
 * A task that stays pending.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const ready = F.resolve<string, number> (42)
 * await F.promise (F.race<string, number> (F.never) (ready)) // => 42
 * ```
 */
export const never: Future<never, never> = new Never ()

/**
 * Creates a task from a synchronous function.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * function readCount(): number {
 *   return JSON.parse ('{"count": 2}').count
 * }
 *
 * const count = F.attempt<unknown, number> (readCount)
 * await F.promise (count) // => 2
 * ```
 */
export function attempt<E, A>(thunk: () => A): Future<E, A> {
  return new Attempted<E, A> (thunk)
}

/**
 * Applies `f` to a rejection.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * function explainError(error: string): string {
 *   return `Request failed: ${error}`
 * }
 *
 * const request = F.reject<string, number> ('offline')
 * const explained = F.mapRej (explainError) (request)
 *
 * await F.promise (explained).catch (String) // => 'Request failed: offline'
 * ```
 */
export function mapRej<E, F>(f: (e: E) => F) {
  return <A>(fa: Future<E, A>): Future<F, A> =>
    fa._transform (new MapRejTransformation (f))
}

/**
 * On rejection, continues with the task returned by `f`.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * function useDefault(_error: string): F.Future<never, number> {
 *   return F.resolve (0)
 * }
 *
 * const request = F.reject<string, number> ('offline')
 * const recovered = F.chainRej (useDefault) (request)
 *
 * await F.promise (recovered) // => 0
 * ```
 */
export function chainRej<E, F, A>(f: (e: E) => Future<F, A>) {
  return (fa: Future<E, A>): Future<F, A> =>
    fa._transform (new ChainRejTransformation (f))
}

/**
 * On rejection or success, continues with the task returned by that handler.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * function recover(_error: string): F.Future<never, number> {
 *   return F.resolve (0)
 * }
 *
 * function increment(value: number): F.Future<never, number> {
 *   return F.resolve (value + 1)
 * }
 *
 * const continueWith = F.bichain (recover) (increment)
 * await F.promise (continueWith (F.reject<string, number> ('offline'))) // => 0
 * await F.promise (continueWith (F.resolve<string, number> (2))) // => 3
 * ```
 */
export function bichain<E, F, B>(onRejected: (e: E) => Future<F, B>) {
  return <A>(onResolved: (a: A) => Future<F, B>) =>
    (fa: Future<E, A>): Future<F, B> =>
      fa._transform (new BichainTransformation (onRejected, onResolved))
}

/**
 * Turns a rejection or a success into a successful value.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * function describeFailure(error: string): string {
 *   return `Failed: ${error}`
 * }
 *
 * function describeSuccess(value: number): string {
 *   return `Found: ${value}`
 * }
 *
 * const describe = F.coalesce (describeFailure) (describeSuccess)
 * await F.promise (describe (F.reject<string, number> ('offline'))) // => 'Failed: offline'
 * await F.promise (describe (F.resolve<string, number> (2))) // => 'Found: 2'
 * ```
 */
export function coalesce<E, B>(onRejected: (e: E) => B) {
  return <A>(onResolved: (a: A) => B) =>
    (fa: Future<E, A>): Future<never, B> =>
      fa._transform (new CoalesceTransformation (onRejected, onResolved))
}

/**
 * Runs `cleanup` after success or rejection, then keeps the original outcome.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const events: string[] = []
 *
 * function close(): void {
 *   events.push ('closed')
 * }
 *
 * const cleanup = F.attempt<unknown, void> (close)
 * const request = F.resolve<string, number> (42)
 * const withCleanup = F.lastly (cleanup) (request)
 *
 * await F.promise (withCleanup) // => 42
 * events // => ['closed']
 * ```
 */
export function lastly<C>(cleanup: Future<C, unknown>) {
  return <E, A>(fa: Future<E, A>): Future<E | C, A> =>
    fa._transform (new LastlyTransformation (cleanup))
}

/**
 * Shares one run and its outcome, including a thrown exception.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * let runs = 0
 *
 * function nextNumber(): number {
 *   runs += 1
 *   return runs
 * }
 *
 * const once = F.cache (F.attempt<unknown, number> (nextNumber))
 * await F.promise (once) // => 1
 * await F.promise (once) // => 1
 * runs // => 1
 * ```
 */
export function cache<E, A>(fa: Future<E, A>): Future<E, A> {
  return new Cached (fa)
}

/**
 * Swaps the failure and the success.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const failure = F.reject<string, number> ('offline')
 * await F.promise (F.swap (failure)) // => 'offline'
 *
 * const success = F.resolve<number, string> ('ready')
 * await F.promise (F.swap (success)).catch (String) // => 'ready'
 * ```
 */
export function swap<E, A>(fa: Future<E, A>): Future<A, E> {
  return fa._transform (new SwapTransformation ())
}

/**
 * Applies a function to a value, running both tasks at the same time.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const task = F.pap (F.after (1) (4)) (F.after (1) ((n: number) => n + 1))
 * await F.promise (task) // => 5
 * ```
 */
export function pap<E, A>(fa: Future<E, A>) {
  return <B>(ff: Future<E, (a: A) => B>): Future<E, B> => parallelApply (fa, ff, 'pap')
}

/**
 * Acquires a resource, uses it, then disposes of it.
 * @example
 * ```ts
 * import * as F from '@algosail/plyfuture'
 *
 * const released: string[] = []
 * const task = F.hook (F.resolve ('resource')) (
 *   (resource) => F.attempt (() => { released.push (resource) }),
 * ) ((resource) => F.resolve (resource.length))
 * await F.promise (task) // => 8
 * released // => ['resource']
 * ```
 */
export function hook<E, R>(acquire: Future<E, R>) {
  return <D>(dispose: (resource: R) => Future<D, unknown>) =>
    <F, A>(consume: (resource: R) => Future<F, A>): Future<E | F, A> => {
      return new Hook (acquire, dispose, consume)
    }
}
