import { describe, expect, it } from "vitest";

import {
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
} from "./notifications.schemas.js";

describe("listNotificationsQuerySchema", () => {
  it("defaults to the first page of 20, newest first, all notifications", () => {
    expect(listNotificationsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: "createdAt",
      order: "desc",
      unreadOnly: false,
    });
  });

  it("reads unreadOnly, page and pageSize from the query string", () => {
    expect(
      listNotificationsQuerySchema.parse({ unreadOnly: "true", page: "3", pageSize: "10" }),
    ).toMatchObject({ unreadOnly: true, page: 3, pageSize: 10 });
    expect(listNotificationsQuerySchema.parse({ unreadOnly: "false" }).unreadOnly).toBe(false);
  });

  it.each([
    ["unreadOnly=yes", { unreadOnly: "yes" }],
    ["unreadOnly=1", { unreadOnly: "1" }],
    ["pageSize above the maximum", { pageSize: "101" }],
    ["pageSize=0", { pageSize: "0" }],
    ["page=0", { page: "0" }],
    ["a non-numeric page", { page: "two" }],
    ["a sort field that is not allowed", { sort: "title" }],
    ["an order that is not allowed", { order: "sideways" }],
  ])("rejects %s", (_name, query) => {
    expect(listNotificationsQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe("notificationIdParamsSchema", () => {
  it("accepts a UUID and rejects anything else", () => {
    expect(
      notificationIdParamsSchema.safeParse({ id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11" }).success,
    ).toBe(true);
    for (const id of ["", "me", "1", "../auth/me", "0b6c1e0e-6f1a-4b0e-9f1d"]) {
      expect(notificationIdParamsSchema.safeParse({ id }).success).toBe(false);
    }
  });
});
