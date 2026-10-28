import type { ErrorCode } from "./error-codes.js";

/** `asc` or `desc`, as accepted by the `order` query parameter on list endpoints (D-34). */
export type SortOrder = "asc" | "desc";

/**
 * One message per field, keyed by dotted request path (`lines.2.quantity`). Issues that are not
 * tied to a single field (for example a body that is not an object) use the key `_`.
 */
export type FieldErrors = Record<string, string>;

/** Optional, non-sensitive context attached to an error (for example `{ currentStatus: "SENT" }`). */
export type ErrorDetails = Record<string, string | number | boolean | null>;

/** The body of every non-2xx API response (D-33). */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: FieldErrors;
    details?: ErrorDetails;
    requestId: string;
  };
}

/** Success envelope for a single resource or an action result. */
export interface ApiResponse<T> {
  data: T;
}

export interface PaginationMeta {
  /** 1-based page number. */
  page: number;
  pageSize: number;
  totalItems: number;
  /** `ceil(totalItems / pageSize)`; `0` when there are no items. */
  totalPages: number;
}

/** Success envelope for list endpoints (D-34). */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}
