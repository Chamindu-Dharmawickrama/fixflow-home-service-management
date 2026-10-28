import { randomUUID } from "node:crypto";

import type { Request, RequestHandler } from "express";

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * An incoming ID is only trusted when it is short and made of URL-safe characters, so it cannot
 * be used to inject log lines or oversized headers.
 */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && VALID_REQUEST_ID.test(value);
}

/** The ID assigned by {@link requestId}; `"unknown"` only if that middleware did not run. */
export function getRequestId(req: Request): string {
  return typeof req.id === "string" ? req.id : "unknown";
}

/** Gives every request an ID (the caller's, when valid) and echoes it in the response. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = isValidRequestId(incoming) ? incoming : randomUUID();

  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};
