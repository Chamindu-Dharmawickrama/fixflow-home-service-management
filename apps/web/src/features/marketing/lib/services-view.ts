import { PricingMode, type PublicServiceDto } from "@fixflow/shared";

import { formatMoney } from "@/lib/formatting";

/** The categories in the order they first appear in the (already ordered) list, each once. */
export function categoriesOf(services: readonly Pick<PublicServiceDto, "category">[]): string[] {
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const { category } of services) {
    const key = category.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      categories.push(category.trim());
    }
  }
  return categories;
}

/** The `category` search parameter as one clean string, or `undefined` when it is absent or blank. */
export function parseCategoryParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Services in one category (compared without regard to case); every service when `category` is `undefined`. */
export function filterByCategory<T extends Pick<PublicServiceDto, "category">>(
  services: readonly T[],
  category: string | undefined,
): T[] {
  if (category === undefined) return [...services];
  const wanted = category.trim().toLowerCase();
  return services.filter((service) => service.category.trim().toLowerCase() === wanted);
}

/**
 * Other services a visitor may want next: the same category first, then the rest, in display order.
 * Never includes `current`.
 */
export function relatedServices<T extends Pick<PublicServiceDto, "slug" | "category">>(
  services: readonly T[],
  current: Pick<PublicServiceDto, "slug" | "category">,
  limit = 3,
): T[] {
  const others = services.filter((service) => service.slug !== current.slug);
  const category = current.category.trim().toLowerCase();
  const sameCategory = others.filter(
    (service) => service.category.trim().toLowerCase() === category,
  );
  const rest = others.filter((service) => service.category.trim().toLowerCase() !== category);
  return [...sameCategory, ...rest].slice(0, limit);
}

/** A description as paragraphs: blank lines separate them, single line breaks stay inside one. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter((paragraph) => paragraph !== "");
}

/** `/services` or `/services?category=Air%20conditioning`. */
export function servicesPath(category?: string): string {
  return category === undefined
    ? "/services"
    : `/services?category=${encodeURIComponent(category)}`;
}

/**
 * The pricing line of the service page (FR-003): a fixed-price service says what it starts from and
 * that the quotation settles the price; a quoted service says it is priced after review.
 */
export function pricingNote(
  service: Pick<PublicServiceDto, "pricingMode" | "startingPrice" | "currencyCode">,
): string {
  if (service.pricingMode === PricingMode.FIXED && service.startingPrice !== null) {
    return `Starting from ${formatMoney(service.startingPrice, service.currencyCode)} — final price confirmed in your written quotation`;
  }
  return "Priced after we review your request";
}
