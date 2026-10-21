import type { Cancel, Canceller, Outcome, Scheduler } from './interpreter.ts'
import { Future } from './future.ts'
import { deliver, noop, raise } from './interpreter.ts'

/** Acquire a resource, use it, then dispose of it. */
export class Hook<E, R, F, A, D> extends Future<E | F, A> {
  constructor(
    readonly acquire: Future<E, R>,
    readonly dispose: (resource: R) => Future<D, unknown>,
    readonly consume: (resource: R) => Future<F, A>,
  ) {
    super ()
  }

  _interpret(
    onCrash: (e: unknown) => void,
    onRejected: (e: E | F) => void,
    onResolved: (a: A) => void,
    scheduler: Scheduler,
  ): Cancel {
    let phase: 'acquiring' | 'consuming' | 'disposing' | 'done' = 'acquiring'
    let cancelled = false
    let cancelCurrent: Canceller = noop
    let resource: R
    const finish = (outcome: Outcome<E | F, A>): void => {
      phase = 'done'
      cancelCurrent = noop
      if (!cancelled) deliver (onCrash, onRejected, onResolved, outcome)
      else if (outcome.tag === 'crash') raise (outcome.value)
    }
    const dispose = (outcome: Outcome<E | F, A> | null): void => {
      if (phase === 'disposing' || phase === 'done') return
      phase = 'disposing'
      let cleanup: Future<D, unknown>
      try {
        const f = this.dispose
        cleanup = f (resource)
      } catch (value) {
        finish ({ tag: 'crash', value })
        return
      }
      scheduler.fork (
        cleanup,
        (value) => finish ({ tag: 'crash', value }),
        (cause) =>
          finish ({
            tag: 'crash',
            value: new Error ('hook: disposal rejected', { cause }),
          }),
        () => {
          if (outcome !== null && !cancelled) finish (outcome)
          else {
            phase = 'done'
            cancelCurrent = noop
          }
        },
      )
    }
    const onAcquired = (value: R): void => {
      resource = value
      if (cancelled) return
      phase = 'consuming'
      cancelCurrent = noop
      let use: Future<F, A>
      try {
        const f = this.consume
        use = f (resource)
      } catch (value) {
        if (cancelled) raise (value)
        else dispose ({ tag: 'crash', value })
        return
      }
      if (cancelled) return
      cancelCurrent = scheduler.fork (
        use,
        (value) => dispose ({ tag: 'crash', value }),
        (value) => dispose ({ tag: 'reject', value }),
        (value) => dispose ({ tag: 'resolve', value }),
      )
    }
    cancelCurrent = scheduler.fork (
      this.acquire,
      (value) => finish ({ tag: 'crash', value }),
      (value) => finish ({ tag: 'reject', value }),
      onAcquired,
    )
    const cancel: Canceller = () => {
      if (phase === 'acquiring') {
        phase = 'done'
        const stop = cancelCurrent
        cancelCurrent = noop
        stop ()
      } else if (phase === 'consuming') {
        const stop = cancelCurrent
        cancelCurrent = noop
        scheduler.enqueue (() => dispose (null))
        stop ()
      }
    }
    cancel.detach = () => {
      cancelled = true
      cancelCurrent.detach?. ()
    }
    return cancel
  }
}
