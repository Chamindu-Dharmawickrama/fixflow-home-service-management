import { existsSync } from "node:fs";

/**
 * Loads a local `.env` file into `process.env` for development and tests. Variables that are
 * already set win over the file. Production never reads a file: its configuration comes from
 * the platform's environment, and a stray file must not change it.
 */
export function loadLocalEnvFile(path = ".env", env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production" || !existsSync(path)) {
    return false;
  }
  process.loadEnvFile(path);
  return true;
}
