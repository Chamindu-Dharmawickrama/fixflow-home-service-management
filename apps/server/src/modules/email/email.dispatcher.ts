import type { BackgroundTasks } from "../../lib/background.js";
import { looksLikeEmail } from "../../lib/email-address.js";
import { type EmailJob, renderEmailJob } from "./email.jobs.js";
import type { EmailBranding } from "./email.layout.js";
import {
  type EmailDeps,
  loadEmailBranding,
  recordEmailNotSent,
  sendAndLog,
  type SendOutcome,
} from "./email.service.js";

export interface EmailDispatcherDeps extends EmailDeps {
  /** Runs the dispatch off the caller's path and lets shutdown and tests wait for it. */
  background: BackgroundTasks;
}

/**
 * Sends the emails a business operation queued, after its transaction has committed (D-13, BR-22).
 *
 * - Each job gets an `EmailDeliveryLog` row: `PENDING`, then `SENT`, `LOGGED` (log transport, nobody
 *   was emailed), `FAILED` (with a safe error code) or `SKIPPED` (no recipient).
 * - The D-52 policy for reserved domains is applied by the sender it is given (`RoutingEmailSender`),
 *   which sees every recipient, so `.test` and `example.com` addresses are only ever logged.
 * - **It never throws**, whatever happens to a template, the database or the mail server.
 */
export interface EmailDispatcher {
  /**
   * Starts sending in the background and returns at once. Call it after `runInTransaction` returns,
   * never inside the transaction.
   */
  dispatchAfterCommit(jobs: readonly EmailJob[]): void;
  /** Resolves when every dispatch started so far has finished. For tests and graceful shutdown. */
  idle(): Promise<void>;
}

export function createEmailDispatcher(deps: EmailDispatcherDeps): EmailDispatcher {
  const { background, logger } = deps;

  async function dispatchOne(job: EmailJob, branding: EmailBranding): Promise<SendOutcome> {
    const { template, notificationId } = job;
    const to = job.to?.trim() ?? "";

    if (to === "") {
      await recordEmailNotSent(deps, {
        template,
        to,
        status: "SKIPPED",
        errorCode: "NO_RECIPIENT",
        notificationId,
      });
      return "SKIPPED";
    }
    if (!looksLikeEmail(to)) {
      await recordEmailNotSent(deps, {
        template,
        to,
        status: "FAILED",
        errorCode: "INVALID_RECIPIENT",
        notificationId,
      });
      return "FAILED";
    }

    let message;
    try {
      message = renderEmailJob(job, branding);
    } catch (error) {
      // A template bug must not escape; the log says which template and the code says why.
      logger.error({ err: error, template }, "Could not build an email; it was not sent");
      await recordEmailNotSent(deps, {
        template,
        to,
        status: "FAILED",
        errorCode: "TEMPLATE_ERROR",
        notificationId,
      });
      return "FAILED";
    }

    return sendAndLog(deps, { template, message: { to, ...message }, notificationId });
  }

  async function dispatchAll(jobs: readonly EmailJob[]): Promise<void> {
    const branding = await loadEmailBranding(deps);
    // One after another: a pooled SMTP transport limits parallel connections anyway, and the log
    // rows then appear in the order the operation queued the emails.
    for (const job of jobs) {
      try {
        await dispatchOne(job, branding);
      } catch (error) {
        logger.error({ err: error, template: job.template }, "Email dispatch failed unexpectedly");
      }
    }
  }

  return {
    dispatchAfterCommit(jobs) {
      if (jobs.length === 0) {
        return;
      }
      // Copied: the caller may reuse its array.
      background.run(dispatchAll([...jobs]));
    },
    idle() {
      return background.idle();
    },
  };
}
