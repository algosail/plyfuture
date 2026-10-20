import type {
  AltMethods,
  ApplicativeTypeRep,
  ApplyMethods,
  CheckableTypeRep,
  FunctorMethods,
  PlusTypeRep,
  Satisfies,
  Shape,
  Shaped,
  ShowMethods,
} from '@algosail/ply/define'
import { Future, Never, Parallel, Raced } from './future.ts'

/** Pass `Par` to ply when `ap` and `alt` should run in parallel. */
export interface ConcurrentFutureShape extends Shape<'ConcurrentFuture'> {
  readonly out: ConcurrentFuture<this['slotB'], this['slotA']>
}

/** `is`, `of`, and `zero` on the parallel representative. */
export interface ConcurrentFutureStatics {
  is(value: unknown): value is ConcurrentFuture<unknown, unknown>
  of<E, A>(value: A): ConcurrentFuture<E, A>
  zero<E, A>(): ConcurrentFuture<E, A>
}

/** The `Par` value ply accepts as a type representative. */
export type ConcurrentFutureTypeRep = Satisfies<
  ConcurrentFutureStatics & Shaped<ConcurrentFutureShape>,
  & ApplicativeTypeRep<ConcurrentFutureShape, unknown>
  & PlusTypeRep<ConcurrentFutureShape, unknown>
  & CheckableTypeRep<ConcurrentFutureShape>
>

/** A task whose `ap` runs in parallel and whose `alt` races. */
export class ConcurrentFuture<E, A>
  implements
    FunctorMethods<ConcurrentFuture<E, A>, A, E>,
    ApplyMethods<ConcurrentFuture<E, A>, A, E>,
    AltMethods<ConcurrentFuture<E, A>, A, E>,
    ShowMethods<ConcurrentFuture<E, A>, A, E> {
  declare static readonly _shape: ConcurrentFutureShape
  declare readonly '@@type': 'ConcurrentFuture'
  declare readonly _shape: ConcurrentFutureShape
  declare readonly ['constructor']: ConcurrentFutureTypeRep
  declare readonly _A?: (_: never) => A
  declare _B?: { _B?(e: E): void }['_B']

  static readonly '@@type' = 'ConcurrentFuture' as const

  static is(value: unknown): value is ConcurrentFuture<unknown, unknown> {
    return value instanceof ConcurrentFuture
  }

  static of<E, A>(value: A): ConcurrentFuture<E, A> {
    return new ConcurrentFuture (Future.of (value))
  }

  static zero<E, A>(): ConcurrentFuture<E, A> {
    return new ConcurrentFuture<E, A> (new Never<E, A> ())
  }

  readonly sequential: Future<E, A>

  constructor(sequential: Future<E, A>, name = 'ConcurrentFuture') {
    this.sequential = sequential
  }

  map<B>(f: (a: A) => B): ConcurrentFuture<E, B> {
    return new ConcurrentFuture (this.sequential.map (f))
  }

  ap<B>(ff: ConcurrentFuture<E, (a: A) => B>): ConcurrentFuture<E, B> {
    if (!(ff instanceof ConcurrentFuture)) {
      throw new TypeError ('ap: expected a ConcurrentFuture')
    }
    return new ConcurrentFuture (
      parallelApply (this.sequential, ff.sequential, 'ap'),
    )
  }

  alt(that: ConcurrentFuture<E, A>): ConcurrentFuture<E, A> {
    if (!(that instanceof ConcurrentFuture)) {
      throw new TypeError ('alt: expected a ConcurrentFuture')
    }
    return new ConcurrentFuture (new Raced (this.sequential, that.sequential))
  }

  show(): string {
    return 'ConcurrentFuture'
  }
}

export function parallelApply<E, A, B>(
  fa: Future<E, A>,
  ff: Future<E, (a: A) => B>,
  name: string,
): Future<E, B> {
  return new Parallel<E, unknown> ([ff, fa], 2, name)
    .map (([f, a]) => (f as (a: A) => B) (a as A))
}

/**
 * Wraps a task so ply's `ap` runs in parallel and `alt` races.
 * @example
 * ```ts
 * import * as P from '@algosail/ply'
 * import { after, Par, promise, seq } from '@algosail/plyfuture'
 *
 * const result = P.ap (Par (after (1) ((n: number) => n * 2))) (Par (after (1) (3)))
 * await promise (seq (result)) // => 6
 * ```
 */
export const Par = Object.assign (
  function Par<E, A>(future: Future<E, A>): ConcurrentFuture<E, A> {
    return new ConcurrentFuture (future, 'Par')
  },
  {
    '@@type': 'ConcurrentFuture' as const,
    is: ConcurrentFuture.is,
    of: ConcurrentFuture.of,
    zero: ConcurrentFuture.zero,
  },
) as typeof ParConstructor & ConcurrentFutureTypeRep

declare function ParConstructor<E, A>(
  future: Future<E, A>,
): ConcurrentFuture<E, A>

/** Unwraps a parallel task so it can be forked or passed to `promise`. */
export function seq<E, A>(future: ConcurrentFuture<E, A>): Future<E, A> {
  if (!(future instanceof ConcurrentFuture)) {
    throw new TypeError ('seq: expected a ConcurrentFuture')
  }
  return future.sequential
}
