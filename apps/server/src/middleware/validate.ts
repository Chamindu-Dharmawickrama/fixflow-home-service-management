import type { FieldErrors } from "@fixflow/shared";
import type { Request, RequestHandler } from "express";
import type { z } from "zod";

import { validation } from "../lib/errors.js";
import { fieldErrorsFromZod } from "../lib/zod-errors.js";

export interface RequestSchemas {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}

type SchemaOutput<S extends RequestSchemas, K extends keyof RequestSchemas, Fallback> = S extends {
  [Key in K]: infer T extends z.ZodType;
}
  ? z.output<T>
  : Fallback;

type ValidatedParams<S extends RequestSchemas> = SchemaOutput<S, "params", Request["params"]>;
type ValidatedBody<S extends RequestSchemas> = SchemaOutput<S, "body", unknown>;
type ValidatedQuery<S extends RequestSchemas> = SchemaOutput<S, "query", Request["query"]>;

/** The request type a handler sees after `validate(schemas)` ran: parsed params, query and body. */
export type ValidatedRequest<S extends RequestSchemas> = Request<
  ValidatedParams<S>,
  unknown,
  ValidatedBody<S>,
  ValidatedQuery<S>
>;

const SOURCES = ["params", "query", "body"] as const;

/**
 * Validates `req.params`, `req.query` and `req.body` against Zod schemas. On success the parsed
 * (coerced, defaulted, stripped) values replace the raw input; on failure it responds
 * `422 VALIDATION_ERROR` with `fieldErrors`. Body schemas should be `z.strictObject(...)` so
 * unknown keys are rejected. A missing body is validated as `{}` so required fields are
 * reported one by one.
 */
export function validate<const S extends RequestSchemas>(
  schemas: S,
): RequestHandler<ValidatedParams<S>, unknown, ValidatedBody<S>, ValidatedQuery<S>> {
  // Express types the handler's request by its generics, not by what this middleware narrows.
  const handler: RequestHandler = (req, _res, next) => {
    const parsed: Partial<Record<(typeof SOURCES)[number], unknown>> = {};
    const fieldErrors: FieldErrors = {};
    let valid = true;

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (schema === undefined) {
        continue;
      }
      const input: unknown = source === "body" && req.body === undefined ? {} : req[source];
      const result = schema.safeParse(input);
      if (result.success) {
        parsed[source] = result.data;
      } else {
        valid = false;
        for (const [field, message] of Object.entries(fieldErrorsFromZod(result.error))) {
          fieldErrors[field] ??= message;
        }
      }
    }

    if (!valid) {
      next(validation(fieldErrors));
      return;
    }

    if ("params" in parsed) req.params = parsed.params as Request["params"];
    if ("body" in parsed) req.body = parsed.body;
    // Express 5 defines `req.query` as a getter on the prototype, so shadow it on the instance.
    if ("query" in parsed) {
      Object.defineProperty(req, "query", {
        value: parsed.query,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    }
    next();
  };

  return handler as RequestHandler<
    ValidatedParams<S>,
    unknown,
    ValidatedBody<S>,
    ValidatedQuery<S>
  >;
}
