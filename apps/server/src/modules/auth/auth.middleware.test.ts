import { ErrorCode, Role } from "@fixflow/shared";
import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { AppError } from "../../lib/errors.js";
import { assertCustomerOwns, authOf } from "./auth.middleware.js";
import type { AuthContext } from "./auth.types.js";

const CUSTOMER: AuthContext = {
  userId: "u-1",
  role: Role.CUSTOMER,
  email: "alex.morgan@example.test",
  customerId: "c-1",
  sessionId: "s-1",
};
const ADMIN: AuthContext = {
  userId: "u-2",
  role: Role.BUSINESS_ADMIN,
  email: "admin@demo.fixflow.test",
  sessionId: "s-2",
};

function notFoundError(run: () => void): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("Expected a NOT_FOUND error");
}

describe("assertCustomerOwns", () => {
  it("passes for the customer's own record", () => {
    expect(() => {
      assertCustomerOwns("c-1", CUSTOMER);
    }).not.toThrow();
  });

  it("throws NOT_FOUND for someone else's record, so ids cannot be probed", () => {
    const error = notFoundError(() => {
      assertCustomerOwns("c-2", CUSTOMER);
    });

    expect(error.status).toBe(404);
    expect(error.code).toBe(ErrorCode.NOT_FOUND);
  });

  it("throws NOT_FOUND for a record with no owner", () => {
    for (const owner of [null, undefined]) {
      expect(
        notFoundError(() => {
          assertCustomerOwns(owner, CUSTOMER);
        }).status,
      ).toBe(404);
    }
  });

  it("throws NOT_FOUND for anyone who is not a customer, whatever the record", () => {
    expect(
      notFoundError(() => {
        assertCustomerOwns("c-1", ADMIN);
      }).status,
    ).toBe(404);
    expect(
      notFoundError(() => {
        assertCustomerOwns("c-1", { ...CUSTOMER, customerId: undefined } as unknown as AuthContext);
      }).status,
    ).toBe(404);
  });

  it("gives the same answer for a missing record and a foreign one", () => {
    const foreign = notFoundError(() => {
      assertCustomerOwns("c-2", CUSTOMER);
    });
    const missing = notFoundError(() => {
      assertCustomerOwns(undefined, CUSTOMER);
    });

    expect(foreign.message).toBe(missing.message);
    expect(foreign.code).toBe(missing.code);
  });
});

describe("authOf", () => {
  it("returns the session's identity", () => {
    expect(authOf({ auth: CUSTOMER } as Request)).toBe(CUSTOMER);
  });

  it("fails closed with 401 when a route forgot requireAuth", () => {
    try {
      authOf({} as Request);
      throw new Error("Expected authOf to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(401);
    }
  });
});
