import { z } from "zod";

import { createPaginationSchema } from "../../lib/pagination.js";

/**
 * `GET /notifications/me?unreadOnly=true&page=2&pageSize=10`. Newest first; `sort` and `order` are
 * accepted for consistency with other lists (D-34) but only `createdAt` can be sorted.
 */
export const listNotificationsQuerySchema = createPaginationSchema({
  sortFields: ["createdAt"],
  defaultSort: "createdAt",
  defaultOrder: "desc",
}).extend({
  unreadOnly: z
    .enum(["true", "false"], "unreadOnly must be true or false.")
    .default("false")
    .transform((value) => value === "true"),
});

export const notificationIdParamsSchema = z.object({
  id: z.uuid("The notification id must be a valid id."),
});
