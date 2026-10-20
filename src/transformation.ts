import { type Future, Rejected, Resolved } from './future.ts'

export abstract class Transformation<E, A, F, B> {
  abstract readonly name: string
  abstract rejected(e: E): Future<F, B>
  abstract resolved(a: A): Future<F, B>
}

export class MapTransformation<E, A, B> extends Transformation<E, A, E, B> {
  readonly name = 'map'
  constructor(readonly f: (a: A) => B) {
    super ()
  }
  rejected(e: E): Future<E, B> {
    return new Rejected (e)
  }
  resolved(a: A): Future<E, B> {
    const f = this.f
    return new Resolved (f (a))
  }
}

export class MapRejTransformation<E, F, A> extends Transformation<E, A, F, A> {
  readonly name = 'mapRej'
  constructor(readonly f: (e: E) => F) {
    super ()
  }
  rejected(e: E): Future<F, A> {
    const f = this.f
    return new Rejected (f (e))
  }
  resolved(a: A): Future<F, A> {
    return new Resolved (a)
  }
}

export class BimapTransformation<E, A, F, B>
  extends Transformation<E, A, F, B> {
  readonly name = 'bimap'
  constructor(readonly f: (e: E) => F, readonly g: (a: A) => B) {
    super ()
  }
  rejected(e: E): Future<F, B> {
    const f = this.f
    return new Rejected (f (e))
  }
  resolved(a: A): Future<F, B> {
    const g = this.g
    return new Resolved (g (a))
  }
}

export class ChainTransformation<E, A, B> extends Transformation<E, A, E, B> {
  readonly name = 'chain'
  constructor(readonly f: (a: A) => Future<E, B>) {
    super ()
  }
  rejected(e: E): Future<E, B> {
    return new Rejected (e)
  }
  resolved(a: A): Future<E, B> {
    const f = this.f
    return f (a)
  }
}

export class ChainRejTransformation<E, F, A>
  extends Transformation<E, A, F, A> {
  readonly name = 'chainRej'
  constructor(readonly f: (e: E) => Future<F, A>) {
    super ()
  }
  rejected(e: E): Future<F, A> {
    const f = this.f
    return f (e)
  }
  resolved(a: A): Future<F, A> {
    return new Resolved (a)
  }
}

export class BichainTransformation<E, F, A, B>
  extends Transformation<E, A, F, B> {
  readonly name = 'bichain'
  constructor(
    readonly f: (e: E) => Future<F, B>,
    readonly g: (a: A) => Future<F, B>,
  ) {
    super ()
  }
  rejected(e: E): Future<F, B> {
    const f = this.f
    return f (e)
  }
  resolved(a: A): Future<F, B> {
    const g = this.g
    return g (a)
  }
}

export class CoalesceTransformation<E, A, B>
  extends Transformation<E, A, never, B> {
  readonly name = 'coalesce'
  constructor(readonly f: (e: E) => B, readonly g: (a: A) => B) {
    super ()
  }
  rejected(e: E): Future<never, B> {
    const f = this.f
    return new Resolved (f (e))
  }
  resolved(a: A): Future<never, B> {
    const g = this.g
    return new Resolved (g (a))
  }
}

export class SwapTransformation<E, A> extends Transformation<E, A, A, E> {
  readonly name = 'swap'
  rejected(e: E): Future<A, E> {
    return new Resolved (e)
  }
  resolved(a: A): Future<A, E> {
    return new Rejected (a)
  }
}

export class AltTransformation<E, A> extends Transformation<E, A, E, A> {
  readonly name = 'alt'
  constructor(readonly that: Future<E, A>) {
    super ()
  }
  rejected(_e: E): Future<E, A> {
    return this.that
  }
  resolved(a: A): Future<E, A> {
    return new Resolved (a)
  }
}

export class ApTransformation<E, A, B>
  extends Transformation<E, (a: A) => B, E, B> {
  readonly name = 'ap'
  constructor(readonly value: Future<E, A>) {
    super ()
  }
  rejected(e: E): Future<E, B> {
    return new Rejected (e)
  }
  resolved(f: (a: A) => B): Future<E, B> {
    if (typeof f !== 'function') throw new TypeError ('ap: expected a function')
    return this.value.map (f)
  }
}

export class LastlyTransformation<E, A, C>
  extends Transformation<E, A, E | C, A> {
  readonly name = 'lastly'
  constructor(readonly cleanup: Future<C, unknown>) {
    super ()
  }
  rejected(e: E): Future<E | C, A> {
    return (this.cleanup as Future<E | C, unknown>).chain (() => new Rejected (e))
  }
  resolved(a: A): Future<E | C, A> {
    return this.cleanup.map (() => a)
  }
}
