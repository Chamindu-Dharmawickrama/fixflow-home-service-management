import type { MetadataRoute } from "next";

import { buildSitemap } from "@/features/marketing/lib/discovery";
import { getActiveServices } from "@/features/marketing/lib/public-data";
import { getSiteUrl } from "@/features/marketing/lib/site-url";

/**
 * `/sitemap.xml`: home, the service list, every active service and the privacy notice. When the API
 * cannot be reached the service entries are left out rather than failing the file; that answer is
 * not remembered, so the next request lists them again (D-87, D-89).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const services = await getActiveServices();
  return buildSitemap(getSiteUrl(), services.status === "ok" ? services.data : []);
}
