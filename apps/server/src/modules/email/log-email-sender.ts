import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Clock } from "../../lib/clock.js";
import { maskEmail } from "../../lib/email-address.js";
import type { Logger } from "../../lib/logger.js";
import type { EmailMessage, EmailSender, EmailSendResult } from "./email.types.js";

export interface LogEmailSenderOptions {
  logger: Pick<Logger, "info">;
  clock: Clock;
  /**
   * Where each email is written in full (a `.txt` and a `.html` file), so a developer can open the
   * reset link. Leave it out to log only: production never writes message bodies to disk.
   */
  outboxDir?: string | undefined;
}

/** A template name reduced to file-name-safe characters, or `undefined` if nothing usable is left. */
function fileLabel(template: string | undefined): string | undefined {
  const label = template
    ?.toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return label === undefined || label === "" ? undefined : label.slice(0, 40);
}

const MAX_NAME_ATTEMPTS = 100;

/**
 * Writes `content` to `<dir>/<stem>.txt`, or `<stem>-2.txt`, `-3`, … if that name is taken, and
 * never overwrites an existing file (two emails of one template in the same millisecond must both
 * survive). Returns the path without its extension.
 */
async function writeNewFile(dir: string, stem: string, content: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const base = join(dir, attempt === 1 ? stem : `${stem}-${attempt}`);
    try {
      await writeFile(`${base}.txt`, content, { encoding: "utf8", flag: "wx" });
      return base;
    } catch (error) {
      const taken = error instanceof Error && "code" in error && error.code === "EEXIST";
      if (!taken) throw error;
    }
  }
  throw new Error("Could not find a free file name in the outbox.");
}

/**
 * The development and test transport. It logs a masked recipient, the subject and the template and,
 * when an outbox directory is set, writes the complete message to
 * `<outbox>/<timestamp>-<template>.txt` and `.html`. Nothing is delivered, so the result is
 * `LOGGED`, never `SENT` (the UI must not claim an email arrived).
 */
export class LogEmailSender implements EmailSender {
  constructor(private readonly options: LogEmailSenderOptions) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const { logger, clock, outboxDir } = this.options;
    let file: string | undefined;

    if (outboxDir !== undefined) {
      await mkdir(outboxDir, { recursive: true });
      const stamp = clock.now().toISOString().replace(/[-:.]/g, "");
      const stem = `${stamp}-${fileLabel(message.template) ?? randomBytes(4).toString("hex")}`;
      const header = [
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        `Date: ${clock.now().toISOString()}`,
        "",
        "",
      ].join("\n");
      const base = await writeNewFile(outboxDir, stem, `${header}${message.text}\n`);
      await writeFile(`${base}.html`, message.html, "utf8");
      file = `${base}.txt`;
    }

    logger.info(
      {
        to: maskEmail(message.to),
        subject: message.subject,
        ...(message.template !== undefined && { template: message.template }),
        ...(file !== undefined && { file }),
      },
      "Email written to the log transport (not delivered)",
    );
    return { status: "LOGGED", transport: "log" };
  }
}
