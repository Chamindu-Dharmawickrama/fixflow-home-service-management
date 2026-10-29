import {
  ErrorCode,
  type NotificationDto,
  type NotificationListResponse,
  type NotificationType,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "../../lib/db.js";
import { createLocalAdmin, createLocalCustomer, signInAs } from "../../test/auth-helpers.js";
import { buildTestApp, TEST_ADMIN_EMAIL } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import { createBusinessSettings } from "../../test/fixtures.js";
import { api, bodyOf, expectApiError } from "../../test/http.js";
import { NotificationValidationError } from "./notifications.domain.js";
import { notify, notifyAdmins } from "./notifications.service.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const ALEX = "alex.morgan@example.test";
const PRIYA = "priya.shah@example.test";
const LIST = "/api/v1/notifications/me";
const READ_ALL = "/api/v1/notifications/me/read-all";
const markReadPath = (id: string) => `/api/v1/notifications/${id}/read`;

/** The keys the recipient receives for each notification. */
const NOTIFICATION_KEYS = ["createdAt", "id", "linkPath", "message", "readAt", "title", "type"];

async function give(
  recipientUserId: string,
  title: string,
  overrides: { type?: NotificationType; createdAt?: Date; readAt?: Date | null } = {},
) {
  const row = await notify(prisma, {
    recipientUserId,
    type: overrides.type ?? "QUOTATION_SENT",
    title,
    message: `${title}: open it to see the details.`,
    linkPath: "/portal/quotations/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    entity: { type: "QUOTATION", id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" },
  });
  if (overrides.createdAt === undefined && overrides.readAt === undefined) return row;
  return prisma.notification.update({
    where: { id: row.id },
    data: {
      ...(overrides.createdAt !== undefined && { createdAt: overrides.createdAt }),
      ...(overrides.readAt !== undefined && { readAt: overrides.readAt }),
    },
  });
}

/** An app with two customers and an admin, each signed in. */
async function world(options: Parameters<typeof buildTestApp>[0] = {}) {
  await createBusinessSettings(prisma, { timeZone: "America/New_York" });
  const test = buildTestApp({ prisma, ...options });
  const alex = await createLocalCustomer(prisma, { email: ALEX, name: "Alex Morgan" });
  const priya = await createLocalCustomer(prisma, { email: PRIYA, name: "Priya Shah" });
  const admin = await createLocalAdmin(prisma);
  return {
    ...test,
    alex,
    priya,
    admin,
    alexCookie: await signInAs(test.app, ALEX),
    priyaCookie: await signInAs(test.app, PRIYA),
    adminCookie: await signInAs(test.app, admin.email),
  };
}

describe("authentication", () => {
  it.each([
    ["GET", LIST],
    ["POST", READ_ALL],
    ["PATCH", markReadPath("0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11")],
  ] as const)("answers 401 to %s %s without a session", async (method, path) => {
    const { app } = buildTestApp({ prisma });
    const client = api(app);

    const response =
      method === "GET"
        ? await client.get(path)
        : method === "POST"
          ? await client.post(path)
          : await client.patch(path);

    expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
  });

  it("refuses an unsafe request that does not come from the web app's origin (CSRF)", async () => {
    const w = await world();
    const row = await give(w.alex.user.id, "Quotation ready");

    const response = await api(w.app).patch(markReadPath(row.id), {
      cookie: w.alexCookie,
      origin: "https://evil.example.com",
    });

    expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt,
    ).toBeNull();
  });

  it("answers 403 to an admin who is no longer on the allowlist (D-71)", async () => {
    const w = await world({ env: { ADMIN_EMAILS: "someone.else@example.test" } });
    await give(w.admin.id, "New request received", { type: "REQUEST_RECEIVED" });

    const response = await api(w.app).get(LIST, { cookie: w.adminCookie });

    expectApiError(response, { status: 403, code: ErrorCode.FORBIDDEN });
  });
});

describe("GET /notifications/me", () => {
  it("lists only the caller's own notifications, newest first, with the unread count in meta", async () => {
    const w = await world();
    await give(w.alex.user.id, "Oldest", { createdAt: new Date("2026-10-01T09:00:00.000Z") });
    await give(w.alex.user.id, "Newest", { createdAt: new Date("2026-10-03T09:00:00.000Z") });
    await give(w.alex.user.id, "Middle", { createdAt: new Date("2026-10-02T09:00:00.000Z") });
    await give(w.priya.user.id, "Priya's private notification");
    await give(w.admin.id, "Admin's notification", { type: "REQUEST_RECEIVED" });

    const response = await api(w.app).get(LIST, { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    const body = bodyOf<NotificationListResponse>(response);
    expect(body.data.map((item) => item.title)).toEqual(["Newest", "Middle", "Oldest"]);
    expect(body.meta).toEqual({ unreadCount: 3, timeZone: "America/New_York" });
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 3, totalPages: 1 });
    expect(JSON.stringify(body)).not.toContain("Priya's private notification");
    expect(JSON.stringify(body)).not.toContain("Admin's notification");
  });

  it("shows each person only their own, in both directions", async () => {
    const w = await world();
    await give(w.alex.user.id, "For Alex");
    await give(w.priya.user.id, "For Priya");
    await give(w.admin.id, "For the admin", { type: "REQUEST_RECEIVED" });

    const titlesFor = async (cookie: string) =>
      bodyOf<NotificationListResponse>(await api(w.app).get(LIST, { cookie })).data.map(
        (item) => item.title,
      );

    expect(await titlesFor(w.alexCookie)).toEqual(["For Alex"]);
    expect(await titlesFor(w.priyaCookie)).toEqual(["For Priya"]);
    expect(await titlesFor(w.adminCookie)).toEqual(["For the admin"]);
  });

  it("returns exactly the allowlisted keys for each notification", async () => {
    const w = await world();
    await give(w.alex.user.id, "Quotation ready");

    const body = bodyOf<NotificationListResponse>(
      await api(w.app).get(LIST, { cookie: w.alexCookie }),
    );

    expect(Object.keys(body.data[0] ?? {}).sort()).toEqual(NOTIFICATION_KEYS);
    expect(JSON.stringify(body)).not.toContain(w.alex.user.id);
  });

  it("counts unread across all pages and ignores the unreadOnly filter in that count", async () => {
    const w = await world();
    await give(w.alex.user.id, "Read one", { readAt: new Date("2026-10-01T10:00:00.000Z") });
    await give(w.alex.user.id, "Unread one");
    await give(w.alex.user.id, "Unread two");

    const unreadOnly = bodyOf<NotificationListResponse>(
      await api(w.app).get(`${LIST}?unreadOnly=true`, { cookie: w.alexCookie }),
    );
    const everything = bodyOf<NotificationListResponse>(
      await api(w.app).get(LIST, { cookie: w.alexCookie }),
    );

    expect(unreadOnly.data.map((item) => item.title).sort()).toEqual(["Unread one", "Unread two"]);
    expect(unreadOnly.pagination.totalItems).toBe(2);
    expect(unreadOnly.meta.unreadCount).toBe(2);
    expect(everything.pagination.totalItems).toBe(3);
    expect(everything.meta.unreadCount).toBe(2);
  });

  it("paginates, and the unread count covers every page", async () => {
    const w = await world();
    for (let day = 1; day <= 25; day += 1) {
      await give(w.alex.user.id, `Notice ${String(day).padStart(2, "0")}`, {
        createdAt: new Date(Date.UTC(2026, 9, day, 9)),
      });
    }

    const page = async (n: number) =>
      bodyOf<NotificationListResponse>(
        await api(w.app).get(`${LIST}?page=${n}&pageSize=10`, { cookie: w.alexCookie }),
      );
    const [first, second, third] = [await page(1), await page(2), await page(3)];

    expect(first.data.map((item) => item.title)[0]).toBe("Notice 25");
    expect(first.data).toHaveLength(10);
    expect(second.data).toHaveLength(10);
    expect(third.data).toHaveLength(5);
    expect(third.data.at(-1)?.title).toBe("Notice 01");
    expect(third.pagination).toEqual({ page: 3, pageSize: 10, totalItems: 25, totalPages: 3 });
    for (const result of [first, second, third]) expect(result.meta.unreadCount).toBe(25);
    const allIds = [...first.data, ...second.data, ...third.data].map((item) => item.id);
    expect(new Set(allIds).size).toBe(25);
  });

  it("returns an empty list with a zero count when there is nothing", async () => {
    const w = await world();

    const body = bodyOf<NotificationListResponse>(
      await api(w.app).get(LIST, { cookie: w.alexCookie }),
    );

    expect(body).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      meta: { unreadCount: 0, timeZone: "America/New_York" },
    });
  });

  it("falls back to UTC for the time zone if the settings row is missing", async () => {
    const w = await world();
    await prisma.businessSettings.deleteMany();

    const body = bodyOf<NotificationListResponse>(
      await api(w.app).get(LIST, { cookie: w.alexCookie }),
    );

    expect(body.meta.timeZone).toBe("UTC");
  });

  it.each(["pageSize=101", "pageSize=0", "page=0", "unreadOnly=maybe", "sort=title"])(
    "answers 422 to the query %s",
    async (query) => {
      const w = await world();

      const response = await api(w.app).get(`${LIST}?${query}`, { cookie: w.alexCookie });

      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    },
  );

  it("is rate limited per user (429 with Retry-After)", async () => {
    const w = await world({ rateLimits: { notificationsRead: { limit: 2, windowSeconds: 60 } } });

    await api(w.app).get(LIST, { cookie: w.alexCookie });
    await api(w.app).get(LIST, { cookie: w.alexCookie });
    const third = await api(w.app).get(LIST, { cookie: w.alexCookie });
    const otherUser = await api(w.app).get(LIST, { cookie: w.priyaCookie });

    expectApiError(third, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
    expect(otherUser.status).toBe(200);
  });
});

describe("PATCH /notifications/:id/read", () => {
  it("marks the recipient's own notification as read and lowers their unread count", async () => {
    const w = await world();
    const row = await give(w.alex.user.id, "Quotation ready");
    await give(w.alex.user.id, "Another");

    const response = await api(w.app).patch(markReadPath(row.id), { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    const { data } = bodyOf<{ data: NotificationDto }>(response);
    expect(data).toMatchObject({
      id: row.id,
      title: "Quotation ready",
      readAt: w.clock.now().toISOString(),
    });
    expect(Object.keys(data).sort()).toEqual(NOTIFICATION_KEYS);
    const list = bodyOf<NotificationListResponse>(
      await api(w.app).get(LIST, { cookie: w.alexCookie }),
    );
    expect(list.meta.unreadCount).toBe(1);
  });

  it("is idempotent: repeating it keeps the first read time", async () => {
    const w = await world();
    const row = await give(w.alex.user.id, "Quotation ready");

    const first = bodyOf<{ data: NotificationDto }>(
      await api(w.app).patch(markReadPath(row.id), { cookie: w.alexCookie }),
    );
    w.clock.advanceSeconds(3600);
    const second = await api(w.app).patch(markReadPath(row.id), { cookie: w.alexCookie });

    expect(second.status).toBe(200);
    expect(bodyOf<{ data: NotificationDto }>(second).data.readAt).toBe(first.data.readAt);
    const stored = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.readAt?.toISOString()).toBe(first.data.readAt);
  });

  it("answers 404 for someone else's notification and leaves it unchanged", async () => {
    const w = await world();
    const priyas = await give(w.priya.user.id, "Priya's quotation");
    const admins = await give(w.admin.id, "Admin only", { type: "REQUEST_RECEIVED" });

    for (const cookie of [w.alexCookie, w.adminCookie]) {
      const response = await api(w.app).patch(markReadPath(priyas.id), { cookie });
      expectApiError(response, { status: 404, code: ErrorCode.NOT_FOUND });
    }
    expectApiError(await api(w.app).patch(markReadPath(admins.id), { cookie: w.alexCookie }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });

    for (const id of [priyas.id, admins.id]) {
      expect((await prisma.notification.findUniqueOrThrow({ where: { id } })).readAt).toBeNull();
    }
  });

  it("answers a missing notification exactly as it answers someone else's (no id probing)", async () => {
    const w = await world();
    const priyas = await give(w.priya.user.id, "Priya's quotation");

    const notOwned = await api(w.app).patch(markReadPath(priyas.id), { cookie: w.alexCookie });
    const missing = await api(w.app).patch(markReadPath("dddddddd-dddd-4ddd-8ddd-dddddddddddd"), {
      cookie: w.alexCookie,
    });

    expect(notOwned.status).toBe(missing.status);
    expect(bodyOf<{ error: { code: string; message: string } }>(notOwned).error).toMatchObject({
      code: bodyOf<{ error: { code: string } }>(missing).error.code,
      message: bodyOf<{ error: { message: string } }>(missing).error.message,
    });
  });

  it("answers 422 to an id that is not a UUID", async () => {
    const w = await world();

    const response = await api(w.app).patch(markReadPath("not-an-id"), { cookie: w.alexCookie });

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
  });
});

describe("POST /notifications/me/read-all", () => {
  it("marks all of the caller's unread notifications and nobody else's", async () => {
    const w = await world();
    const earlier = new Date("2026-10-01T10:00:00.000Z");
    await give(w.alex.user.id, "Unread 1");
    await give(w.alex.user.id, "Unread 2");
    await give(w.alex.user.id, "Unread 3");
    const alreadyRead = await give(w.alex.user.id, "Read earlier", { readAt: earlier });
    const priyas = await give(w.priya.user.id, "Priya's 1");
    const admins = await give(w.admin.id, "Admin's 1", { type: "REQUEST_RECEIVED" });

    const response = await api(w.app).post(READ_ALL, { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    expect(bodyOf<{ data: { updated: number } }>(response).data).toEqual({ updated: 3 });
    const unreadFor = (recipientUserId: string) =>
      prisma.notification.count({ where: { recipientUserId, readAt: null } });
    expect(await unreadFor(w.alex.user.id)).toBe(0);
    expect(await unreadFor(w.priya.user.id)).toBe(1);
    expect(await unreadFor(w.admin.id)).toBe(1);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: priyas.id } })).readAt,
    ).toBeNull();
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: admins.id } })).readAt,
    ).toBeNull();
    // Already-read notifications keep their original read time.
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: alreadyRead.id } })).readAt,
    ).toEqual(earlier);
  });

  it("is idempotent and reports a zero count the second time", async () => {
    const w = await world();
    await give(w.alex.user.id, "Unread 1");

    await api(w.app).post(READ_ALL, { cookie: w.alexCookie });
    const second = await api(w.app).post(READ_ALL, { cookie: w.alexCookie });

    expect(second.status).toBe(200);
    expect(bodyOf<{ data: { updated: number } }>(second).data.updated).toBe(0);
  });
});

describe("notify (D-38)", () => {
  it("creates a notification inside the caller's transaction", async () => {
    const { user } = await createLocalCustomer(prisma, { email: ALEX });

    await prisma.$transaction(async (tx) => {
      await notify(tx, {
        recipientUserId: user.id,
        type: "INVOICE_ISSUED",
        title: "Invoice INV-2026-00007 is ready",
        message: "You can view it and see how to pay.",
        linkPath: "/portal/invoices/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
        entity: { type: "INVOICE", id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" },
      });
    });

    const stored = await prisma.notification.findFirstOrThrow();
    expect(stored).toMatchObject({
      recipientUserId: user.id,
      type: "INVOICE_ISSUED",
      readAt: null,
      entityType: "INVOICE",
      entityId: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
    });
  });

  it("disappears with the transaction when the business operation fails", async () => {
    const { user } = await createLocalCustomer(prisma, { email: ALEX });

    await expect(
      prisma.$transaction(async (tx) => {
        await notify(tx, {
          recipientUserId: user.id,
          type: "QUOTATION_SENT",
          title: "Quotation ready",
          message: "Please review it.",
          linkPath: "/portal/quotations/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
        });
        throw new Error("the business operation failed afterwards");
      }),
    ).rejects.toThrow("failed afterwards");

    expect(await prisma.notification.count()).toBe(0);
  });

  it.each([
    "https://evil.example.com/portal",
    "//evil.example.com/portal",
    "javascript:alert(1)",
    "/login",
    "portal/quotations/1",
  ])("refuses the link %s and writes nothing", async (linkPath) => {
    const { user } = await createLocalCustomer(prisma, { email: ALEX });

    await expect(
      notify(prisma, {
        recipientUserId: user.id,
        type: "QUOTATION_SENT",
        title: "Quotation ready",
        message: "Please review it.",
        linkPath,
      }),
    ).rejects.toBeInstanceOf(NotificationValidationError);
    expect(await prisma.notification.count()).toBe(0);
  });

  it("does not create a notification for a user that does not exist", async () => {
    await expect(
      notify(prisma, {
        recipientUserId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        type: "QUOTATION_SENT",
        title: "Quotation ready",
        message: "Please review it.",
        linkPath: "/portal/quotations/1",
      }),
    ).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe("notifyAdmins (D-38)", () => {
  const content = {
    type: "REQUEST_RECEIVED",
    title: "New request FF-2026-00012",
    message: "Alex Morgan asked for AC Repair.",
    linkPath: "/app/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  } as const;

  async function admins(client: PrismaClient) {
    const first = await createLocalAdmin(client, { email: "first.admin@example.test" });
    const second = await createLocalAdmin(client, { email: "second.admin@example.test" });
    const inactive = await createLocalAdmin(client, { email: "inactive.admin@example.test" });
    await client.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    return { first, second, inactive };
  }

  it("notifies every active admin once, and no customer or deactivated admin", async () => {
    const { first, second, inactive } = await admins(prisma);
    const { user: customer } = await createLocalCustomer(prisma, { email: ALEX });

    const created = await notifyAdmins(prisma, content);

    expect(created).toHaveLength(2);
    const recipients = (await prisma.notification.findMany()).map((n) => n.recipientUserId).sort();
    expect(recipients).toEqual([first.id, second.id].sort());
    expect(recipients).not.toContain(inactive.id);
    expect(recipients).not.toContain(customer.id);
    expect(await prisma.notification.count({ where: { type: "REQUEST_RECEIVED" } })).toBe(2);
  });

  it("returns an empty list when there is no active admin", async () => {
    await createLocalCustomer(prisma, { email: ALEX });

    expect(await notifyAdmins(prisma, content)).toEqual([]);
    expect(await prisma.notification.count()).toBe(0);
  });

  it("validates the link before creating anything, and rolls back with the transaction", async () => {
    await admins(prisma);

    await expect(
      notifyAdmins(prisma, { ...content, linkPath: "https://evil.example.com/app" }),
    ).rejects.toBeInstanceOf(NotificationValidationError);
    await expect(
      prisma.$transaction(async (tx) => {
        await notifyAdmins(tx, content);
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");

    expect(await prisma.notification.count()).toBe(0);
  });

  it("lets each admin read their own copy and mark it read without affecting the other", async () => {
    const w = await world({
      env: { ADMIN_EMAILS: `${TEST_ADMIN_EMAIL},second.admin@example.test` },
    });
    const second = await createLocalAdmin(prisma, { email: "second.admin@example.test" });
    const created = await notifyAdmins(prisma, content);
    const secondCookie = await signInAs(w.app, second.email);

    const mine = created.find((n) => n.recipientUserId === w.admin.id);
    await api(w.app).patch(markReadPath(mine?.id ?? ""), { cookie: w.adminCookie });

    const first = bodyOf<NotificationListResponse>(
      await api(w.app).get(LIST, { cookie: w.adminCookie }),
    );
    const other = bodyOf<NotificationListResponse>(
      await api(w.app).get(LIST, { cookie: secondCookie }),
    );
    expect(first.meta.unreadCount).toBe(0);
    expect(other.meta.unreadCount).toBe(1);
  });
});
