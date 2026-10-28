import { Writable } from "node:stream";

export interface LogCapture {
  /** Pass to `createLogger` as the destination. */
  stream: Writable;
  /** Every captured line parsed as a JSON object. */
  entries(): Record<string, unknown>[];
  /** The raw captured output, for asserting that a value never appears anywhere. */
  text(): string;
}

/** Collects pino output in memory so tests can assert on what was (and was not) logged. */
export function createLogCapture(): LogCapture {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    text: () => chunks.join(""),
    entries: () =>
      chunks
        .join("")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
