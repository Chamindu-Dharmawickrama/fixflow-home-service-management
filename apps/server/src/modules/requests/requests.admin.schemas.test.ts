import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { fieldErrorsFromZod } from "../../lib/zod-errors.js";
import {
  addRequestNoteBodySchema,
  adminRequestIdParamsSchema,
  adminRequestsQuerySchema,
  changeRequestStatusBodySchema,
} from "./requests.admin.schemas.js";

const UUID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

/** The field errors the API would return for this input; fails the test if the input is accepted. */
function errorsOf(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) {
    throw new Error("The input was accepted.");
  }
  return fieldErrorsFromZod(result.error);
}

describe("adminRequestsQuerySchema (FR-023)", () => {
  it("defaults to the first page, newest submitted first, with no filter", () => {
    expect(adminRequestsQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: "submittedAt",
      order: "desc",
    });
  });

  it("accepts every sort field the queue offers, and no other", () => {
    for (const sort of ["submittedAt", "updatedAt", "status", "reference"]) {
      expect(adminRequestsQuerySchema.parse({ sort }).sort).toBe(sort);
    }
    for (const sort of ["customerName", "city", "preferredDate", "id", "SUBMITTEDAT"]) {
      expect(adminRequestsQuerySchema.safeParse({ sort }).success, sort).toBe(false);
    }
  });

  it("refuses a page size above 100 and a page below 1", () => {
    expect(adminRequestsQuerySchema.parse({ pageSize: "100" }).pageSize).toBe(100);
    expect(adminRequestsQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(adminRequestsQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });

  describe("status", () => {
    it("takes one status", () => {
      expect(adminRequestsQuerySchema.parse({ status: "SUBMITTED" }).status).toEqual(["SUBMITTED"]);
    });

    it("takes repeated parameters", () => {
      expect(adminRequestsQuerySchema.parse({ status: ["SUBMITTED", "QUOTED"] }).status).toEqual([
        "SUBMITTED",
        "QUOTED",
      ]);
    });

    it("takes a comma-separated list, with spaces and repeats tidied away", () => {
      expect(
        adminRequestsQuerySchema.parse({ status: " SUBMITTED, QUOTED ,SUBMITTED," }).status,
      ).toEqual(["SUBMITTED", "QUOTED"]);
      expect(
        adminRequestsQuerySchema.parse({ status: ["SUBMITTED,QUOTED", "ACCEPTED"] }).status,
      ).toEqual(["SUBMITTED", "QUOTED", "ACCEPTED"]);
    });

    it("treats an empty value as no filter", () => {
      expect(adminRequestsQuerySchema.parse({ status: "" }).status).toBeUndefined();
      expect(adminRequestsQuerySchema.parse({ status: ",," }).status).toBeUndefined();
    });

    it("refuses an unknown status, naming the ones there are", () => {
      // The error is on the offending entry of the list: `status.0`.
      expect(errorsOf(adminRequestsQuerySchema, { status: "OPEN" })["status.0"]).toMatch(
        /SUBMITTED/,
      );
      expect(adminRequestsQuerySchema.safeParse({ status: ["SUBMITTED", "nope"] }).success).toBe(
        false,
      );
      expect(adminRequestsQuerySchema.safeParse({ status: "submitted" }).success).toBe(false);
    });
  });

  describe("search", () => {
    it("trims the text and treats blank as no search", () => {
      expect(adminRequestsQuerySchema.parse({ q: "  alex  " }).q).toBe("alex");
      expect(adminRequestsQuerySchema.parse({ q: "   " }).q).toBeUndefined();
      expect(adminRequestsQuerySchema.parse({ q: "" }).q).toBeUndefined();
    });

    it("keeps characters that mean something to SQL as plain text (escaped by the service)", () => {
      expect(adminRequestsQuerySchema.parse({ q: "100%_off\\" }).q).toBe("100%_off\\");
    });

    it("refuses more than 100 characters and a repeated parameter", () => {
      expect(adminRequestsQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
      expect(adminRequestsQuerySchema.safeParse({ q: ["a", "b"] }).success).toBe(false);
    });
  });

  it("takes service and customer ids, and refuses text that is not an id", () => {
    expect(adminRequestsQuerySchema.parse({ serviceId: UUID, customerId: UUID })).toMatchObject({
      serviceId: UUID,
      customerId: UUID,
    });
    expect(errorsOf(adminRequestsQuerySchema, { serviceId: "ac-repair" })).toHaveProperty(
      "serviceId",
    );
    expect(errorsOf(adminRequestsQuerySchema, { customerId: "x" })).toHaveProperty("customerId");
  });

  describe("submitted dates (business-calendar days)", () => {
    it("accepts real dates, a single bound and a one-day range", () => {
      expect(
        adminRequestsQuerySchema.parse({ submittedFrom: "2026-03-01", submittedTo: "2026-03-31" }),
      ).toMatchObject({ submittedFrom: "2026-03-01", submittedTo: "2026-03-31" });
      expect(
        adminRequestsQuerySchema.parse({ submittedFrom: "2026-03-01" }).submittedTo,
      ).toBeUndefined();
      expect(
        adminRequestsQuerySchema.safeParse({
          submittedFrom: "2026-03-05",
          submittedTo: "2026-03-05",
        }).success,
      ).toBe(true);
    });

    it.each(["2026-02-30", "10/03/2026", "2026-3-1", "yesterday", "2026-03-01T00:00:00Z"])(
      "refuses %j",
      (value) => {
        expect(errorsOf(adminRequestsQuerySchema, { submittedFrom: value })).toHaveProperty(
          "submittedFrom",
        );
        expect(errorsOf(adminRequestsQuerySchema, { submittedTo: value })).toHaveProperty(
          "submittedTo",
        );
      },
    );

    it("refuses a range that ends before it starts", () => {
      expect(
        errorsOf(adminRequestsQuerySchema, {
          submittedFrom: "2026-03-10",
          submittedTo: "2026-03-09",
        }),
      ).toEqual({ submittedTo: "submittedTo must not be before submittedFrom." });
    });
  });
});

describe("changeRequestStatusBodySchema (FR-025, FR-026)", () => {
  const REASON = "The customer asked us to cancel by phone.";

  it("accepts starting a review with no reason", () => {
    expect(
      changeRequestStatusBodySchema.parse({ action: "START_REVIEW", expectedStatus: "SUBMITTED" }),
    ).toEqual({ action: "START_REVIEW", expectedStatus: "SUBMITTED" });
  });

  it("accepts a cancellation with a reason, and with an optional message for the customer", () => {
    expect(
      changeRequestStatusBodySchema.parse({
        action: "CANCEL",
        expectedStatus: "UNDER_REVIEW",
        reason: REASON,
      }),
    ).toMatchObject({ reason: REASON });
    expect(
      changeRequestStatusBodySchema.parse({
        action: "CANCEL",
        expectedStatus: "UNDER_REVIEW",
        reason: REASON,
        customerMessage: "  We can't reach your street, sorry.  ",
      }).customerMessage,
    ).toBe("We can't reach your street, sorry.");
  });

  it("turns a blank message for the customer into none", () => {
    expect(
      changeRequestStatusBodySchema.parse({
        action: "CANCEL",
        expectedStatus: "SUBMITTED",
        reason: REASON,
        customerMessage: "   ",
      }).customerMessage,
    ).toBeNull();
  });

  it("accepts a reopening with a reason", () => {
    expect(
      changeRequestStatusBodySchema.parse({
        action: "REOPEN",
        expectedStatus: "DECLINED",
        reason: "The customer called back and wants a revised price.",
      }).action,
    ).toBe("REOPEN");
  });

  describe("the reason", () => {
    it.each(["CANCEL", "REOPEN"])("is required for %s", (action) => {
      expect(
        errorsOf(changeRequestStatusBodySchema, { action, expectedStatus: "DECLINED" }),
      ).toEqual({
        reason: "Enter a reason of 5 to 500 characters, so the history says why.",
      });
    });

    it("must be at least 5 characters once trimmed, and at most 500", () => {
      const send = (reason: string) =>
        changeRequestStatusBodySchema.safeParse({
          action: "CANCEL",
          expectedStatus: "SUBMITTED",
          reason,
        }).success;

      expect(send("no")).toBe(false);
      expect(send("  fives ")).toBe(true);
      expect(send("abcd")).toBe(false);
      expect(send("   abcd   ")).toBe(false);
      expect(send("x".repeat(500))).toBe(true);
      expect(send("x".repeat(501))).toBe(false);
    });

    it("is not accepted when starting a review", () => {
      expect(
        errorsOf(changeRequestStatusBodySchema, {
          action: "START_REVIEW",
          expectedStatus: "SUBMITTED",
          reason: REASON,
        }),
      ).toEqual({ reason: "Starting a review does not take a reason." });
    });
  });

  describe("the message for the customer", () => {
    it.each(["START_REVIEW", "REOPEN"])(
      "is refused for %s: only a cancellation carries one",
      (action) => {
        const errors = errorsOf(changeRequestStatusBodySchema, {
          action,
          expectedStatus: action === "REOPEN" ? "DECLINED" : "SUBMITTED",
          ...(action === "REOPEN" && { reason: REASON }),
          customerMessage: "Hello",
        });

        expect(errors.customerMessage).toBe(
          "Only cancelling a request can carry a message for the customer.",
        );
      },
    );

    it("may be at most 500 characters", () => {
      const send = (customerMessage: string) =>
        changeRequestStatusBodySchema.safeParse({
          action: "CANCEL",
          expectedStatus: "SUBMITTED",
          reason: REASON,
          customerMessage,
        }).success;

      expect(send("x".repeat(500))).toBe(true);
      expect(send("x".repeat(501))).toBe(false);
    });
  });

  describe("only the three admin actions exist", () => {
    it.each([
      "QUOTED",
      "ACCEPTED",
      "DECLINED",
      "CONVERTED_TO_JOB",
      "UNDER_REVIEW",
      "CANCELLED",
      "MARK_QUOTED",
      "start_review",
      "",
    ])("refuses the action %j", (action) => {
      expect(
        errorsOf(changeRequestStatusBodySchema, {
          action,
          expectedStatus: "SUBMITTED",
          reason: REASON,
        }),
      ).toHaveProperty("action");
    });

    it("refuses a status field, so a status cannot be set directly", () => {
      expect(
        errorsOf(changeRequestStatusBodySchema, {
          action: "START_REVIEW",
          expectedStatus: "SUBMITTED",
          status: "QUOTED",
        }),
      ).toEqual({ status: "Unknown field." });
    });
  });

  it("needs the status the screen showed", () => {
    expect(errorsOf(changeRequestStatusBodySchema, { action: "START_REVIEW" })).toHaveProperty(
      "expectedStatus",
    );
    expect(
      errorsOf(changeRequestStatusBodySchema, { action: "START_REVIEW", expectedStatus: "OPEN" }),
    ).toHaveProperty("expectedStatus");
  });

  it.each(["customerId", "cancelReason", "cancelledByUserId", "cancelledAt", "reference", "role"])(
    "refuses %s: it belongs to the server",
    (field) => {
      expect(
        errorsOf(changeRequestStatusBodySchema, {
          action: "START_REVIEW",
          expectedStatus: "SUBMITTED",
          [field]: "x",
        }),
      ).toEqual({ [field]: "Unknown field." });
    },
  );
});

describe("addRequestNoteBodySchema (FR-024)", () => {
  it("accepts a note of either visibility", () => {
    for (const visibility of ["INTERNAL", "CUSTOMER_VISIBLE"]) {
      expect(addRequestNoteBodySchema.parse({ body: "Called, no answer.", visibility })).toEqual({
        body: "Called, no answer.",
        visibility,
      });
    }
  });

  it("trims the text and keeps line breaks", () => {
    expect(
      addRequestNoteBodySchema.parse({ body: "  Line one.\nLine two.  ", visibility: "INTERNAL" })
        .body,
    ).toBe("Line one.\nLine two.");
  });

  it("needs 1 to 2000 characters", () => {
    const send = (body: string) =>
      addRequestNoteBodySchema.safeParse({ body, visibility: "INTERNAL" }).success;

    expect(send("")).toBe(false);
    expect(send("   ")).toBe(false);
    expect(send("x")).toBe(true);
    expect(send("x".repeat(2000))).toBe(true);
    expect(send("x".repeat(2001))).toBe(false);
  });

  it("must say who can see it: there is no default", () => {
    expect(errorsOf(addRequestNoteBodySchema, { body: "Hello" })).toEqual({
      visibility: "Choose who can see the note: your team only, or the customer too.",
    });
    expect(
      errorsOf(addRequestNoteBodySchema, { body: "Hello", visibility: "PUBLIC" }),
    ).toHaveProperty("visibility");
    expect(
      errorsOf(addRequestNoteBodySchema, { body: "Hello", visibility: "internal" }),
    ).toHaveProperty("visibility");
  });

  it.each(["authorUserId", "requestId", "createdAt", "id"])("refuses %s", (field) => {
    expect(
      errorsOf(addRequestNoteBodySchema, { body: "Hello", visibility: "INTERNAL", [field]: UUID }),
    ).toEqual({ [field]: "Unknown field." });
  });
});

describe("adminRequestIdParamsSchema", () => {
  it("takes an id and refuses a reference", () => {
    expect(adminRequestIdParamsSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(adminRequestIdParamsSchema.safeParse({ id: "FF-2026-00012" }).success).toBe(false);
  });
});
