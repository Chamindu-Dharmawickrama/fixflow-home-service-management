import { describeWait, isApiError } from "@/lib/api";

const FALLBACK = "Something went wrong. Please try again.";

/**
 * The sentence to show when an auth request fails. The API's own messages are written for people
 * (and never reveal whether an account exists), so they are shown as they are; a rate limit is
 * explained with the wait the server asked for.
 */
export function describeAuthError(error: unknown): string {
  if (!isApiError(error)) {
    return FALLBACK;
  }
  if (error.code === "RATE_LIMITED") {
    return `Too many attempts. Please wait ${describeWait(error.retryAfterSeconds ?? 60)} and try again.`;
  }
  return error.message || FALLBACK;
}
