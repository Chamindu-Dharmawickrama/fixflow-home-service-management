import type { Logger } from "./logger.js";

/**
 * Work that must happen after a response is on its way, such as sending an email once the
 * transaction has committed. Tasks run in the same process and are tracked, so tests (and a
 * graceful shutdown) can wait for them with {@link BackgroundTasks.idle}. This is not a queue:
 * nothing is persisted or retried, which is all the MVP's emails need (BR-22).
 */
export interface BackgroundTasks {
  /** Starts tracking a promise. A rejection is logged, never thrown. */
  run(task: Promise<unknown>): void;
  /** Resolves when every tracked task, including ones started meanwhile, has finished. */
  idle(): Promise<void>;
}

export function createBackgroundTasks(logger: Pick<Logger, "error">): BackgroundTasks {
  const running = new Set<Promise<unknown>>();

  return {
    run(task) {
      const tracked = task
        .catch((error: unknown) => {
          logger.error({ err: error }, "Background task failed");
        })
        .finally(() => {
          running.delete(tracked);
        });
      running.add(tracked);
    },
    async idle() {
      while (running.size > 0) {
        await Promise.allSettled([...running]);
      }
    },
  };
}
