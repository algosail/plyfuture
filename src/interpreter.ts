import type { TransformationList } from './future.ts'
import type { Transformation } from './transformation.ts'
import { Future, Transformer } from './future.ts'

/** Stops a subscription. */
export type Cancel = () => void

/** A cancellation action that can also update bookkeeping immediately. */
export type Canceller = Cancel & { detach?: () => void }

export const noop: Canceller = () => {}

export function raise(e: unknown): void {
  setTimeout (() => {
    throw e
  }, 0)
}

export type Outcome<E, A> =
  | { readonly tag: 'crash'; readonly value: unknown }
  | { readonly tag: 'reject'; readonly value: E }
  | { readonly tag: 'resolve'; readonly value: A }

export function deliver<E, A>(
  onCrash: (e: unknown) => void,
  onRejected: (e: E) => void,
  onResolved: (a: A) => void,
  outcome: Outcome<E, A>,
): void {
  if (outcome.tag === 'crash') onCrash (outcome.value)
  else if (outcome.tag === 'reject') onRejected (outcome.value)
  else onResolved (outcome.value)
}

export class Scheduler {
  private jobs: (() => void)[] = []
  private draining = false

  enqueue(job: () => void): void {
    this.jobs.push (job)
  }

  flush(): void {
    if (this.draining) return
    this.draining = true
    try {
      while (this.jobs.length) {
        const job = this.jobs.pop ()!
        try {
          job ()
        } catch (e) {
          raise (e)
        }
      }
    } finally {
      this.draining = false
    }
  }

  fork<E, A>(
    future: Future<E, A>,
    onCrash: (e: unknown) => void,
    onRejected: (e: E) => void,
    onResolved: (a: A) => void,
  ): Cancel {
    const run = new Run (this, future, onCrash, onRejected, onResolved)
    this.enqueue (() => run.drain ())
    const cancel: Canceller = () => run.cancel ()
    cancel.detach = () => run.detach ()
    return cancel
  }
}

export function interpret<E, A>(
  future: Future<E, A>,
  onCrash: (e: unknown) => void,
  onRejected: (e: E) => void,
  onResolved: (a: A) => void,
): Cancel {
  const scheduler = new Scheduler ()
  const cancel = scheduler.fork (future, onCrash, onRejected, onResolved)
  scheduler.flush ()
  return cancel
}

type Step = Transformation<unknown, unknown, unknown, unknown>

class Run<E, A> {
  private phase: 'running' | 'detached' | 'done' | 'stopped' = 'running'
  private next: Future<unknown, unknown> | null
  private steps: Step[] = []
  private pending: Outcome<unknown, unknown> | null = null
  private cancelCurrent: Canceller = noop

  constructor(
    private readonly scheduler: Scheduler,
    future: Future<E, A>,
    private readonly onCrash: (e: unknown) => void,
    private readonly onRejected: (e: E) => void,
    private readonly onResolved: (a: A) => void,
  ) {
    this.next = future as Future<unknown, unknown>
  }

  detach(): void {
    if (this.phase !== 'running') return
    this.phase = 'detached'
    this.next = null
    this.pending = null
    this.steps = []
  }

  cancel(): void {
    if (this.phase === 'done' || this.phase === 'stopped') return
    this.phase = 'stopped'
    this.next = null
    this.pending = null
    this.steps = []
    const cancel = this.cancelCurrent
    this.cancelCurrent = noop
    try {
      cancel.detach?. ()
    } catch (e) {
      raise (e)
    }
    this.scheduler.enqueue (cancel)
    this.scheduler.flush ()
  }

  drain(): void {
    while (this.phase === 'running') {
      if (this.pending !== null) {
        const outcome = this.pending
        this.pending = null
        const step = outcome.tag === 'crash' ? undefined : this.steps.pop ()
        if (step === undefined) {
          this.phase = 'done'
          this.steps = []
          this.cancelCurrent = noop
          deliver (
            this.onCrash,
            this.onRejected,
            this.onResolved,
            outcome as Outcome<E, A>,
          )
          return
        }
        try {
          const next = outcome.tag === 'reject'
            ? step.rejected (outcome.value)
            : step.resolved (outcome.value)
          if (!Future.is (next)) {
            throw new TypeError (
              `${step.name}: expected a Future from the handler`,
            )
          }
          if (this.phase === 'running') this.next = next
        } catch (e) {
          this.pending = { tag: 'crash', value: e }
        }
        continue
      }
      if (this.next === null) return
      const future = this.next
      this.next = null
      if (!Future.is (future)) {
        this.pending = {
          tag: 'crash',
          value: new TypeError ('Expected a Future'),
        }
        continue
      }
      if (future instanceof Transformer) {
        for (
          let list: TransformationList | null = future.transformations;
          list !== null;
          list = list.tail
        ) {
          this.steps.push (list.head)
        }
        this.next = future.source
        continue
      }
      let returned = false
      let settled = false
      const receive = (outcome: Outcome<unknown, unknown>): void => {
        if (this.phase !== 'running' || settled) return
        settled = true
        this.pending = outcome
        this.cancelCurrent = noop
        if (returned) {
          this.scheduler.enqueue (() => this.drain ())
          this.scheduler.flush ()
        }
      }
      try {
        const cancel = future._interpret (
          (value) => receive ({ tag: 'crash', value }),
          (value) => receive ({ tag: 'reject', value }),
          (value) => receive ({ tag: 'resolve', value }),
          this.scheduler,
        )
        if (cancel !== undefined && typeof cancel !== 'function') {
          throw new TypeError (
            'future: executor must return a cancellation function or undefined',
          )
        }
        const child: Canceller = typeof cancel === 'function' ? cancel : noop
        if (!settled) {
          if (this.phase === 'running') this.cancelCurrent = child
          else {
            try {
              child.detach?. ()
            } catch (e) {
              raise (e)
            }
            this.scheduler.enqueue (child)
          }
        }
      } catch (e) {
        settled = true
        this.pending = { tag: 'crash', value: e }
        this.cancelCurrent = noop
      }
      returned = true
    }
  }
}
