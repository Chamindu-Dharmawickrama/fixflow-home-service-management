import { randomUUID } from "node:crypto";

import { preferredDateRange } from "@fixflow/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TEST_START_TIME } from "./test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "./test/db.js";
import { cookieFrom } from "./test/http.js";
import {
  type InvoiceWorld,
  invoiceWorld,
  payableInvoice,
  paymentBody,
  recordPaymentRequest,
  voidPaymentRequest,
} from "./test/invoice-world.js";

/**
 * Log redaction, end to end (T25, SEC-DATA-04, BR-20, CLAUDE.md §9). The auth, request and payment
 * flows run through the real app with the logger at `debug` and every line captured; then no
 * password, session token, reset address, customer email, request description, street, access note,
 * payment reference, payment note or void reason may appear in what was written. Each value is
 * marked so a match cannot be a coincidence, and the logs must show the requests themselves (so the
 * test cannot pass on an empty log).
 */

const prisma = getTestPrisma();
const SECRET = {
  password: "LOGSECRET violet harbour 4471",
  newPassword: "LOGSECRET copper lantern 9182",
  email: `log.secret.${randomUUID().slice(0, 8)}@example.test`,
  description:
    "LOGSECRET-DESCRIPTION the hallway unit leaks onto the stairs whenever it runs for an hour.",
  street: "LOGSECRET 9 Orchard Mews",
  accessNotes: "LOGSECRET-ACCESS gate code 7713, dog in the yard",
  paymentReference: "LOGSECRET-REF-88112",
  paymentNotes: "LOGSECRET-NOTE paid by the tenant on the landlord's behalf",
  voidReason: "LOGSECRET-VOID recorded against the wrong invoice by mistake",
} as const;

let w: InvoiceWorld;
const cookies: string[] = [];

beforeAll(async () => {
  await resetDatabase(prisma);
  // Every email is refused, so the delivery-failure log line (the one that names a recipient) is
  // written too: it must carry the masked address only.
  w = await invoiceWorld(prisma, {
    logLevel: "debug",
    emailSender: { send: () => Promise.reject(new Error("SMTP refused the message (test)")) },
  });

  // ---- Auth: register, a wrong password, sign in, forgot password, who am I, change password ------
  const register = await w.client.post("/api/v1/auth/register").send({
    name: "Lena Logs",
    email: SECRET.email,
    password: SECRET.password,
    passwordConfirmation: SECRET.password,
    acceptTerms: true,
  });
  expect(register.status, JSON.stringify(register.body)).toBe(201);
  cookies.push(cookieFrom(register, "fixflow_session"));
  const wrong = await w.client
    .post("/api/v1/auth/login")
    .send({ email: SECRET.email, password: `${SECRET.password}x` });
  expect(wrong.status, JSON.stringify(wrong.body)).toBe(401);
  const login = await w.client
    .post("/api/v1/auth/login")
    .send({ email: SECRET.email, password: SECRET.password });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  const cookie = cookieFrom(login, "fixflow_session");
  cookies.push(cookie);
  expect(
    (await w.client.post("/api/v1/auth/password/forgot").send({ email: SECRET.email })).status,
  ).toBe(200);
  expect((await w.client.get("/api/v1/auth/me", { cookie })).status).toBe(200);
  const change = await w.client.post("/api/v1/auth/password/change", { cookie }).send({
    currentPassword: SECRET.password,
    newPassword: SECRET.newPassword,
    newPasswordConfirmation: SECRET.newPassword,
  });
  expect(change.status, JSON.stringify(change.body)).toBe(200);
  const relogin = await w.client
    .post("/api/v1/auth/login")
    .send({ email: SECRET.email, password: SECRET.newPassword });
  expect(relogin.status, JSON.stringify(relogin.body)).toBe(200);
  const session = cookieFrom(relogin, "fixflow_session");
  cookies.push(session);

  // ---- A request: a saved address with access notes, and a description ---------------------------
  const address = await w.client.post("/api/v1/customers/me/addresses", { cookie: session }).send({
    label: "Home",
    line1: SECRET.street,
    city: "Harbor City",
    postalCode: "10999",
    accessNotes: SECRET.accessNotes,
  });
  expect(address.status, JSON.stringify(address.body)).toBe(201);
  const { min } = preferredDateRange(new Date(TEST_START_TIME), "America/New_York");
  const request = await w.client.post("/api/v1/requests", { cookie: session }).send({
    serviceId: w.service.id,
    description: SECRET.description,
    serviceAddressId: (address.body as { data: { id: string } }).data.id,
    preferredDate: min,
    preferredWindow: "MORNING",
    submissionKey: randomUUID(),
  });
  expect(request.status, JSON.stringify(request.body)).toBe(201);

  // ---- A payment with a reference and a note, then voided with a reason --------------------------
  const { invoice } = await payableInvoice(w);
  const payment = await recordPaymentRequest(
    w,
    invoice.id,
    paymentBody({ reference: SECRET.paymentReference, notes: SECRET.paymentNotes }),
  );
  expect(payment.status, JSON.stringify(payment.body)).toBe(201);
  const { id: paymentId } = await prisma.paymentRecord.findFirstOrThrow({
    where: { invoiceId: invoice.id },
    select: { id: true },
  });
  const voided = await voidPaymentRequest(w, invoice.id, paymentId, { reason: SECRET.voidReason });
  expect(voided.status, JSON.stringify(voided.body)).toBe(200);
  // Emails are sent after the response; let them be logged too.
  await w.deps.background.idle();
}, 120_000);

afterAll(async () => {
  await disconnectTestPrisma();
});

describe("what the logs hold after the auth, request and payment flows", () => {
  it("has a line for each request, so the searches below mean something", () => {
    const paths = w.logs
      .entries()
      .map((entry) => (entry.req as { path?: string } | undefined)?.path)
      .filter((url): url is string => typeof url === "string");
    for (const path of [
      "/api/v1/auth/register",
      "/api/v1/auth/login",
      "/api/v1/auth/password/forgot",
      "/api/v1/auth/password/change",
      "/api/v1/requests",
      "/api/v1/customers/me/addresses",
    ]) {
      expect(paths, path).toContain(path);
    }
    expect(paths.some((path) => path.endsWith("/payments"))).toBe(true);
    expect(paths.some((path) => path.endsWith("/void"))).toBe(true);
  });

  it("wrote the delivery failures, with a masked recipient", () => {
    const failures = w.logs
      .entries()
      .filter((entry) => typeof entry.to === "string" && entry.errorCode !== undefined);
    expect(failures.length).toBeGreaterThan(0);
    for (const entry of failures) expect(entry.to).toContain("***@");
  });

  it.each(Object.entries(SECRET))("never contains the %s", (_name, value) => {
    expect(w.logs.text()).not.toContain(value);
  });

  it("never contains a session token or a Cookie header", () => {
    const text = w.logs.text();
    for (const cookie of cookies) {
      const token = cookie.split("=")[1] ?? "";
      expect(token.length).toBeGreaterThan(20);
      expect(text).not.toContain(token);
    }
    expect(text).not.toMatch(/fixflow_session=/);
  });

  it("logs only the path of a URL, never a query string or a body", () => {
    for (const entry of w.logs.entries()) {
      const req = entry.req as { path?: string; url?: string; body?: unknown } | undefined;
      if (req === undefined) continue;
      expect(req.url).toBeUndefined();
      expect(req.body).toBeUndefined();
      expect(req.path ?? "").not.toContain("?");
    }
  });
});
