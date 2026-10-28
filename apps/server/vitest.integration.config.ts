import { defineConfig } from "vitest/config";

// API integration tests (*.int.test.ts). They need a database, so T03 adds the global setup
// that migrates TEST_DATABASE_URL. Until then there are none, hence `--passWithNoTests`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Integration tests share one database, so files run one after another.
    fileParallelism: false,
  },
});
