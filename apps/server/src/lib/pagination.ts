import { LIMITS, type PaginatedResponse, type SortOrder } from "@fixflow/shared";
import { z } from "zod";

const SORT_ORDERS = ["asc", "desc"] as const satisfies readonly SortOrder[];

/** A query-string integer: digits only (no sign, exponent or hex), within `min`..`max`. */
function queryInteger(name: string, min: number, max: number) {
  return z
    .string(`${name} must be a single whole number.`)
    .regex(/^\d+$/, `${name} must be a whole number.`)
    .transform(Number)
    .pipe(
      z
        .number()
        .min(min, `${name} must be at least ${min}.`)
        .max(max, `${name} must be at most ${max}.`),
    );
}

export interface PaginationSchemaOptions<Sort extends string> {
  /** The fields a client may sort by. Anything else is rejected with 422. */
  sortFields: readonly [Sort, ...Sort[]];
  defaultSort: NoInfer<Sort>;
  defaultOrder: SortOrder;
}

/**
 * Zod schema for the standard list query (D-34): `page` (1-based), `pageSize` (default 20, max
 * 100), `sort` (allowlisted) and `order`. Extend it with an endpoint's own filters:
 * `createPaginationSchema(...).extend({ status: z.enum(...).optional() })`. Unknown query keys
 * are ignored, as for any query string.
 */
export function createPaginationSchema<const Sort extends string>(
  options: PaginationSchemaOptions<Sort>,
) {
  const { sortFields, defaultSort, defaultOrder } = options;
  const { defaultPageSize, maxPageSize, maxPage } = LIMITS.pagination;

  return z.object({
    page: queryInteger("page", 1, maxPage).default(1),
    pageSize: queryInteger("pageSize", 1, maxPageSize).default(defaultPageSize),
    sort: z.enum(sortFields, `sort must be one of: ${sortFields.join(", ")}.`).default(defaultSort),
    order: z.enum(SORT_ORDERS, "order must be asc or desc.").default(defaultOrder),
  });
}

export interface PaginationParams<Sort extends string = string> {
  page: number;
  pageSize: number;
  sort: Sort;
  order: SortOrder;
}

export interface PrismaPage<OrderBy> {
  skip: number;
  take: number;
  orderBy: OrderBy[];
}

/**
 * Turns validated pagination params into Prisma `skip`/`take`/`orderBy`. A final `{ id: "asc" }`
 * term makes the order total, so rows with equal sort values never repeat or vanish between pages.
 * By default `sort` is used as the column name; pass `orderBy` to map it to a relation or a
 * nested field.
 */
export function toPrismaPage<Sort extends string>(
  params: PaginationParams<Sort>,
): PrismaPage<Record<string, SortOrder>>;
export function toPrismaPage<Sort extends string, OrderBy>(
  params: PaginationParams<Sort>,
  orderBy: (sort: Sort, order: SortOrder) => OrderBy,
): PrismaPage<OrderBy | { id: "asc" }>;
export function toPrismaPage<Sort extends string>(
  params: PaginationParams<Sort>,
  orderBy: (sort: Sort, order: SortOrder) => object = (sort, order) => ({ [sort]: order }),
): PrismaPage<object> {
  return {
    skip: (params.page - 1) * params.pageSize,
    take: params.pageSize,
    orderBy: [orderBy(params.sort, params.order), { id: "asc" }],
  };
}

/** Builds the list envelope `{ data, pagination }` (D-34). */
export function paginated<T>(
  data: T[],
  params: Pick<PaginationParams, "page" | "pageSize">,
  totalItems: number,
): PaginatedResponse<T> {
  return {
    data,
    pagination: {
      page: params.page,
      pageSize: params.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / params.pageSize),
    },
  };
}
