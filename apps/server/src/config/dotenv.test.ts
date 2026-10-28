import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadLocalEnvFile } from "./dotenv.js";

const KEY = "FIXFLOW_DOTENV_TEST_VALUE";

describe("loadLocalEnvFile", () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "fixflow-dotenv-"));
    file = join(directory, ".env");
    delete process.env[KEY];
  });

  afterEach(() => {
    delete process.env[KEY];
    rmSync(directory, { recursive: true, force: true });
  });

  it("loads variables from the file", () => {
    writeFileSync(file, `${KEY}=from-file\n`);

    expect(loadLocalEnvFile(file, { NODE_ENV: "development" })).toBe(true);
    expect(process.env[KEY]).toBe("from-file");
  });

  it("does nothing when the file does not exist", () => {
    expect(loadLocalEnvFile(join(directory, "missing.env"), { NODE_ENV: "development" })).toBe(
      false,
    );
  });

  it("never overrides a variable that is already set", () => {
    writeFileSync(file, `${KEY}=from-file\n`);
    process.env[KEY] = "from-environment";

    loadLocalEnvFile(file, { NODE_ENV: "development" });

    expect(process.env[KEY]).toBe("from-environment");
  });

  it("ignores the file in production", () => {
    writeFileSync(file, `${KEY}=from-file\n`);

    expect(loadLocalEnvFile(file, { NODE_ENV: "production" })).toBe(false);
    expect(process.env[KEY]).toBeUndefined();
  });
});
