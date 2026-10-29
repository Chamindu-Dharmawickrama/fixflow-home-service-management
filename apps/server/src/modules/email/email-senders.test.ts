import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeClock } from "../../lib/clock.js";
import type { EmailMessage, EmailSender } from "./email.types.js";
import { emailStartupWarnings, RoutingEmailSender } from "./email-sender.js";
import { LogEmailSender } from "./log-email-sender.js";
import { SmtpEmailSender } from "./smtp-email-sender.js";

const MESSAGE: EmailMessage = {
  to: "alex.morgan@example.test",
  subject: "Reset your CoolBreeze password",
  html: "<p>Open <a href='https://fixflow.example.com/reset-password?token=t0k3n'>the link</a></p>",
  text: "Open https://fixflow.example.com/reset-password?token=t0k3n",
};

describe("LogEmailSender", () => {
  let outboxDir: string;
  const clock = new FakeClock("2026-10-28T15:30:00.123Z");
  const logger = { info: vi.fn() };

  beforeEach(async () => {
    outboxDir = await mkdtemp(join(tmpdir(), "fixflow-outbox-"));
    logger.info.mockClear();
  });

  afterEach(async () => {
    await rm(outboxDir, { recursive: true, force: true });
  });

  it("reports LOGGED, never SENT: nobody was emailed", async () => {
    const result = await new LogEmailSender({ logger, clock, outboxDir }).send(MESSAGE);

    expect(result).toEqual({ status: "LOGGED", transport: "log" });
  });

  it("writes the whole message to the outbox as a text file and an html file", async () => {
    await new LogEmailSender({ logger, clock, outboxDir }).send(MESSAGE);

    const files = (await readdir(outboxDir)).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^20261028T153000123Z-[0-9a-f]{8}\.html$/);
    expect(files[1]).toMatch(/^20261028T153000123Z-[0-9a-f]{8}\.txt$/);

    const text = await readFile(join(outboxDir, files[1] ?? ""), "utf8");
    expect(text).toContain("To: alex.morgan@example.test");
    expect(text).toContain("Subject: Reset your CoolBreeze password");
    expect(text).toContain("https://fixflow.example.com/reset-password?token=t0k3n");
    expect(await readFile(join(outboxDir, files[0] ?? ""), "utf8")).toBe(MESSAGE.html);
  });

  it("gives each email its own files", async () => {
    const sender = new LogEmailSender({ logger, clock, outboxDir });
    await sender.send(MESSAGE);
    await sender.send(MESSAGE);

    expect(await readdir(outboxDir)).toHaveLength(4);
  });

  it("logs only a masked recipient", async () => {
    await new LogEmailSender({ logger, clock, outboxDir }).send(MESSAGE);

    const [fields] = logger.info.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields.to).toBe("a***@example.test");
    expect(JSON.stringify(fields)).not.toContain("alex.morgan");
    expect(JSON.stringify(fields)).not.toContain("t0k3n");
  });

  it("names the files after the timestamp and the template", async () => {
    await new LogEmailSender({ logger, clock, outboxDir }).send({
      ...MESSAGE,
      template: "quotation-sent",
    });

    expect((await readdir(outboxDir)).sort()).toEqual([
      "20261028T153000123Z-quotation-sent.html",
      "20261028T153000123Z-quotation-sent.txt",
    ]);
  });

  it("keeps both emails when two of one template are logged in the same millisecond", async () => {
    const sender = new LogEmailSender({ logger, clock, outboxDir });
    await sender.send({ ...MESSAGE, subject: "First", template: "job-scheduled" });
    await sender.send({ ...MESSAGE, subject: "Second", template: "job-scheduled" });

    const files = (await readdir(outboxDir)).sort();
    expect(files).toEqual([
      "20261028T153000123Z-job-scheduled-2.html",
      "20261028T153000123Z-job-scheduled-2.txt",
      "20261028T153000123Z-job-scheduled.html",
      "20261028T153000123Z-job-scheduled.txt",
    ]);
    expect(
      await readFile(join(outboxDir, "20261028T153000123Z-job-scheduled.txt"), "utf8"),
    ).toContain("Subject: First");
    expect(
      await readFile(join(outboxDir, "20261028T153000123Z-job-scheduled-2.txt"), "utf8"),
    ).toContain("Subject: Second");
  });

  it("cannot be steered out of the outbox by a template name", async () => {
    await new LogEmailSender({ logger, clock, outboxDir }).send({
      ...MESSAGE,
      template: "../../etc/passwd",
    });

    const files = await readdir(outboxDir);
    expect(files).toHaveLength(2);
    for (const file of files) expect(file).toMatch(/^20261028T153000123Z-etc-passwd\.(txt|html)$/);
  });

  it("logs the template name along with the masked recipient and the subject", async () => {
    await new LogEmailSender({ logger, clock, outboxDir }).send({
      ...MESSAGE,
      template: "quotation-sent",
    });

    const [fields] = logger.info.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toMatchObject({
      to: "a***@example.test",
      subject: MESSAGE.subject,
      template: "quotation-sent",
    });
    expect(JSON.stringify(fields)).not.toContain("alex.morgan");
    expect(JSON.stringify(fields)).not.toContain("t0k3n");
  });

  it("writes no files when there is no outbox directory (production)", async () => {
    const result = await new LogEmailSender({ logger, clock }).send(MESSAGE);

    expect(result.status).toBe("LOGGED");
    expect(await readdir(outboxDir)).toEqual([]);
  });
});

describe("SmtpEmailSender", () => {
  it("hands the message to the transport and reports SENT", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "<abc@example.com>" });

    const result = await new SmtpEmailSender(
      { sendMail },
      "CoolBreeze <hello@coolbreeze.example>",
    ).send({ ...MESSAGE, to: "owner@coolbreeze.co.uk" });

    expect(result).toEqual({ status: "SENT", transport: "smtp" });
    expect(sendMail).toHaveBeenCalledWith({
      from: "CoolBreeze <hello@coolbreeze.example>",
      to: "owner@coolbreeze.co.uk",
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    });
  });

  it("strips line breaks from the recipient and subject", async () => {
    const sendMail = vi.fn().mockResolvedValue({});

    await new SmtpEmailSender({ sendMail }, "hello@coolbreeze.example").send({
      ...MESSAGE,
      to: "a@b.co\r\nBcc: attacker@example.test",
      subject: "Hello\r\nBcc: attacker@example.test",
    });

    const options = sendMail.mock.calls[0]?.[0] as { to: string; subject: string };
    expect(options.to).not.toMatch(/[\r\n]/);
    expect(options.subject).not.toMatch(/[\r\n]/);
  });

  it("does not pass the template name to the mail server", async () => {
    const sendMail = vi.fn().mockResolvedValue({});

    await new SmtpEmailSender({ sendMail }, "hello@coolbreeze.example").send({
      ...MESSAGE,
      template: "quotation-sent",
    });

    expect(Object.keys(sendMail.mock.calls[0]?.[0] as object).sort()).toEqual([
      "from",
      "html",
      "subject",
      "text",
      "to",
    ]);
  });

  it("closes its pooled connections, and copes with a transport that has none", () => {
    const close = vi.fn();

    new SmtpEmailSender({ sendMail: vi.fn(), close }, "hello@coolbreeze.example").close();
    new SmtpEmailSender({ sendMail: vi.fn() }, "hello@coolbreeze.example").close();

    expect(close).toHaveBeenCalledOnce();
  });

  it("lets a delivery failure propagate for sendAndLog to record", async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(
      new SmtpEmailSender({ sendMail }, "hello@coolbreeze.example").send(MESSAGE),
    ).rejects.toThrow("ECONNREFUSED");
  });
});

describe("emailStartupWarnings", () => {
  const log = {
    transport: "log",
    from: "x",
    smtp: undefined,
    publicWebUrl: "",
    outboxDir: undefined,
  };
  const smtp = {
    ...log,
    transport: "smtp",
    smtp: { host: "smtp.example.com", port: 587, secure: false, user: "u", password: "p" },
  } as const;

  it("warns that nothing is delivered when production uses the log transport", () => {
    const warnings = emailStartupWarnings({
      isProduction: true,
      email: { ...log, transport: "log" },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("EMAIL_TRANSPORT is log in production");
    expect(warnings[0]).toContain("no email is delivered");
  });

  it("is quiet for production with SMTP, and for the log transport outside production", () => {
    expect(emailStartupWarnings({ isProduction: true, email: smtp })).toEqual([]);
    expect(
      emailStartupWarnings({ isProduction: false, email: { ...log, transport: "log" } }),
    ).toEqual([]);
  });
});

describe("RoutingEmailSender (D-52)", () => {
  const logSend = vi.fn().mockResolvedValue({ status: "LOGGED", transport: "log" });
  const smtpSend = vi.fn().mockResolvedValue({ status: "SENT", transport: "smtp" });
  const log: EmailSender = { send: logSend };
  const smtp: EmailSender = { send: smtpSend };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends real addresses through SMTP", async () => {
    const result = await new RoutingEmailSender(log, smtp).send({
      ...MESSAGE,
      to: "owner@coolbreeze.co.uk",
    });

    expect(result.status).toBe("SENT");
    expect(smtpSend).toHaveBeenCalledOnce();
    expect(logSend).not.toHaveBeenCalled();
  });

  it.each(["alex.morgan@example.test", "admin@demo.fixflow.test", "x@example.com"])(
    "always logs %s, even with SMTP configured",
    async (to) => {
      const result = await new RoutingEmailSender(log, smtp).send({ ...MESSAGE, to });

      expect(result.status).toBe("LOGGED");
      expect(smtpSend).not.toHaveBeenCalled();
    },
  );

  it("closes the SMTP transport, and has nothing to close without one", () => {
    const close = vi.fn();

    new RoutingEmailSender(log, { send: smtpSend, close }).close();
    new RoutingEmailSender(log, undefined).close();

    expect(close).toHaveBeenCalledOnce();
  });

  it("logs everything when SMTP is not configured", async () => {
    const result = await new RoutingEmailSender(log, undefined).send({
      ...MESSAGE,
      to: "owner@coolbreeze.co.uk",
    });

    expect(result.status).toBe("LOGGED");
  });
});
