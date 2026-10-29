import { loadLocalEnvFile } from "../src/config/dotenv.js";
import { ConfigError, loadConfig } from "../src/config/env.js";
import { systemClock } from "../src/lib/clock.js";
import { parseEmailTestArgs, runEmailTest } from "../src/modules/email/email-test.js";

/**
 * `npm run email:test -w @fixflow/server -- --to <address>` — development only. Sends one real
 * test email through the SMTP server configured in apps/server/.env, to prove the settings work.
 * The recipient is shown masked, and the SMTP password is never printed.
 */
async function main(): Promise<void> {
  loadLocalEnvFile();

  const args = parseEmailTestArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    process.exitCode = 2;
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const result = await runEmailTest({ config, to: args.to, now: systemClock.now() });
  if (result.ok) {
    console.info(result.message);
  } else {
    console.error(result.message);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("The email test failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
