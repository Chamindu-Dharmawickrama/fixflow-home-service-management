import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeClock } from "../../lib/clock.js";
import { createLogger } from "../../lib/logger.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { RecordingEmailSender } from "../../test/fakes.js";
import { createLogCapture } from "../../test/log-capture.js";
import { type EmailDeps, sendAndLog } from "./email.service.js";
import type { EmailMessage, EmailSender } from "./email.types.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const MESSAGE: EmailMessage = {
  to: "alex.morgan@example.test",
  subject: "Reset your password",
  html: "<p>Open https://fixflow.example.com/reset-password?token=t0k3n</p>",
  text: "Open https://fixflow.example.com/reset-password?token=t0k3n",
};

function depsFor(emailSender: EmailSender, overrides: Partial<EmailDeps> = {}) {
  const logs = createLogCapture();
  const deps: EmailDeps = {
    prisma,
    emailSender,
    clock: new FakeClock("2026-10-28T15:30:00.000Z"),
    logger: createLogger({ level: "info", pretty: false }, logs.stream),
    ...overrides,
  };
  return { deps, logs };
}

describe("sendAndLog", () => {
  it("records a logged-only email as LOGGED, with no sent time", async () => {
    const { deps } = depsFor(new RecordingEmailSender());

    const outcome = await sendAndLog(deps, { template: "password-reset", message: MESSAGE });

    expect(outcome).toBe("LOGGED");
    const [row, ...rest] = await prisma.emailDeliveryLog.findMany();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      template: "password-reset",
      recipientMasked: "a***@example.test",
      transport: "log",
      status: "LOGGED",
      errorCode: null,
      sentAt: null,
    });
    expect(row?.attemptedAt?.toISOString()).toBe("2026-10-28T15:30:00.000Z");
  });

  it("records an email an SMTP server accepted as SENT, with the time", async () => {
    const smtp: EmailSender = {
      send: () => Promise.resolve({ status: "SENT", transport: "smtp" }),
    };
    const { deps } = depsFor(smtp);

    const outcome = await sendAndLog(deps, {
      template: "password-reset",
      message: { ...MESSAGE, to: "owner@coolbreeze.co.uk" },
    });

    expect(outcome).toBe("SENT");
    expect(await prisma.emailDeliveryLog.findFirstOrThrow()).toMatchObject({
      status: "SENT",
      transport: "smtp",
      recipientMasked: "o***@coolbreeze.co.uk",
    });
    expect((await prisma.emailDeliveryLog.findFirstOrThrow()).sentAt?.toISOString()).toBe(
      "2026-10-28T15:30:00.000Z",
    );
  });

  it("never throws when delivery fails: it records FAILED with a short code and returns", async () => {
    const failing = new RecordingEmailSender();
    failing.failWith = Object.assign(
      new Error("550 Recipient alex.morgan@example.test rejected by smtp.internal"),
      { code: "EENVELOPE" },
    );
    const { deps, logs } = depsFor(failing);

    await expect(sendAndLog(deps, { template: "password-reset", message: MESSAGE })).resolves.toBe(
      "FAILED",
    );

    expect(await prisma.emailDeliveryLog.findFirstOrThrow()).toMatchObject({
      status: "FAILED",
      errorCode: "EENVELOPE",
      sentAt: null,
    });
    // The SMTP error text can contain the full address, so only the code is logged.
    expect(logs.text()).not.toContain("alex.morgan");
    expect(logs.text()).toContain("EENVELOPE");
  });

  it("uses a generic code for an error without a usable one", async () => {
    const failing = new RecordingEmailSender();
    failing.failWith = Object.assign(new Error("boom"), { code: "not a safe code; DROP TABLE" });
    const { deps } = depsFor(failing);

    await sendAndLog(deps, { template: "password-reset", message: MESSAGE });

    expect((await prisma.emailDeliveryLog.findFirstOrThrow()).errorCode).toBe("SEND_FAILED");
  });

  it("never stores the address or the message body", async () => {
    const { deps } = depsFor(new RecordingEmailSender());

    await sendAndLog(deps, { template: "password-reset", message: MESSAGE });

    const stored = JSON.stringify(await prisma.emailDeliveryLog.findMany());
    expect(stored).not.toContain("alex.morgan");
    expect(stored).not.toContain("t0k3n");
    expect(stored).not.toContain("Reset your password");
  });

  it("still sends, and still does not throw, when the delivery record cannot be written", async () => {
    const sender = new RecordingEmailSender();
    const brokenPrisma = {
      emailDeliveryLog: {
        create: vi.fn().mockRejectedValue(new Error("database down")),
        update: vi.fn(),
      },
    } as unknown as EmailDeps["prisma"];
    const { deps } = depsFor(sender, { prisma: brokenPrisma });

    await expect(sendAndLog(deps, { template: "password-reset", message: MESSAGE })).resolves.toBe(
      "LOGGED",
    );

    expect(sender.sent).toHaveLength(1);
  });

  it("does not throw when updating the record fails after a send", async () => {
    const sender = new RecordingEmailSender();
    const flakyPrisma = {
      emailDeliveryLog: {
        create: vi.fn().mockResolvedValue({ id: "log-1" }),
        update: vi.fn().mockRejectedValue(new Error("database down")),
      },
    } as unknown as EmailDeps["prisma"];
    const { deps } = depsFor(sender, { prisma: flakyPrisma });

    await expect(sendAndLog(deps, { template: "password-reset", message: MESSAGE })).resolves.toBe(
      "LOGGED",
    );
  });
});
