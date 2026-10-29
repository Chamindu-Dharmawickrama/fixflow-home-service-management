import type { PaginatedResponse } from "./api.js";
import type { ServiceCatalogueState } from "./derived-status.js";
import type { PricingMode } from "./enums.js";

/**
 * The service catalogue as the API serves it (FR-101, D-50). A service is *active* (visible on the
 * website, can be requested) when it is published and not archived.
 */

/** What a visitor sees: only active services are ever returned, and nothing staff-only is in it. */
export interface PublicServiceDto {
  id: string;
  name: string;
  /** The web address of its page: `/services/<slug>`. */
  slug: string;
  category: string;
  shortDescription: string;
  fullDescription: string;
  inclusions: string[];
  estimatedDurationMinutes: number | null;
  pricingMode: PricingMode;
  /** "From" price as a decimal string (`"129.00"`), present for fixed pricing only. */
  startingPrice: string | null;
  /** The business currency (ISO 4217) that `startingPrice` is in. */
  currencyCode: string;
  /** A bundled picture (see `BUNDLED_SERVICE_IMAGES`) or `null`. At most one of key and URL is set. */
  imageKey: string | null;
  /** An `https://` address shown on web pages only, or `null`. */
  imageUrl: string | null;
}

/** What the admin can do to a service from its current state (D-43). The UI shows only these. */
export const ServiceAction = {
  EDIT: "EDIT",
  PUBLISH: "PUBLISH",
  UNPUBLISH: "UNPUBLISH",
  ARCHIVE: "ARCHIVE",
  RESTORE: "RESTORE",
} as const;
export type ServiceAction = (typeof ServiceAction)[keyof typeof ServiceAction];

/** Staff view of a service: the public fields plus its lifecycle. */
export interface AdminServiceDto extends PublicServiceDto {
  sortOrder: number;
  isPublished: boolean;
  /** ISO 8601 instant, or `null` while the service is not archived. */
  archivedAt: string | null;
  status: ServiceCatalogueState;
  /** Published and not archived: visible on the website and open to new requests. */
  isActive: boolean;
  availableActions: ServiceAction[];
  createdAt: string;
  updatedAt: string;
}

/** The `status` filter of `GET /admin/services`. Leave it out for every service. */
export const SERVICE_STATUS_FILTERS = ["published", "unpublished", "archived"] as const;
export type ServiceStatusFilter = (typeof SERVICE_STATUS_FILTERS)[number];

export interface AdminServiceListMeta {
  /** Services per tab, ignoring the search text, so the tabs can show how many each holds. */
  counts: { all: number; published: number; unpublished: number; archived: number };
  /** The business currency, for the "From" prices in the list. */
  currencyCode: string;
}

/** `GET /admin/services`: the standard list envelope plus the tab counts. */
export interface AdminServiceListResponse extends PaginatedResponse<AdminServiceDto> {
  meta: AdminServiceListMeta;
}
