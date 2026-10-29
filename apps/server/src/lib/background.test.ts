import { describe, expect, it, vi } from "vitest";

import { createBackgroundTasks } from "./background.js";

describe("createBackgroundTasks", () => {
  it("waits for every task, including ones started while waiting", async () => {
    const tasks = createBackgroundTasks({ error: vi.fn() });
    const order: string[] = [];

    tasks.run(
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push("first");
          tasks.run(
            new Promise<void>((inner) => {
              setTimeout(() => {
                order.push("second");
                inner();
              }, 5);
            }),
          );
          resolve();
        }, 5);
      }),
    );
    await tasks.idle();

    expect(order).toEqual(["first", "second"]);
  });

  it("is idle immediately when nothing is running", async () => {
    await expect(createBackgroundTasks({ error: vi.fn() }).idle()).resolves.toBeUndefined();
  });

  it("logs a failed task instead of throwing, and keeps going", async () => {
    const error = vi.fn();
    const tasks = createBackgroundTasks({ error });
    const done = vi.fn();

    tasks.run(Promise.reject(new Error("smtp down")));
    tasks.run(Promise.resolve().then(done));
    await expect(tasks.idle()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
  });
});
