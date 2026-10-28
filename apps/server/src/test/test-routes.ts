import { ErrorCode } from "@fixflow/shared";
import { Router } from "express";
import { z } from "zod";

import type { AppDeps } from "../deps.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  payloadTooLarge,
  rateLimited,
  unauthorized,
  validation,
} from "../lib/errors.js";
import { createPaginationSchema, paginated, toPrismaPage } from "../lib/pagination.js";
import { clientIp, rateLimit } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";

/** A secret that must never appear in a response body or a log line. */
export const LEAKY_ERROR_MESSAGE =
  "connect ECONNREFUSED db.internal:5432 password=hunter2-do-not-leak";

export const LIMITED_ROUTE_RULE = { limit: 2, windowSeconds: 60 } as const;

const listQuery = createPaginationSchema({
  sortFields: ["createdAt", "name"],
  defaultSort: "createdAt",
  defaultOrder: "desc",
}).extend({ search: z.string().max(50).optional() });

const orderBody = z.strictObject({
  customerName: z.string().min(2),
  lines: z
    .array(z.strictObject({ description: z.string().min(1), quantity: z.number().positive() }))
    .min(1),
});

/**
 * Throwaway routes that exercise the platform (error contract, validation, pagination, logging,
 * rate limiting). They exist only in the test harness; production code never mounts them.
 */
export function createTestRouter(deps: AppDeps): Router {
  const router = Router();

  router.get("/__test__/errors/app/:kind", (req, _res, next) => {
    switch (req.params.kind) {
      case "bad-request":
        return next(badRequest("That request is malformed."));
      case "unauthorized":
        return next(unauthorized());
      case "forbidden":
        return next(forbidden());
      case "not-found":
        return next(notFound());
      case "conflict":
        return next(conflict("The record already exists."));
      case "stale-state":
        return next(
          conflict("This quotation changed. Reload and try again.", {
            code: ErrorCode.STALE_STATE,
            details: { currentStatus: "SENT" },
          }),
        );
      case "invalid-transition":
        return next(
          conflict("This quotation can no longer be accepted.", {
            code: ErrorCode.INVALID_STATE_TRANSITION,
          }),
        );
      case "validation":
        return next(validation({ email: "Enter a valid email address." }));
      case "rate-limited":
        return next(rateLimited(42));
      case "payload-too-large":
        return next(payloadTooLarge());
      default:
        return next(notFound());
    }
  });

  router.get("/__test__/errors/zod", () => {
    orderBody.parse({
      customerName: "A",
      lines: [
        { description: "Filter", quantity: 1 },
        { description: "Gas", quantity: 2 },
        { description: "Labour", quantity: "three" },
      ],
      surprise: true,
    });
  });

  router.get("/__test__/errors/unknown", () => {
    throw new Error(LEAKY_ERROR_MESSAGE);
  });

  router.get("/__test__/errors/unknown-async", async () => {
    await Promise.resolve();
    throw new Error(LEAKY_ERROR_MESSAGE);
  });

  router.get("/__test__/errors/non-error", () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- proves non-Error throws are handled
    throw LEAKY_ERROR_MESSAGE;
  });

  router.post(
    "/__test__/orders/:orderId",
    validate({
      params: z.object({ orderId: z.uuid() }),
      query: z.object({ dryRun: z.enum(["true", "false"]).default("false") }),
      body: orderBody,
    }),
    (req, res) => {
      res.json({ data: { params: req.params, query: req.query, body: req.body } });
    },
  );

  router.get("/__test__/items", validate({ query: listQuery }), (req, res) => {
    const { page, pageSize, sort, order } = req.query;
    res.json({
      ...paginated([{ id: "item-1" }], { page, pageSize }, 45),
      meta: {
        prisma: toPrismaPage({ page, pageSize, sort, order }),
        search: req.query.search ?? null,
      },
    });
  });

  router.get("/__test__/set-cookie", (_req, res) => {
    res.cookie("fixflow_session", "super-secret-session-token", { httpOnly: true });
    res.json({ data: { ok: true } });
  });

  router.post("/__test__/log-secret", (req, res) => {
    req.log.info(
      { body: req.body as unknown, nested: { deeper: { token: "tok-nested-secret" } } },
      "Logging a body on purpose",
    );
    res.json({ data: { ok: true } });
  });

  router.get("/__test__/ip", (req, res) => {
    res.json({ data: { ip: req.ip ?? null } });
  });

  router.get(
    "/__test__/limited",
    rateLimit(deps, { name: "test-limited", ...LIMITED_ROUTE_RULE, key: clientIp }),
    (_req, res) => {
      res.json({ data: { ok: true } });
    },
  );

  return router;
}
