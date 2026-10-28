import { createApp } from "./app.js";
import { loadLocalEnvFile } from "./config/dotenv.js";
import { type Config, ConfigError, loadConfig } from "./config/env.js";
import { createProductionDeps } from "./deps.js";
import { createShutdownHandler } from "./lib/shutdown.js";

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
  const server = createApp(deps).listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, "FixFlow API listening");
  });

  server.on("error", (error) => {
    logger.fatal({ err: error }, "Server failed to start");
    process.exit(1);
  });

  // Stop accepting connections and exit cleanly on Ctrl+C or a platform SIGTERM.
  const shutdown = createShutdownHandler({ server, logger });
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
