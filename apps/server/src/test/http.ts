import type { ApiErrorBody, ErrorCode } from "@fixflow/shared";
import type { Express } from "express";
import request, { type Response, type Test } from "supertest";
import { expect } from "vitest";

/** The web app's origin in tests; the CSRF check (D-11) requires it on every unsafe request. */
export const TEST_WEB_ORIGIN = "http://localhost:3000";

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

export interface RequestOptions {
  /** A `Cookie` header value, for example from {@link cookieFrom}. */
  cookie?: string | undefined;
  /** Overrides the `Origin` header. Pass `null` to send none. */
  origin?: string | null;
}

type Method = "get" | "post" | "put" | "patch" | "delete";

/**
 * Supertest with the headers a browser would send: `Origin` is the web app's, so unsafe methods
 * pass the CSRF check unless a test is about exactly that. Pass a cookie to act as a signed-in user.
 */
export function api(app: Express) {
  const make =
    (method: Method) =>
    (url: string, options: RequestOptions = {}): Test => {
      let test = request(app)[method](url);
      const origin = options.origin === undefined ? TEST_WEB_ORIGIN : options.origin;
      if (origin !== null) test = test.set("Origin", origin);
      if (options.cookie !== undefined) test = test.set("Cookie", options.cookie);
      return test;
    };

  return {
    get: make("get"),
    post: make("post"),
    put: make("put"),
    patch: make("patch"),
    delete: make("delete"),
  };
}

/** The `Set-Cookie` header lines of a response. */
export function setCookieLines(response: Response): string[] {
  const header = response.headers["set-cookie"] as string[] | string | undefined;
  if (header === undefined) return [];
  return Array.isArray(header) ? header : [header];
}

/** The full `Set-Cookie` line for one cookie, or `undefined`. */
export function setCookieLine(response: Response, name: string): string | undefined {
  return setCookieLines(response).find((line) => line.startsWith(`${name}=`));
}

/** `name=value`, ready to send back as a `Cookie` header, from the response's `Set-Cookie`. */
export function cookieFrom(response: Response, name: string): string {
  const line = setCookieLine(response, name);
  if (line === undefined) {
    throw new Error(`The response did not set the ${name} cookie.`);
  }
  return line.split(";")[0] ?? "";
}
