import type { Duration, Scope } from "effect"
import { Context, Deferred, Effect, Fiber, Layer, Option, Queue, Ref } from "effect"

export interface RateLimiter {
  readonly take: Effect.Effect<void>
}

export declare namespace RateLimiter {
  export interface Factory {
    readonly make: (
      limit: number,
      window: Duration.DurationInput
    ) => Effect.Effect<RateLimiter, never, Scope.Scope>
  }
}

class Factory extends Context.Tag("RateLimiter.Factory")<Factory, RateLimiter.Factory>() {
  static readonly Live = Layer.sync(Factory, () => factory)
}

export const make = Effect.serviceFunctionEffect(Factory, (factory) => factory.make)

const factory = Factory.of({
  make: (limit, window) =>
    Effect.gen(function*(_) {
      const counter = yield* _(Ref.make(limit))
      const scope = yield* _(Effect.scope)

      const queue = yield* _(Effect.acquireRelease(
        Queue.unbounded<Deferred.Deferred<void>>(),
        (queue) => Queue.shutdown(queue)
      ))

      const reset = Effect.delay(Ref.set(counter, limit), window)
      const resetRef = yield* _(Ref.make(Option.none<Fiber.RuntimeFiber<void>>()))
      const maybeReset = Ref.get(resetRef).pipe(
        Effect.tap(Option.match({
          onNone: () =>
            reset.pipe(
              Effect.zipRight(Ref.set(resetRef, Option.none())),
              Effect.forkIn(scope),
              Effect.flatMap((fiber) => Ref.set(resetRef, Option.some(fiber)))
            ),
          onSome: () => Effect.unit
        }))
      )

      return {
        take: Deferred.make<void>().pipe(
          Effect.tap((deferred) => Queue.offer(queue, deferred)),
          Effect.flatMap((deferred) =>
            Deferred.await(deferred).pipe(
              Effect.onInterrupt(() => Deferred.interrupt(deferred))
            )
          )
        )
      }
    })
})
