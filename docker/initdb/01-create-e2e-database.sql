-- The database the Playwright suite empties and re-seeds on every run (npm run test:e2e). It is
-- separate from fixflow_test (API integration tests) and from any development database, and its
-- name must contain "e2e": apps/server/src/test/db.ts refuses to reset anything else.
CREATE DATABASE fixflow_e2e OWNER fixflow_test;
