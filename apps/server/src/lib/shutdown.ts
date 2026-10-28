import type { Logger } from "./logger.js";

/** The part of `http.Server` the shutdown sequence needs. */
export interface ClosableServer {
  close: (callback: (error?: Error) => void) => unknown;
  closeIdleConnections: () => void;
  closeAllConnections: () => void;
}

export interface ShutdownOptions {
  server: ClosableServer;
  logger: Pick<Logger, "info" | "error">;
  /** Releases other resources (later: the Prisma client) once the server has stopped. */
  cleanup?: () => Promise<void>;
  /** How long in-flight requests get to finish before connections are cut. */
  timeoutMs?: number;
  exit?: (code: number) => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Returns a handler for SIGTERM/SIGINT: stop accepting connections, let in-flight requests
 * finish, release resources, then exit 0. If that takes longer than `timeoutMs`, the remaining
 * connections are cut and the process exits 1. Calling it again while shutting down is a no-op.
 */
export function createShutdownHandler(options: ShutdownOptions): (signal: string) => void {
  const { server, logger, cleanup, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;

  return (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");

    const forceTimer = setTimeout(() => {
      logger.error({ timeoutMs }, "Graceful shutdown timed out; closing remaining connections");
      server.closeAllConnections();
      exit(1);
    }, timeoutMs);
    forceTimer.unref();

    server.close((closeError) => {
      void (async () => {
        try {
          await cleanup?.();
        } catch (cleanupError) {
          logger.error({ err: cleanupError }, "Shutdown cleanup failed");
          clearTimeout(forceTimer);
          exit(1);
          return;
        }
        clearTimeout(forceTimer);
        if (closeError) {
          logger.error({ err: closeError }, "Server closed with an error");
        }
        exit(closeError ? 1 : 0);
      })();
    });
    server.closeIdleConnections();
  };
}
