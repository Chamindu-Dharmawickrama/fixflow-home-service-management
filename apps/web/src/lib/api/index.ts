// Browser-safe exports. Server Components import `serverApiGet` from "@/lib/api/server" directly,
// so `next/headers` never ends up in a client bundle.
export { apiFetch, apiFetchEnvelope, type ApiRequestOptions } from "./client";
export {
  ApiError,
  type ApiErrorCode,
  describeApiError,
  describeWait,
  isApiError,
  NETWORK_ERROR_MESSAGE,
} from "./errors";
export { apiPath } from "./paths";
