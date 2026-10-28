import type { IncomingMessage } from "node:http";

import pino, { type DestinationStream, type Logger } from "pino";
import { type HttpLogger, pinoHttp, type StdSerializedResults } from "pino-http";

import type { LogLevel } from "../config/env.js";

export type { Logger } from "pino";

export const REDACTED = "[Redacted]";

/**
 * Field names whose value is never logged, wherever they appear in a logged object. Pino has no
 * recursive wildcard, so {@link REDACT_PATHS} repeats each name at every depth up to
 * {@link REDACT_DEPTH}.
 */
export const REDACTED_FIELD_NAMES = [
  "password",
  "newPassword",
  "currentPassword",
  "credential",
  "token",
  "secret",
] as const;

const REDACT_DEPTH = 4;

const HEADER_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
];

function fieldPaths(name: string): string[] {
  return Array.from({ length: REDACT_DEPTH }, (_, depth) =>
    [...Array<string>(depth).fill("*"), name].join("."),
  );
}

export const REDACT_PATHS: readonly string[] = [
  ...HEADER_PATHS,
  ...REDACTED_FIELD_NAMES.flatMap(fieldPaths),
];

export interface LoggerSettings {
  level: LogLevel;
  /** Human-readable output through pino-pretty. Development only. */
  pretty: boolean;
}

/**
 * Builds the application logger. Pass `destination` (any writable) to capture output in tests;
 * pretty output is ignored when a destination is given.
 */
export function createLogger(settings: LoggerSettings, destination?: DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    level: settings.level,
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (settings.pretty && destination === undefined) {
    return pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: { translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
      },
    });
  }
  // Level names ("info") instead of numbers (30) read better in the hosting platform's log viewer.
  return pino({ ...options, formatters: { level: (label) => ({ level: label }) } }, destination);
}

/** The request path without its query string, which can carry search terms or e-mail addresses. */
export function pathOf(url: string | undefined): string {
  if (url === undefined) {
    return "";
  }
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

function serializeRequest(req: StdSerializedResults["req"]) {
  return {
    id: req.id,
    method: req.method,
    path: pathOf(req.url),
    headers: req.headers,
    remoteAddress: req.remoteAddress,
  };
}

/**
 * Only the status is logged for a response. Its headers add noise (the CSP alone is ~300 bytes)
 * and could carry `Set-Cookie`; the redaction paths still cover them if a handler logs them.
 */
function serializeResponse(res: StdSerializedResults["res"]) {
  return { statusCode: res.statusCode };
}

/**
 * Per-request logging. It expects `req.id` to be set already (see the request-id middleware),
 * logs one line per response, never logs request or response bodies, and logs only the path of
 * the URL.
 */
export function createHttpLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: (req: IncomingMessage) => req.id,
    serializers: { req: serializeRequest, res: serializeResponse },
    // Keeps `req.log` lean: the full request is logged once, on the completion line.
    quietReqLogger: true,
    customLogLevel: (_req, res, error) => {
      if (error !== undefined || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  });
}
