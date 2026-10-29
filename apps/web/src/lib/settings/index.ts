import type { PublicSettingsDto } from "@fixflow/shared";
import { cache } from "react";

import { serverApiGetPublic } from "@/lib/api/server";

/**
 * The business profile for server-rendered pages: name, contact details, currency and time zone.
 * Fetched once per request (React `cache` shares the answer between a layout and its pages), from
 * the public endpoint, so it works for visitors and signed-in people alike. Call it only behind a
 * `<Suspense>` boundary: the request is made at render time. An API outage throws, and the nearest
 * error boundary shows a retry screen.
 */
export const getPublicSettings = cache((): Promise<PublicSettingsDto> =>
  serverApiGetPublic<PublicSettingsDto>("/settings/public"),
);

/** What formatting needs: dates are shown in the business time zone and money in its currency (BR-17). */
export interface BusinessFormatting {
  timeZone: string;
  currencyCode: string;
}

export async function getBusinessFormatting(): Promise<BusinessFormatting> {
  const { timeZone, currencyCode } = await getPublicSettings();
  return { timeZone, currencyCode };
}
