import type { Step } from '@algosail/ply/chainrec'
import type {
  AltMethods,
  ApplicativeTypeRep,
  ApplyMethods,
  BifunctorMethods,
  ChainMethods,
  ChainRecTypeRep,
  CheckableTypeRep,
  FunctorMethods,
  Satisfies,
  Shape,
  Shaped,
  ShowMethods,
} from '@algosail/ply/define'
import type { Cancel, Canceller, Outcome } from './interpreter.ts'
import type { Transformation } from './transformation.ts'
import {
  deliver,
  interpret,
  noop,
  raise,
  type Scheduler,
} from './interpreter.ts'
import {
  AltTransformation,
  ApTransformation,
  BimapTransformation,
  ChainTransformation,
  MapTransformation,
} from './transformation.ts'

/** Pass `Future` to generic ply functions such as `P.map` and `P.chain`. */
export interface FutureShape extends Shape<'Future'> {
  readonly out: Future<this['slotB'], this['slotA']>
}

/** The `Future` value ply accepts as a type representative. */
export type FutureTypeRep = Satisfies<
  FutureStatics & Shaped<FutureShape>,
  & ApplicativeTypeRep<FutureShape, unknown>
  & CheckableTypeRep<FutureShape>
  & ChainRecTypeRep<FutureShape, unknown>
>

/** Static operations provided by the `Future` representative. */
export interface FutureStatics {
  is(value: unknown): value is Future<unknown, unknown>
  of<E, A>(a: A): Future<E, A>
  chainRec<Loop, E, A>(
    f: (value: Loop) => Future<E, Step<Loop, A>>,
    init: Loop,
  ): Future<E, A>
}

/** Methods available on `Future` values. */
export interface FutureMethods<E, A>
  extends
    ShowMethods<Future<E, A>, A, E>,
    FunctorMethods<Future<E, A>, A, E>,
    ApplyMethods<Future<E, A>, A, E>,
    ChainMethods<Future<E, A>, A, E>,
    AltMethods<Future<E, A>, A, E>,
    BifunctorMethods<Future<E, A>, A, E> {
  readonly '@@type': 'Future'
  readonly _shape: FutureShape
  readonly constructor: FutureTypeRep
  readonly _A?: (_: never) => A
  _B?(_: E): void
}

/** Reports the outcome of a {@link future}. */
export type FutureExecutor<E, A> = (
  onRejected: (e: E) => void,
  onResolved: (a: A) => void,
) => void | Cancel

export abstract class Future<E, A> implements FutureMethods<E, A> {
  declare static readonly _shape: FutureShape
  declare readonly '@@type': 'Future'
  declare readonly _shape: FutureShape
  declare readonly ['constructor']: FutureTypeRep
  declare readonly _A?: (_: never) => A
  declare _B?: FutureMethods<E, A>['_B']

  static readonly '@@type' = 'Future' as const

  static is(value: unknown): value is Future<unknown, unknown> {
    return value instanceof Future
  }

  static of<E, A>(a: A): Future<E, A> {
    return new Resolved<E, A> (a)
  }

  static chainRec<Loop, E, A>(
    f: (value: Loop) => Future<E, Step<Loop, A>>,
    init: Loop,
  ): Future<E, A> {
    const advance = (step: Step<Loop, A>): Future<E, A> => {
      if (step === null || typeof step !== 'object') {
        throw new TypeError ('chainRec: expected a loop or done step')
      }
      if (step.tag === 'done') return new Resolved (step.value)
      if (step.tag !== 'loop') {
        throw new TypeError ('chainRec: expected a loop or done step')
      }
      return new Resolved<E, Loop> (step.value).chain (f).chain (advance)
    }
    return new Resolved<E, Step<Loop, A>> ({ tag: 'loop', value: init }).chain (
      advance,
    )
  }

  abstract _interpret(
    onCrash: (e: unknown) => void,
    onRejected: (e: E) => void,
    onResolved: (a: A) => void,
    scheduler: Scheduler,
  ): Cancel | void

  _run(
    onCrash: (e: unknown) => void,
    onRejected: (e: E) => void,
    onResolved: (a: A) => void,
  ): Cancel {
    return interpret (this, onCrash, onRejected, onResolved)
  }

  _transform<F, B>(step: Transformation<E, A, F, B>): Future<F, B> {
    const head = step as unknown as Transformation<
      unknown,
      unknown,
      unknown,
      unknown
    >
    if (this instanceof Transformer) {
      return new Transformer (this.source, { head, tail: this.transformations })
    }
    return new Transformer (this as Future<unknown, unknown>, {
      head,
      tail: null,
    })
  }

  fork(onRejected: (e: E) => void, onResolved: (a: A) => void): Cancel {

    return this._run (raise, onRejected, onResolved)
  }

  map<B>(f: (a: A) => B): Future<E, B> {

    return this._transform (new MapTransformation (f))
  }

  ap<B>(ff: Future<E, (a: A) => B>): Future<E, B> {
    return ff._transform (new ApTransformation (this))
  }

  chain<B>(f: (a: A) => Future<E, B>): Future<E, B> {
    return this._transform (new ChainTransformation (f))
  }

  bimap<M, B>(f: (e: E) => M, g: (a: A) => B): Future<M, B> {
    return this._transform (new BimapTransformation (f, g))
  }

  alt(that: Future<E, A>): Future<E, A> {
    return this._transform (new AltTransformation (that))
  }

  show(): string {
    return 'Future'
  }
}

export interface TransformationList {
  readonly head: Transformation<unknown, unknown, unknown, unknown>
  readonly tail: TransformationList | null
}

export class Transformer<E, A> extends Future<E, A> {
  constructor(
    readonly source: Future<unknown, unknown>,
    readonly transformations: TransformationList,
  ) {
    super ()
  }

  _interpret(): never {
    throw new Error ('Transformer must be handled by the interpreter')
  }
}

export class Resolved<E, A> extends Future<E, A> {
  constructor(readonly value: A) {
    super ()
  }

  _interpret(
    _onCrash: (e: unknown) => void,
    _onRejected: (e: E) => void,
    onResolved: (a: A) => void,
  ): void {
    onResolved (this.value)
  }
}

export class Rejected<E, A> extends Future<E, A> {
  constructor(readonly error: E) {
    super ()
  }

  _interpret(_onCrash: (e: unknown) => void, onRejected: (e: E) => void): void {
    onRejected (this.error)
  }
}

export class Never<E = never, A = never> extends Future<E, A> {
  _interpret(): void {}
}

export class Computation<E, A> extends Future<E, A> {
  constructor(readonly executor: FutureExecutor<E, A>) {
    super ()
  }

  _interpret(
    _onCrash: (e: unknown) => void,
    onRejected: (e: E) => void,
    onResolved: (a: A) => void,
  ): Cancel | void {
    const executor = this.executor
    return executor (onRejected, onResolved)
  }
}

export class AttemptedP<A> extends Future<unknown, A> {
  constructor(readonly makePromise: () => Promise<A>) {
    super ()
  }

  _interpret(
    _onCrash: (e: unknown) => void,
    onRejected: (e: unknown) => void,
    onResolved: (a: A) => void,
  ): void {
    const makePromise = this.makePromise
    let promise: Promise<A>
    try {
      promise = makePromise ()
    } catch (e) {
      onRejected (e)
      return
    }
    if (
      promise === null || promise === undefined ||
      typeof promise.then !== 'function'
    ) {
      throw new TypeError ('attemptP: expected a Promise from the function')
    }
    promise.then (onResolved, onRejected)
  }
}

export class Attempted<E, A> extends Future<E, A> {
  constructor(readonly thunk: () => A) {
    super ()
  }

  _interpret(
    _onCrash: (e: unknown) => void,
    onRejected: (e: E) => void,
    onResolved: (a: A) => void,
  ): void {
    const thunk = this.thunk
    let value: A
    try {
      value = thunk ()
    } catch (e) {
      onRejected (e as E)
      return
    }
    onResolved (value)
  }
}

export class After<E, A> extends Future<E, A> {
  constructor(readonly ms: number, readonly value: A) {
    super ()
  }

  _interpret(
    _onCrash: (e: unknown) => void,
    _onRejected: (e: E) => void,
    onResolved: (a: A) => void,
  ): Cancel {
    const timer = setTimeout (() => onResolved (this.value), this.ms)
    return () => clearTimeout (timer)
  }
}

export class RejectAfter<E, A> extends Future<E, A> {
  constructor(readonly ms: number, readonly error: E) {
    super ()
  }

  _interpret(
    _onCrash: (e: unknown) => void,
    onRejected: (e: E) => void,
  ): Cancel {
    const timer = setTimeout (() => onRejected (this.error), this.ms)
    return () => clearTimeout (timer)
  }
}

export class Raced<E, A> extends Future<E, A> {
  constructor(readonly first: Future<E, A>, readonly second: Future<E, A>) {
    super ()
  }

  _interpret(
    onCrash: (e: unknown) => void,
    onRejected: (e: E) => void,
    onResolved: (a: A) => void,
    scheduler: Scheduler,
  ): Cancel {
    let open = true
    let left = noop, right = noop
    const stop = (outcome: Outcome<E, A>): void => {
      if (!open) return
      open = false
      deliver (onCrash, onRejected, onResolved, outcome)
      left ()
      right ()
    }
    const crash = (value: unknown) => stop ({ tag: 'crash', value })
    const reject = (value: E) => stop ({ tag: 'reject', value })
    const resolve = (value: A) => stop ({ tag: 'resolve', value })
    scheduler.enqueue (() => {
      if (open) right = scheduler.fork (this.second, crash, reject, resolve)
    })
    left = scheduler.fork (this.first, crash, reject, resolve)
    return () => {
      open = false
      left ()
      right ()
    }
  }
}

export class Parallel<E, A> extends Future<E, A[]> {
  constructor(
    readonly tasks: readonly Future<E, A>[],
    readonly limit: number,
    readonly label = 'parallel',
  ) {
    super ()
  }

  _interpret(
    onCrash: (e: unknown) => void,
    onRejected: (e: E) => void,
    onResolved: (a: A[]) => void,
    scheduler: Scheduler,
  ): Cancel {
    const tasks = this.tasks
    if (tasks.length === 0) {
      onResolved ([])
      return noop
    }
    const out: A[] = new Array (tasks.length)
    const running = new Map<number, Cancel> ()
    let open = true, started = 0, finished = 0
    const cancelAll = (): void => {
      for (const cancel of running.values ()) cancel ()
      running.clear ()
    }
    const fail = (outcome: Outcome<E, A[]>): void => {
      if (!open) return
      open = false
      deliver (onCrash, onRejected, onResolved, outcome)
      cancelAll ()
    }
    let queued = false
    const queueLaunch = (): void => {
      if (queued || !open) return
      queued = true
      scheduler.enqueue (launch)
    }
    const launch = (): void => {
      queued = false
      if (!open || running.size >= this.limit || started === tasks.length) {
        return
      }
      const at = started++
      queueLaunch ()
      running.set (
        at,
        scheduler.fork (
          tasks[at],
          (value) => fail ({ tag: 'crash', value }),
          (value) => fail ({ tag: 'reject', value }),
          (value) => {
            if (!open) return
            running.delete (at)
            out[at] = value
            if (++finished === tasks.length) {
              open = false
              onResolved (out)
            } else queueLaunch ()
          },
        ),
      )
    }
    queueLaunch ()
    return () => {
      open = false
      cancelAll ()
    }
  }
}

export class Cached<E, A> extends Future<E, A> {
  private outcome: Outcome<E, A> | null = null
  private waiting = new Set<(outcome: Outcome<E, A>) => void> ()
  private cancelSource: Canceller | null = null

  constructor(readonly source: Future<E, A>) {
    super ()
  }

  _interpret(
    onCrash: (e: unknown) => void,
    onRejected: (e: E) => void,
    onResolved: (a: A) => void,
    scheduler: Scheduler,
  ): Cancel {
    if (this.outcome !== null) {
      deliver (onCrash, onRejected, onResolved, this.outcome)
      return noop
    }
    const waiting = this.waiting
    const observer = (outcome: Outcome<E, A>): void =>
      deliver (onCrash, onRejected, onResolved, outcome)
    waiting.add (observer)
    if (this.cancelSource === null) {
      const settle = (outcome: Outcome<E, A>): void => {
        if (this.waiting !== waiting) return
        this.outcome = outcome
        this.cancelSource = null
        const observers = [...waiting]
        waiting.clear ()
        for (const observer of observers) observer (outcome)
      }
      this.cancelSource = scheduler.fork (
        this.source,
        (value) => settle ({ tag: 'crash', value }),
        (value) => settle ({ tag: 'reject', value }),
        (value) => settle ({ tag: 'resolve', value }),
      )
    }
    let dropped: Canceller | null = null
    const unsubscribe: Canceller = () => {
      const cancel = dropped
      dropped = null
      cancel?. ()
    }
    unsubscribe.detach = () => {
      waiting.delete (observer)
      if (
        waiting.size === 0 && this.outcome === null && this.waiting === waiting
      ) {
        dropped = this.cancelSource
        this.cancelSource = null
        this.waiting = new Set ()
        dropped?.detach?. ()
      }
    }
    return unsubscribe
  }
}
