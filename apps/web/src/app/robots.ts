import type { MetadataRoute } from "next";

import { buildRobots } from "@/features/marketing/lib/discovery";
import { getSiteUrl } from "@/features/marketing/lib/site-url";
import { isDemoMode } from "@/lib/demo-mode";

/** `/robots.txt`: signed-in areas are never crawled; the sitemap is advertised outside the demo (D-89). */
export default function robots(): MetadataRoute.Robots {
  return buildRobots(getSiteUrl(), { demoMode: isDemoMode() });
}
