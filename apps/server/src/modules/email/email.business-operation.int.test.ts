import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppDeps } from "../../deps.js";
import { runInTransaction } from "../../lib/transaction.js";
import { buildTestDeps } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { RecordingEmailSender } from "../../test/fakes.js";
import {
  createAdmin,
  createBusinessSettings,
  createCustomer,
  createService,
  createServiceRequest,
} from "../../test/fixtures.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { recordActivity } from "../activity/activity.service.js";
import { notify, notifyAdmins } from "../notifications/notifications.service.js";
import { createEmailDispatcher } from "./email.dispatcher.js";
import { absoluteAppUrl } from "./email.domain.js";
import { emailJob } from "./email.jobs.js";
import type { EmailSender, EmailSendResult } from "./email.types.js";
import { LogEmailSender } from "./log-email-sender.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

/**
 * A stand-in for a real workflow service (T11 onwards): cancel a service request. It follows the
 * pattern every workflow task must follow (CLAUDE.md §7, docs/ARCHITECTURE.md):
 *
 *  1. one transaction holds the change, the activity event and the notifications;
 *  2. emails are only queued inside it;
 *  3. the dispatcher sends them after the commit, and cannot affect the outcome.
 *
 * It lives in this test on purpose: no production code cancels a request until T12.
 */
async function cancelRequestForTest(
  deps: Pick<AppDeps, "prisma" | "clock" | "config" | "emailDispatcher">,
  input: { requestId: string; adminUserId: string; adminName: string; failAfterQueueing?: boolean },
) {
  const { result, afterCommit } = await runInTransaction(deps.prisma, async (tx, after) => {
    const request = await tx.serviceRequest.update({
      where: { id: input.requestId },
      data: {
        status: "CANCELLED",
        cancelReason: "The customer asked us to cancel.",
        cancelledAt: deps.clock.now(),
        cancelledByUserId: input.adminUserId,
      },
      include: { customer: { include: { user: true } } },
    });
    const { user } = request.customer;
    const linkPath = `/portal/requests/${request.id}`;

    await recordActivity(tx, {
      actorUserId: input.adminUserId,
      entityType: "SERVICE_REQUEST",
      entityId: request.id,
      requestId: request.id,
      customerId: request.customerId,
      action: "request.cancelled",
      fromStatus: "SUBMITTED",
      toStatus: "CANCELLED",
      metadata: { requestReference: request.reference },
      ...buildActivitySummaries({
        actor: { kind: "staff", name: input.adminName },
        staff: `cancelled request ${request.reference}`,
        customer: `cancelled your request ${request.reference}`,
      }),
    });
    const customerNotification = await notify(tx, {
      recipientUserId: user.id,
      type: "REQUEST_CANCELLED",
      title: `Request ${request.reference} was cancelled`,
      message: `Your request for ${request.serviceNameSnapshot} was cancelled.`,
      linkPath,
      entity: { type: "SERVICE_REQUEST", id: request.id },
    });
    await notifyAdmins(tx, {
      type: "REQUEST_CANCELLED",
      title: `Request ${request.reference} was cancelled`,
      message: `${user.name}'s request was cancelled.`,
      linkPath: `/app/requests/${request.id}`,
    });
    after.email(
      emailJob(
        "request-cancelled",
        user.email,
        {
          customerName: user.name,
          requestReference: request.reference,
          serviceName: request.serviceNameSnapshot,
          requestUrl: absoluteAppUrl(deps.config.email.publicWebUrl, linkPath),
        },
        { notificationId: customerNotification.id },
      ),
    );

    if (input.failAfterQueueing === true) {
      throw new Error("the operation failed after queueing an email");
    }
    return request;
  });

  deps.emailDispatcher.dispatchAfterCommit(afterCommit);
  return result;
}

async function scenario() {
  await createBusinessSettings(prisma);
  const admin = await createAdmin(prisma, { name: "Morgan Reyes" });
  const { user, profile } = await createCustomer(prisma, {
    email: "alex.morgan@example.test",
    name: "Alex Morgan",
  });
  const service = await createService(prisma);
  const request = await createServiceRequest(prisma, {
    customerId: profile.id,
    serviceId: service.id,
    serviceNameSnapshot: "AC Repair",
  });
  return { admin, user, profile, request };
}

/** Everything the operation is supposed to leave behind. */
async function footprint(requestId: string) {
  return {
    status: (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
    activity: await prisma.activityEvent.count({ where: { requestId } }),
    notifications: await prisma.notification.count(),
    deliveries: await prisma.emailDeliveryLog.count(),
  };
}

describe("a business operation: transaction, then notifications, then email (BR-22)", () => {
  it("commits the change, the activity event and the notifications, and logs the email as LOGGED (not SENT)", async () => {
    const s = await scenario();
    const test = buildTestDeps({ prisma });

    await cancelRequestForTest(test.deps, {
      requestId: s.request.id,
      adminUserId: s.admin.id,
      adminName: "Morgan Reyes",
    });
    await test.deps.emailDispatcher.idle();

    expect(await footprint(s.request.id)).toEqual({
      status: "CANCELLED",
      activity: 1,
      // One for the customer and one for the admin.
      notifications: 2,
      deliveries: 1,
    });
    const notifications = await prisma.notification.findMany();
    expect(notifications.map((n) => n.recipientUserId).sort()).toEqual(
      [s.user.id, s.admin.id].sort(),
    );
    const delivery = await prisma.emailDeliveryLog.findFirstOrThrow();
    expect(delivery).toMatchObject({
      template: "request-cancelled",
      status: "LOGGED",
      transport: "log",
      recipientMasked: "a***@example.test",
      errorCode: null,
      sentAt: null,
    });
    // It is tied to the customer's notification, not the admin's.
    expect(delivery.notificationId).toBe(
      notifications.find((n) => n.recipientUserId === s.user.id)?.id,
    );
    // The customer-facing email links to the portal page of the request.
    expect(test.emails.last?.text).toContain(
      `${test.deps.config.email.publicWebUrl}/portal/requests/${s.request.id}`,
    );
    expect(test.emails.last?.text).toContain(s.request.reference);
  });

  it("writes the real log transport's result as LOGGED even though the file was written", async () => {
    const s = await scenario();
    const test = buildTestDeps({ prisma });
    const logSender = new LogEmailSender({ logger: test.deps.logger, clock: test.clock });
    const deps = {
      ...test.deps,
      emailDispatcher: createEmailDispatcher({
        prisma,
        emailSender: logSender,
        clock: test.clock,
        logger: test.deps.logger,
        background: test.deps.background,
      }),
    };

    await cancelRequestForTest(deps, {
      requestId: s.request.id,
      adminUserId: s.admin.id,
      adminName: "Morgan Reyes",
    });
    await deps.emailDispatcher.idle();

    expect((await prisma.emailDeliveryLog.findFirstOrThrow()).status).toBe("LOGGED");
  });

  it("leaves the operation committed and records FAILED when the email sender fails", async () => {
    const s = await scenario();
    const failing = new RecordingEmailSender();
    failing.failWith = Object.assign(new Error(`connect ECONNREFUSED smtp.internal:587`), {
      code: "ECONNECTION",
    });
    const test = buildTestDeps({ prisma, emailSender: failing, logLevel: "info" });

    // The operation itself resolves normally: the email is not its problem.
    const request = await cancelRequestForTest(test.deps, {
      requestId: s.request.id,
      adminUserId: s.admin.id,
      adminName: "Morgan Reyes",
    });
    await test.deps.emailDispatcher.idle();

    expect(request.status).toBe("CANCELLED");
    expect(await footprint(s.request.id)).toEqual({
      status: "CANCELLED",
      activity: 1,
      notifications: 2,
      deliveries: 1,
    });
    expect(await prisma.emailDeliveryLog.findFirstOrThrow()).toMatchObject({
      template: "request-cancelled",
      status: "FAILED",
      errorCode: "ECONNECTION",
      sentAt: null,
    });
    expect(test.logs.text()).not.toContain("alex.morgan");
    expect(test.logs.text()).not.toContain("smtp.internal");
  });

  it("sends nothing and changes nothing when the operation fails after queueing the email", async () => {
    const s = await scenario();
    const test = buildTestDeps({ prisma });

    await expect(
      cancelRequestForTest(test.deps, {
        requestId: s.request.id,
        adminUserId: s.admin.id,
        adminName: "Morgan Reyes",
        failAfterQueueing: true,
      }),
    ).rejects.toThrow("failed after queueing");
    await test.deps.emailDispatcher.idle();

    expect(await footprint(s.request.id)).toEqual({
      status: "SUBMITTED",
      activity: 0,
      notifications: 0,
      deliveries: 0,
    });
    expect(test.emails.sent).toHaveLength(0);
  });

  it("sends only after the commit, and does not wait for the mail server", async () => {
    const s = await scenario();
    const seenBySender: string[] = [];
    let release: (result: EmailSendResult) => void = () => undefined;
    let sendStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const slow: EmailSender = {
      send: async () => {
        // By the time the mail server is contacted, the operation is already visible to everyone.
        seenBySender.push(
          (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: s.request.id } })).status,
        );
        return new Promise<EmailSendResult>((resolve) => {
          release = resolve;
          sendStarted();
        });
      },
    };
    const test = buildTestDeps({ prisma, emailSender: slow });

    const operation = cancelRequestForTest(test.deps, {
      requestId: s.request.id,
      adminUserId: s.admin.id,
      adminName: "Morgan Reyes",
    });
    // The operation returns although the "mail server" has not answered.
    await expect(operation).resolves.toMatchObject({ status: "CANCELLED" });
    await started;
    expect(seenBySender).toEqual(["CANCELLED"]);
    expect((await prisma.emailDeliveryLog.findFirstOrThrow()).status).toBe("PENDING");

    release({ status: "SENT", transport: "smtp" });
    await test.deps.emailDispatcher.idle();
    expect((await prisma.emailDeliveryLog.findFirstOrThrow()).status).toBe("SENT");
  });

  it("never asks the dispatcher to send for a transaction that rolled back", async () => {
    const s = await scenario();
    const sender = new RecordingEmailSender();
    const test = buildTestDeps({ prisma, emailSender: sender });
    const dispatch = vi.spyOn(test.deps.emailDispatcher, "dispatchAfterCommit");

    await expect(
      cancelRequestForTest(test.deps, {
        requestId: s.request.id,
        adminUserId: s.admin.id,
        adminName: "Morgan Reyes",
        failAfterQueueing: true,
      }),
    ).rejects.toThrow();

    expect(dispatch).not.toHaveBeenCalled();
    expect(sender.sent).toHaveLength(0);
  });
});

describe("runInTransaction", () => {
  it("returns the result and the queued emails in the order they were queued", async () => {
    const job = (to: string) =>
      emailJob("invoice-voided", to, {
        customerName: "Alex Morgan",
        invoiceReference: "INV-2026-00007",
        invoiceUrl: "https://fixflow.example.com/portal/invoices/1",
      });

    const outcome = await runInTransaction(prisma, (_tx, after) => {
      after.email(job("first@example.test"));
      after.email(job("second@example.test"));
      return Promise.resolve("done");
    });

    expect(outcome.result).toBe("done");
    expect(outcome.afterCommit.map((queued) => queued.to)).toEqual([
      "first@example.test",
      "second@example.test",
    ]);
  });

  it("returns no emails when the operation queued none", async () => {
    const outcome = await runInTransaction(prisma, () => Promise.resolve(42));

    expect(outcome).toEqual({ result: 42, afterCommit: [] });
  });
});
