import nodemailer from "nodemailer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSmtpTransport } from "./smtp-email-sender.js";

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn(), close: vi.fn() })) },
}));

const createTransport = vi.mocked(nodemailer.createTransport);

function optionsOfLastCall(): Record<string, unknown> {
  return createTransport.mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>;
}

const SETTINGS = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: "mailer",
  password: "smtp-password-not-real",
} as const;

beforeEach(() => {
  createTransport.mockClear();
});

describe("createSmtpTransport", () => {
  it("pools connections and sets connection, greeting and socket timeouts", () => {
    createSmtpTransport(SETTINGS, true);

    expect(optionsOfLastCall()).toMatchObject({
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      host: "smtp.example.com",
      port: 587,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  });

  it("follows SMTP_SECURE: implicit TLS for true, STARTTLS for false", () => {
    createSmtpTransport({ ...SETTINGS, port: 465, secure: true }, true);
    expect(optionsOfLastCall()).toMatchObject({ secure: true, requireTLS: false });

    createSmtpTransport(SETTINGS, true);
    expect(optionsOfLastCall()).toMatchObject({ secure: false, requireTLS: true });
  });

  it("insists on a TLS upgrade in production only, and never below TLS 1.2", () => {
    createSmtpTransport(SETTINGS, false);
    expect(optionsOfLastCall()).toMatchObject({ requireTLS: false });

    createSmtpTransport(SETTINGS, true);
    expect(optionsOfLastCall()).toMatchObject({ tls: { minVersion: "TLSv1.2" } });
  });

  it("authenticates only when credentials are configured", () => {
    createSmtpTransport(SETTINGS, true);
    expect(optionsOfLastCall()).toMatchObject({
      auth: { user: "mailer", pass: "smtp-password-not-real" },
    });

    createSmtpTransport({ ...SETTINGS, user: undefined, password: undefined }, true);
    expect(optionsOfLastCall()).not.toHaveProperty("auth");
  });
});
