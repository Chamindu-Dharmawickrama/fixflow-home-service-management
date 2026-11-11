import { DASHBOARD_RANGES, DEFAULT_DASHBOARD_RANGE } from "@fixflow/shared";
import { z } from "zod";

/** `GET /api/v1/admin/dashboard/summary?range=today|7d|30d` (default `7d`). */
export const dashboardSummaryQuerySchema = z.object({
  range: z
    .enum(DASHBOARD_RANGES, `range must be one of: ${DASHBOARD_RANGES.join(", ")}.`)
    .default(DEFAULT_DASHBOARD_RANGE),
});

export type DashboardSummaryQuery = z.output<typeof dashboardSummaryQuerySchema>;
