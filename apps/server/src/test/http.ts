import type { ApiErrorBody, ErrorCode } from "@fixflow/shared";
import type { Response } from "supertest";
import { expect } from "vitest";

/** The parsed JSON body with a type, since Supertest declares it `any`. */
export function bodyOf<T>(response: Response): T {
  return response.body as T;
}

/** Asserts the D-33 error contract and returns the error so callers can check more fields. */
export function expectApiError(
  response: Response,
  expected: { status: number; code: ErrorCode },
): ApiErrorBody["error"] {
  expect(response.status).toBe(expected.status);
  expect(response.headers["content-type"]).toMatch(/application\/json/);

  const { error } = bodyOf<ApiErrorBody>(response);
  expect(error.code).toBe(expected.code);
  expect(typeof error.message).toBe("string");
  expect(error.message).not.toBe("");
  expect(error.requestId).toBe(response.headers["x-request-id"]);
  return error;
}
