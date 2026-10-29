import {
  type AdminServiceDto,
  type PublicServiceDto,
  serviceCatalogueState,
} from "@fixflow/shared";

import type { Service } from "../../generated/prisma/client.js";
import { availableActions } from "./services.domain.js";

/**
 * Serializers for the service catalogue (CLAUDE.md §7: one per audience, field by field). The public
 * one never carries the lifecycle (`isPublished`, `archivedAt`), the display order or the dates:
 * a visitor only ever sees active services, and how they are managed is not their business.
 */

export function toPublicServiceDto(row: Service, currencyCode: string): PublicServiceDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    shortDescription: row.shortDescription,
    fullDescription: row.fullDescription,
    inclusions: [...row.inclusions],
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    pricingMode: row.pricingMode,
    startingPrice: row.startingPrice === null ? null : row.startingPrice.toFixed(2),
    currencyCode,
    imageKey: row.imageKey,
    imageUrl: row.imageUrl,
  };
}

export function toAdminServiceDto(row: Service, currencyCode: string): AdminServiceDto {
  const status = serviceCatalogueState(row);
  return {
    ...toPublicServiceDto(row, currencyCode),
    sortOrder: row.sortOrder,
    isPublished: row.isPublished,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
    status,
    isActive: status === "PUBLISHED",
    availableActions: availableActions(status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
