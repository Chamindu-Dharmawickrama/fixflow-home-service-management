import { describe, expect, it } from "vitest";

import type { Notification } from "../../generated/prisma/client.js";
import { toNotificationDto } from "./notifications.dto.js";

const ROW: Notification = {
  id: "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
  recipientUserId: "11111111-1111-4111-8111-111111111111",
  type: "INVOICE_ISSUED",
  title: "Invoice INV-2026-00007 is ready",
  message: "You can view it and see how to pay.",
  linkPath: "/portal/invoices/22222222-2222-4222-8222-222222222222",
  entityType: "INVOICE",
  entityId: "22222222-2222-4222-8222-222222222222",
  readAt: null,
  createdAt: new Date("2026-10-29T09:15:00.000Z"),
};

describe("toNotificationDto", () => {
  it("contains exactly the fields the recipient needs", () => {
    const dto = toNotificationDto(ROW);

    expect(Object.keys(dto).sort()).toEqual([
      "createdAt",
      "id",
      "linkPath",
      "message",
      "readAt",
      "title",
      "type",
    ]);
    expect(dto).toEqual({
      id: ROW.id,
      type: "INVOICE_ISSUED",
      title: "Invoice INV-2026-00007 is ready",
      message: "You can view it and see how to pay.",
      linkPath: ROW.linkPath,
      readAt: null,
      createdAt: "2026-10-29T09:15:00.000Z",
    });
  });

  it("serializes the read time as ISO 8601 and keeps the recipient and entity server-side", () => {
    const dto = toNotificationDto({ ...ROW, readAt: new Date("2026-10-29T10:00:00.000Z") });

    expect(dto.readAt).toBe("2026-10-29T10:00:00.000Z");
    expect(JSON.stringify(dto)).not.toContain(ROW.recipientUserId);
  });
});
