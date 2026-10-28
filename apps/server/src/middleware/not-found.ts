import type { RequestHandler } from "express";

import { notFound } from "../lib/errors.js";

/** Terminal handler for requests no route matched; the error handler renders the 404. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound("The requested resource was not found."));
};
