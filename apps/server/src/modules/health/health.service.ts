import type { PrismaClient } from "../../lib/db.js";
import type { Logger } from "../../lib/logger.js";

/**
 * How long the readiness check waits for the database. Short, so an orchestrator or a person
 * polling the endpoint is not left hanging; long enough for a warm Neon connection.
 */
export const READINESS_TIMEOUT_MS = 3_000;

/**
 * Runs `SELECT 1` and reports whether the database answered in time. It never throws: a refused
 * connection, a timeout and an unconfigured database are all simply "not ready". The cause is
 * logged (without the connection string) so an operator can tell them apart.
 */
export async function isDatabaseReady(
  prisma: PrismaClient,
  logger: Pick<Logger, "warn">,
  timeoutMs: number = READINESS_TIMEOUT_MS,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`The database did not answer within ${timeoutMs} ms.`));
    }, timeoutMs);
  });

  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch (err) {
    logger.warn({ err }, "Readiness check failed: the database is not reachable");
    return false;
  } finally {
    clearTimeout(timer);
  }
}
