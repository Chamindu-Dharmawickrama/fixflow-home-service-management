import type { Request } from "express";

/** Reads one cookie from a `Cookie` header. Values are returned as sent; names are case-sensitive. */
export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined || header === "") {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;

    const raw = part.slice(separator + 1).trim();
    const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function readCookie(req: Request, name: string): string | undefined {
  return parseCookie(req.headers.cookie, name);
}
