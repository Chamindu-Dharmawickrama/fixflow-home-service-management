import { type ApiErrorBody, ErrorCode } from "@fixflow/shared";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

import { AppError, badRequest, isAppError, payloadTooLarge, validation } from "../lib/errors.js";
import { fieldErrorsFromZod } from "../lib/zod-errors.js";
import { getRequestId } from "./request-id.js";

const INTERNAL_ERROR_MESSAGE = "Something went wrong on our side. Please try again.";

/** The shape of the errors `express.json()` (body-parser) and the router raise for bad requests. */
interface HttpErrorLike {
  status: number;
  type?: unknown;
}

function isHttpClientError(error: unknown): error is HttpErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  );
}

/** Maps an error to the response the client should see, or `undefined` for an unexpected one. */
function toAppError(error: unknown): AppError | undefined {
  if (isAppError(error)) {
    return error;
  }
  if (error instanceof ZodError) {
    return validation(fieldErrorsFromZod(error));
  }
  if (isHttpClientError(error)) {
    if (error.type === "entity.too.large" || error.status === 413) {
      return payloadTooLarge();
    }
    if (error.type === "entity.parse.failed") {
      return badRequest("The request body is not valid JSON.");
    }
    return new AppError(error.status, ErrorCode.BAD_REQUEST, "The request could not be processed.");
  }
  return undefined;
}

/**
 * The single place errors become responses (D-33). Expected failures keep their status, code and
 * message; anything else is a generic `500` whose cause is logged server-side only, with its
 * stack, and never sent to the client.
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    // The response is already under way; let Express close the connection.
    next(error);
    return;
  }

  const appError = toAppError(error);
  const status = appError?.status ?? 500;

  if (status >= 500) {
    // pino-http logs `res.err` (with its stack) on the completion line, at error level.
    res.err =
      error instanceof Error ? error : new Error("A non-Error value was thrown", { cause: error });
  }
  if (appError?.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(appError.retryAfterSeconds));
  }

  const body: ApiErrorBody = {
    error: {
      code: appError?.code ?? ErrorCode.INTERNAL_ERROR,
      message: appError?.message ?? INTERNAL_ERROR_MESSAGE,
      ...(appError?.fieldErrors !== undefined && { fieldErrors: appError.fieldErrors }),
      ...(appError?.details !== undefined && { details: appError.details }),
      requestId: getRequestId(req),
    },
  };
  res.status(status).json(body);
};
