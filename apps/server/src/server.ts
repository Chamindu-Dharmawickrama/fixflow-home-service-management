import { createApp } from "./app.js";
import { loadLocalEnvFile } from "./config/dotenv.js";
import { type Config, ConfigError, loadConfig } from "./config/env.js";
import { createProductionDeps } from "./deps.js";
import { createShutdownHandler } from "./lib/shutdown.js";
import { emailStartupWarnings } from "./modules/email/email-sender.js";

function readConfigOrReport(): Config | undefined {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // The logger is built from the configuration, so a bad configuration is reported directly.
      console.error(error.message);
      return undefined;
    }
    throw error;
  }
}

function main(): void {
  loadLocalEnvFile();

  const config = readConfigOrReport();
  if (config === undefined) {
    process.exitCode = 1;
    return;
  }

  const deps = createProductionDeps(config);
  const { logger } = deps;
  if (config.database.url === undefined) {
    logger.warn(
      "DATABASE_URL is not set: the API starts without a database and /api/v1/health/ready reports 503",
    );
  }
  if (config.auth.sessionSecretIsEphemeral) {
    logger.warn(
      "SESSION_SECRET is not set: a random secret was generated, so every sign-in ends when the API restarts",
    );
  }
  if (config.auth.adminEmails.length === 0) {
    logger.warn("ADMIN_EMAILS is empty: nobody can use the admin area");
  }
  if (config.auth.googleClientId === undefined) {
    logger.info("GOOGLE_CLIENT_ID is not set: Google sign-in is switched off");
  }
  for (const warning of emailStartupWarnings(config)) {
    logger.warn(warning);
  }
  const server = createApp(deps).listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, "FixFlow API listening");
  });

  server.on("error", (error) => {
    logger.fatal({ err: error }, "Server failed to start");
    process.exit(1);
  });

  // Stop accepting connections and exit cleanly on Ctrl+C or a platform SIGTERM.
  const shutdown = createShutdownHandler({
    server,
    logger,
    // Let emails already being sent finish, then close the connection pool.
    cleanup: async () => {
      await deps.background.idle();
      deps.emailSender.close?.();
      await deps.prisma.$disconnect();
    },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      shutdown(signal);
    });
  }

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection");
    process.exit(1);
  });
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    process.exit(1);
  });
}

main();
