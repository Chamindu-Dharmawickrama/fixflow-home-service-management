import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ClosableServer, createShutdownHandler } from "./shutdown.js";

function setup(options: { cleanup?: () => Promise<void>; timeoutMs?: number } = {}) {
  let finishClose: ((error?: Error) => void) | undefined;
  const server: ClosableServer = {
    close: vi.fn((callback: (error?: Error) => void) => {
      finishClose = callback;
    }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  };
  const logger = { info: vi.fn(), error: vi.fn() };
  const exit = vi.fn();
  const shutdown = createShutdownHandler({ server, logger, exit, ...options });

  return { server, logger, exit, shutdown, closeServer: (error?: Error) => finishClose?.(error) };
}

describe("createShutdownHandler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops accepting connections and closes idle ones", () => {
    const { server, shutdown } = setup();

    shutdown("SIGTERM");

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
  });

  it("logs which signal started the shutdown", () => {
    const { logger, shutdown } = setup();

    shutdown("SIGINT");

    expect(logger.info).toHaveBeenCalledWith({ signal: "SIGINT" }, "Shutting down");
  });

  it("waits for in-flight requests, then exits 0", async () => {
    const { exit, shutdown, closeServer } = setup();

    shutdown("SIGTERM");
    expect(exit).not.toHaveBeenCalled();

    closeServer();
    await vi.runAllTimersAsync();

    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("runs cleanup after the server has closed and before exiting", async () => {
    const order: string[] = [];
    const cleanup = vi.fn(() => {
      order.push("cleanup");
      return Promise.resolve();
    });
    const { exit, shutdown, closeServer } = setup({ cleanup });
    exit.mockImplementation(() => order.push("exit"));

    shutdown("SIGTERM");
    expect(cleanup).not.toHaveBeenCalled();
    closeServer();
    await vi.runAllTimersAsync();

    expect(order).toEqual(["cleanup", "exit"]);
  });

  it("exits 1 when cleanup fails", async () => {
    const { exit, logger, shutdown, closeServer } = setup({
      cleanup: () => Promise.reject(new Error("disconnect failed")),
    });

    shutdown("SIGTERM");
    closeServer();
    await vi.runAllTimersAsync();

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [fields, message] = logger.error.mock.calls[0] as [{ err: Error }, string];
    expect(fields.err.message).toBe("disconnect failed");
    expect(message).toBe("Shutdown cleanup failed");
  });

  it("exits 1 when the server reports an error while closing", async () => {
    const { exit, shutdown, closeServer } = setup();

    shutdown("SIGTERM");
    closeServer(new Error("not running"));
    await vi.runAllTimersAsync();

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("cuts remaining connections and exits 1 after the timeout", async () => {
    const { server, exit, logger, shutdown } = setup({ timeoutMs: 5000 });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(4999);
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it("does not force an exit once the server closed in time", async () => {
    const { server, exit, shutdown, closeServer } = setup({ timeoutMs: 5000 });

    shutdown("SIGTERM");
    closeServer();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("ignores a second signal while shutting down", () => {
    const { server, logger, shutdown } = setup();

    shutdown("SIGTERM");
    shutdown("SIGINT");

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});
