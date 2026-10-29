import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "@playwright/test";

import { OUTBOX_DIR } from "./env.js";

export interface OutboxEmail {
  file: string;
  to: string;
  subject: string;
  text: string;
}

/** Every email the API's log transport has written so far, oldest first. */
export function readOutbox(): OutboxEmail[] {
  let files: string[];
  try {
    files = readdirSync(OUTBOX_DIR).filter((name) => name.endsWith(".txt"));
  } catch {
    return [];
  }
  return files.sort().map((name) => {
    const raw = readFileSync(join(OUTBOX_DIR, name), "utf8");
    const [header = "", ...body] = raw.split(/\r?\n\r?\n/);
    const field = (label: string): string =>
      new RegExp(`^${label}: (.*)$`, "m").exec(header)?.[1]?.trim() ?? "";
    return { file: name, to: field("To"), subject: field("Subject"), text: body.join("\n\n") };
  });
}

/**
 * Waits for the newest email to `to`, then returns it. Emails are sent in the background after the
 * API has answered, so the file can appear a moment after the page shows its confirmation.
 */
export async function waitForEmailTo(to: string): Promise<OutboxEmail> {
  let found: OutboxEmail | undefined;
  await expect
    .poll(
      () => {
        found = readOutbox()
          .filter((email) => email.to.toLowerCase() === to.toLowerCase())
          .at(-1);
        return found !== undefined;
      },
      { message: `No email to ${to} reached the outbox`, timeout: 15_000 },
    )
    .toBe(true);
  if (found === undefined) throw new Error(`No email to ${to} reached the outbox.`);
  return found;
}

/** The first link in an email's text body. */
export function linkIn(email: OutboxEmail): string {
  const link = /https?:\/\/\S+/.exec(email.text)?.[0];
  if (link === undefined) throw new Error(`The email "${email.subject}" has no link.`);
  return link;
}

/** Waits for the reset email to `to` and returns its link, as it would be opened from a mail client. */
export async function waitForResetLink(to: string): Promise<string> {
  return linkIn(await waitForEmailTo(to));
}
