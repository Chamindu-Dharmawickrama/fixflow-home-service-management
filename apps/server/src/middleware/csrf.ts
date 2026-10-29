import { ErrorCode } from "@fixflow/shared";
import type { RequestHandler } from "express";

import type { Config } from "../config/env.js";
import { AppError, badRequest } from "../lib/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const CSRF_FAILURE_MESSAGE = "This request did not come from the FixFlow web app.";

function isJson(contentType: string | undefined): boolean {
  return contentType !== undefined && /^application\/json\s*(;|$)/i.test(contentType.trim());
}

function hasBody(headers: Record<string, string | string[] | undefined>): boolean {
  const length = headers["content-length"];
  return (
    headers["transfer-encoding"] !== undefined ||
    (typeof length === "string" && length !== "" && length !== "0")
  );
}

/**
 * CSRF defence for every unsafe method (D-11), layered on top of `SameSite=Lax` cookies:
 *
 * 1. The request's `Origin` must equal `WEB_ORIGIN`. Browsers always send it on cross-origin and
 *    same-origin POSTs, and a page on another site cannot forge it.
 * 2. Without an `Origin`, `Sec-Fetch-Site: same-origin` is accepted (a header scripts cannot set).
 * 3. A body, when there is one, must be JSON: a plain HTML form cannot send `application/json`
 *    without a CORS preflight, which this API refuses to answer for other origins.
 *
 * Everything else gets `403 CSRF_ORIGIN_MISMATCH`. Safe methods pass untouched. Non-browser clients
 * (tests, scripts) send an `Origin` header explicitly.
 */
export function csrfProtection(config: Pick<Config, "webOrigin">): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const { origin } = req.headers;
    const sameOrigin =
      origin !== undefined
        ? origin === config.webOrigin
        : req.headers["sec-fetch-site"] === "same-origin";
    if (!sameOrigin) {
      next(new AppError(403, ErrorCode.CSRF_ORIGIN_MISMATCH, CSRF_FAILURE_MESSAGE));
      return;
    }

    if (hasBody(req.headers) && !isJson(req.headers["content-type"])) {
      next(badRequest("Requests must be sent as JSON."));
      return;
    }
    next();
  };
}
