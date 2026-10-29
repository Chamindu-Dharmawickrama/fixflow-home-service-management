import { PricingMode } from "@fixflow/shared";

import { formatMoney, isDecimalString } from "@/lib/formatting";

/** The parts of a service a card shows: the same on the website and in the admin preview. */
export interface ServiceCardData {
  name: string;
  category: string;
  shortDescription: string;
  pricingMode: PricingMode;
  startingPrice: string | null;
  currencyCode: string;
  estimatedDurationMinutes: number | null;
  imageKey: string | null;
  imageUrl: string | null;
}

/** The pricing line of a service card and list: "From $129.00" or "Request a quote". */
export function formatServicePrice(service: {
  pricingMode: PricingMode;
  startingPrice: string | null;
  currencyCode: string;
}): string {
  if (
    service.pricingMode === PricingMode.FIXED &&
    service.startingPrice !== null &&
    isDecimalString(service.startingPrice)
  ) {
    return `From ${formatMoney(service.startingPrice, service.currencyCode)}`;
  }
  return "Request a quote";
}

/** "45 min", "1 hr", "1 hr 30 min", "4 hr"; `null` when no estimate is given. */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null || !Number.isInteger(minutes) || minutes <= 0) {
    return null;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
