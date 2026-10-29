import type { EmailJob } from "../modules/email/email.jobs.js";
import type { DbClient, PrismaClient } from "./db.js";

/** What a business operation can queue while its transaction is open. */
export interface AfterCommit {
  /** Queues an email to be sent only if the transaction commits. */
  email(job: EmailJob): void;
}

export interface TransactionOutcome<T> {
  /** Whatever the operation returned. */
  result: T;
  /** Everything the operation queued. Pass it to `emailDispatcher.dispatchAfterCommit`. */
  afterCommit: EmailJob[];
}

/**
 * Runs a business operation in one database transaction and collects the emails it wants sent
 * (CLAUDE.md §7, BR-22). Writes, the activity event and the notifications all use `tx`; emails are
 * only *queued*, because a transaction that rolls back must not have emailed anyone, and a failing
 * mail server must never roll back a transaction that succeeded.
 *
 * ```ts
 * const { result, afterCommit } = await runInTransaction(deps.prisma, async (tx, after) => {
 *   const quotation = await markQuotationSent(tx, …);       // the business change
 *   await recordActivity(tx, …);                            // the history
 *   const note = await notify(tx, …);                       // the in-app notification
 *   after.email(emailJob("quotation-sent", customerEmail, {…}, { notificationId: note.id }));
 *   return quotation;
 * });
 * deps.emailDispatcher.dispatchAfterCommit(afterCommit);   // after the commit; never throws
 * return result;
 * ```
 *
 * If `fn` throws, the transaction rolls back, the error propagates and nothing is dispatched.
 */
export async function runInTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: DbClient, after: AfterCommit) => Promise<T>,
): Promise<TransactionOutcome<T>> {
  const queued: EmailJob[] = [];
  const after: AfterCommit = {
    email(job) {
      queued.push(job);
    },
  };

  const result = await prisma.$transaction((tx) => fn(tx, after));
  return { result, afterCommit: queued };
}
