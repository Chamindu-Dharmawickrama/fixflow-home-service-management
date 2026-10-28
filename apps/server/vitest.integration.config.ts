import { defineConfig } from "vitest/config";

// API integration tests (*.int.test.ts). They run against a real PostgreSQL database named by
// TEST_DATABASE_URL (`npm run db:test:up` starts one). The global setup applies every migration to
// it first; src/test/db.ts refuses to touch any other database.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    globalSetup: ["./src/test/global-setup.ts"],
    // Integration tests share one database, so files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
