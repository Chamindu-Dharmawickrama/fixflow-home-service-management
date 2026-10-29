import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeClock } from "../../lib/clock.js";
import { buildTestDeps } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { RecordingEmailSender } from "../../test/fakes.js";
import { createBusinessSettings, createUser } from "../../test/fixtures.js";
import { createEmailDispatcher } from "./email.dispatcher.js";
import { type EmailJob, emailJob } from "./email.jobs.js";
import type { EmailMessage, EmailSender, EmailSendResult } from "./email.types.js";
import { RoutingEmailSender } from "./email-sender.js";
import { LogEmailSender } from "./log-email-sender.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
  await createBusinessSettings(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const CUSTOMER = "alex.morgan@example.test";
const REAL_CUSTOMER = "alex.morgan@gmail.com";

const smtpAccepts = (): EmailSender => ({
  send: vi.fn((): Promise<EmailSendResult> =>
    Promise.resolve({ status: "SENT", transport: "smtp" }),
  ),
});

function invoiceVoided(to: string | null | undefined, notificationId?: string): EmailJob {
  return emailJob(
    "invoice-voided",
    to,
    {
      customerName: "Alex Morgan",
      invoiceReference: "INV-2026-00007",
      invoiceUrl:
        "https://fixflow.example.com/portal/invoices/3e9f4b31-9c4d-4e31-8c40-5a2a6d0f2d44",
    },
    notificationId === undefined ? {} : { notificationId },
  );
}

/** Dispatch with a given sender, then wait for it to finish. */
async function dispatch(emailSender: EmailSender, jobs: EmailJob[]) {
  const test = buildTestDeps({ prisma, emailSender, logLevel: "info" });
  test.deps.emailDispatcher.dispatchAfterCommit(jobs);
  await test.deps.emailDispatcher.idle();
  return test;
}

const logRows = () => prisma.emailDeliveryLog.findMany({ orderBy: { createdAt: "asc" } });

describe("EmailDispatcher.dispatchAfterCommit", () => {
  it("records a log-transport email as LOGGED, never SENT, and writes it to the outbox", async () => {
    const outboxDir = await mkdtemp(join(tmpdir(), "fixflow-outbox-"));
    try {
      const { logs, deps } = buildTestDeps({ prisma, logLevel: "info" });
      const dispatcher = createEmailDispatcher({
        prisma,
        emailSender: new LogEmailSender({ logger: deps.logger, clock: deps.clock, outboxDir }),
        clock: deps.clock,
        logger: deps.logger,
        background: deps.background,
      });

      dispatcher.dispatchAfterCommit([invoiceVoided(CUSTOMER)]);
      await dispatcher.idle();

      const [row, ...rest] = await logRows();
      expect(rest).toHaveLength(0);
      expect(row).toMatchObject({
        template: "invoice-voided",
        recipientMasked: "a***@example.test",
        transport: "log",
        status: "LOGGED",
        errorCode: null,
        sentAt: null,
      });
      expect(row?.attemptedAt).not.toBeNull();
      const files = (await readdir(outboxDir)).sort();
      expect(files).toHaveLength(2);
      expect(files[1]).toMatch(/-invoice-voided\.txt$/);
      expect(await readFile(join(outboxDir, files[1] ?? ""), "utf8")).toContain(`To: ${CUSTOMER}`);
      // The logger saw the masked address, the subject and the template, not the address or the body.
      expect(logs.text()).toContain("a***@example.test");
      expect(logs.text()).toContain("invoice-voided");
      expect(logs.text()).not.toContain(CUSTOMER);
      expect(logs.text()).not.toContain("Hello Alex Morgan");
    } finally {
      await rm(outboxDir, { recursive: true, force: true });
    }
  });

  it("records an email an SMTP server accepted as SENT, with the time", async () => {
    await dispatch(smtpAccepts(), [invoiceVoided(REAL_CUSTOMER)]);

    const [row] = await logRows();
    expect(row).toMatchObject({
      status: "SENT",
      transport: "smtp",
      recipientMasked: "a***@gmail.com",
      errorCode: null,
    });
    expect(row?.sentAt).not.toBeNull();
  });

  it("records FAILED with a safe error code when delivery fails, and never throws", async () => {
    const failing = new RecordingEmailSender();
    failing.failWith = Object.assign(
      new Error(`550 5.1.1 <${REAL_CUSTOMER}> rejected by smtp.internal.example`),
      { code: "EENVELOPE" },
    );
    const test = buildTestDeps({ prisma, emailSender: failing, logLevel: "info" });

    expect(() => {
      test.deps.emailDispatcher.dispatchAfterCommit([invoiceVoided(REAL_CUSTOMER)]);
    }).not.toThrow();
    await test.deps.emailDispatcher.idle();

    const [row] = await logRows();
    expect(row).toMatchObject({
      status: "FAILED",
      errorCode: "EENVELOPE",
      sentAt: null,
      recipientMasked: "a***@gmail.com",
    });
    // An SMTP error message can contain the whole address; only the code reaches the logs.
    expect(test.logs.text()).not.toContain("alex.morgan");
    expect(test.logs.text()).toContain("EENVELOPE");
  });

  it("uses a generic code when the error has no usable one", async () => {
    const failing = new RecordingEmailSender();
    failing.failWith = Object.assign(new Error("boom"), { code: "not a safe code; DROP TABLE" });

    await dispatch(failing, [invoiceVoided(REAL_CUSTOMER)]);

    expect((await logRows())[0]?.errorCode).toBe("SEND_FAILED");
  });

  it.each([null, undefined, "", "   "])(
    "records SKIPPED, and does not call the sender, when the recipient is %j",
    async (to) => {
      const sender = new RecordingEmailSender();

      await dispatch(sender, [invoiceVoided(to)]);

      const [row, ...rest] = await logRows();
      expect(rest).toHaveLength(0);
      expect(row).toMatchObject({
        template: "invoice-voided",
        status: "SKIPPED",
        recipientMasked: "(none)",
        transport: "none",
        errorCode: "NO_RECIPIENT",
        sentAt: null,
      });
      expect(sender.sent).toHaveLength(0);
    },
  );

  it("records FAILED (INVALID_RECIPIENT) for an address that is not an address, without sending", async () => {
    const sender = new RecordingEmailSender();

    await dispatch(sender, [invoiceVoided("not-an-email")]);

    expect((await logRows())[0]).toMatchObject({
      status: "FAILED",
      errorCode: "INVALID_RECIPIENT",
      recipientMasked: "***",
    });
    expect(sender.sent).toHaveLength(0);
  });

  it("records FAILED (TEMPLATE_ERROR) when a template cannot be built, and still sends the others", async () => {
    const sender = new RecordingEmailSender();
    const broken = emailJob("job-scheduled", REAL_CUSTOMER, {
      customerName: "Alex Morgan",
      jobReference: "JOB-2026-00003",
      serviceName: "AC Repair",
      jobUrl: "javascript:alert(1)",
      scheduledStart: new Date("2026-11-10T14:00:00.000Z"),
      scheduledEnd: new Date("2026-11-10T16:00:00.000Z"),
      timeZone: "America/New_York",
    });

    const test = await dispatch(sender, [broken, invoiceVoided(REAL_CUSTOMER)]);

    const rows = await logRows();
    expect(rows.map((row) => [row.template, row.status, row.errorCode]).sort()).toEqual([
      ["invoice-voided", "LOGGED", null],
      ["job-scheduled", "FAILED", "TEMPLATE_ERROR"],
    ]);
    expect(sender.sent).toHaveLength(1);
    expect(test.logs.text()).toContain("Could not build an email");
    expect(test.logs.text()).not.toContain("alex.morgan");
  });

  it("keeps going after a failure: one failing email does not stop the next", async () => {
    let calls = 0;
    const flaky: EmailSender = {
      send: (): Promise<EmailSendResult> => {
        calls += 1;
        return calls === 1
          ? Promise.reject(Object.assign(new Error("down"), { code: "ECONNECTION" }))
          : Promise.resolve({ status: "SENT", transport: "smtp" });
      },
    };

    await dispatch(flaky, [invoiceVoided(REAL_CUSTOMER), invoiceVoided("owner@coolbreeze.co.uk")]);

    // The first email failed and the second still went out.
    expect((await logRows()).map((row) => row.status).sort()).toEqual(["FAILED", "SENT"]);
    expect(calls).toBe(2);
  });

  it("links the delivery record to the notification it repeats", async () => {
    const recipient = await createUser(prisma, { email: "recipient@example.test" });
    const notification = await prisma.notification.create({
      data: {
        recipientUserId: recipient.id,
        type: "INVOICE_VOIDED",
        title: "Invoice voided",
        message: "Invoice INV-2026-00007 was voided.",
        linkPath: "/portal/invoices/1",
      },
    });

    await dispatch(new RecordingEmailSender(), [invoiceVoided(CUSTOMER, notification.id)]);

    expect((await logRows())[0]?.notificationId).toBe(notification.id);
  });

  it("never stores the address, the subject or the body", async () => {
    await dispatch(new RecordingEmailSender(), [invoiceVoided(REAL_CUSTOMER)]);

    const stored = JSON.stringify(await logRows());
    expect(stored).not.toContain("alex.morgan");
    expect(stored).not.toContain("INV-2026-00007");
    expect(stored).not.toContain("Hello Alex");
  });

  it("returns before the email is sent, so the operation does not wait for the mail server", async () => {
    let release: (result: EmailSendResult) => void = () => undefined;
    let sendStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const slow: EmailSender = {
      send: () =>
        new Promise<EmailSendResult>((resolve) => {
          release = resolve;
          sendStarted();
        }),
    };
    const test = buildTestDeps({ prisma, emailSender: slow });

    test.deps.emailDispatcher.dispatchAfterCommit([invoiceVoided(REAL_CUSTOMER)]);
    const pending = test.deps.emailDispatcher.idle();

    // The caller already has control while the mail server is still "working".
    await started;
    expect((await logRows())[0]?.status).toBe("PENDING");
    release({ status: "SENT", transport: "smtp" });
    await pending;
    expect((await logRows())[0]?.status).toBe("SENT");
  });

  it("does nothing, and records nothing, for an empty batch", async () => {
    const sender = new RecordingEmailSender();

    await dispatch(sender, []);

    expect(await logRows()).toEqual([]);
    expect(sender.sent).toHaveLength(0);
  });

  it("uses the business name and contact details from the settings", async () => {
    await prisma.businessSettings.updateMany({
      data: {
        businessName: "Harbor Cool Co",
        contactEmail: "desk@harborcool.test",
        phone: "(212) 555-0199",
      },
    });
    const sender = new RecordingEmailSender();

    await dispatch(sender, [invoiceVoided(CUSTOMER)]);

    expect(sender.last?.text).toContain("Harbor Cool Co");
    expect(sender.last?.text).toContain("desk@harborcool.test · (212) 555-0199");
  });

  it("falls back to the product name when the settings cannot be read", async () => {
    await prisma.businessSettings.deleteMany();
    const sender = new RecordingEmailSender();

    await dispatch(sender, [invoiceVoided(CUSTOMER)]);

    expect(sender.last?.text).toContain("— FixFlow");
    expect(sender.last?.text).not.toContain("Questions?");
  });

  it("still sends, and does not throw, when the database is unavailable", async () => {
    const sender = new RecordingEmailSender();
    const brokenPrisma = {
      businessSettings: { findUnique: vi.fn().mockRejectedValue(new Error("database down")) },
      emailDeliveryLog: {
        create: vi.fn().mockRejectedValue(new Error("database down")),
        update: vi.fn().mockRejectedValue(new Error("database down")),
      },
    } as unknown as typeof prisma;
    const base = buildTestDeps({ prisma, emailSender: sender, logLevel: "info" });
    const dispatcher = createEmailDispatcher({
      prisma: brokenPrisma,
      emailSender: sender,
      clock: new FakeClock("2026-10-29T09:00:00.000Z"),
      logger: base.deps.logger,
      background: base.deps.background,
    });

    expect(() => {
      dispatcher.dispatchAfterCommit([invoiceVoided(CUSTOMER)]);
    }).not.toThrow();
    await dispatcher.idle();

    expect(sender.sent).toHaveLength(1);
    expect(base.logs.text()).toContain("Could not record the email delivery attempt");
  });
});

describe("the reserved-domain policy (D-52) through the dispatcher", () => {
  it("only logs mail for undeliverable domains and sends the rest over SMTP", async () => {
    const smtpSend = vi.fn((_message: EmailMessage): Promise<EmailSendResult> =>
      Promise.resolve({ status: "SENT", transport: "smtp" }),
    );
    const logSend = vi.fn((): Promise<EmailSendResult> =>
      Promise.resolve({ status: "LOGGED", transport: "log" }),
    );
    const routing = new RoutingEmailSender({ send: logSend }, { send: smtpSend });

    await dispatch(routing, [
      invoiceVoided("alex.morgan@example.test"),
      invoiceVoided("admin@demo.fixflow.test"),
      invoiceVoided("someone@example.com"),
      invoiceVoided("owner@coolbreeze.co.uk"),
    ]);

    expect((await logRows()).map((row) => row.status).sort()).toEqual([
      "LOGGED",
      "LOGGED",
      "LOGGED",
      "SENT",
    ]);
    expect(smtpSend).toHaveBeenCalledTimes(1);
    expect(smtpSend.mock.calls[0]?.[0].to).toBe("owner@coolbreeze.co.uk");
    expect(logSend).toHaveBeenCalledTimes(3);
  });
});
