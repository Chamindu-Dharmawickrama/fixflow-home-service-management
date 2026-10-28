import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests (*.int.test.ts) need a database and run from vitest.integration.config.ts.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.int.test.ts"],
  },
});
