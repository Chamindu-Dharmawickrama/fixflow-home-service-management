import type { PrismaClient } from "../lib/db.js";
import { notify, type NotifyInput } from "../modules/notifications/notifications.service.js";
import { DEMO_ACCOUNTS } from "./seed-data.js";

/**
 * Demo notifications for development (T06). No workflow creates notifications until T11, so without
 * these the bell would always be empty and could not be looked at. `npm run demo:notifications`
 * inserts a few for the **seeded demo accounts only**, each ending "Demo data." so nobody mistakes
 * them for real events. Every link goes to a page that exists today. The step is idempotent.
 */

const DEMO_LABEL = "Demo data.";

type DemoNotification = Omit<NotifyInput, "recipientUserId">;

const CUSTOMER_NOTIFICATIONS: readonly DemoNotification[] = [
  {
    type: "QUOTATION_SENT",
    title: "Quotation QT-2026-00004 is ready",
    message: `We sent you a quotation for AC Repair. Please review it. ${DEMO_LABEL}`,
    linkPath: "/portal",
  },
  {
    type: "JOB_SCHEDULED",
    title: "Your AC Repair visit is scheduled",
    message: `We booked Tuesday morning for your visit. ${DEMO_LABEL}`,
    linkPath: "/portal",
  },
  {
    type: "INVOICE_ISSUED",
    title: "Invoice INV-2026-00007 is ready",
    message: `You can view it and see how to pay. ${DEMO_LABEL}`,
    linkPath: "/portal",
  },
];

const ADMIN_NOTIFICATIONS: readonly DemoNotification[] = [
  {
    type: "REQUEST_RECEIVED",
    title: "New request FF-2026-00012",
    message: `Alex Morgan asked for AC Repair. ${DEMO_LABEL}`,
    linkPath: "/app/dashboard",
  },
  {
    type: "QUOTATION_ACCEPTED",
    title: "Quotation QT-2026-00004 was accepted",
    message: `Alex Morgan accepted the quotation. ${DEMO_LABEL}`,
    linkPath: "/app/account",
  },
];

export interface DemoNotificationsSummary {
  created: number;
  existing: number;
  /** Demo accounts that were not found (the base seed has not run). */
  missingAccounts: string[];
}

/** Inserts the demo notifications for the seeded demo customer and admin, skipping any already there. */
export async function seedDemoNotifications(
  prisma: PrismaClient,
): Promise<DemoNotificationsSummary> {
  const summary: DemoNotificationsSummary = { created: 0, existing: 0, missingAccounts: [] };

  const plan = DEMO_ACCOUNTS.flatMap((account) => {
    if (account.role === "BUSINESS_ADMIN")
      return [{ email: account.email, items: ADMIN_NOTIFICATIONS }];
    // Only the first demo customer gets them, so the second customer's bell stays empty (a useful contrast).
    return account.email === firstCustomerEmail()
      ? [{ email: account.email, items: CUSTOMER_NOTIFICATIONS }]
      : [];
  });

  for (const { email, items } of plan) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user === null) {
      summary.missingAccounts.push(email);
      continue;
    }
    for (const item of items) {
      const existing = await prisma.notification.count({
        where: { recipientUserId: user.id, title: item.title },
      });
      if (existing > 0) {
        summary.existing += 1;
        continue;
      }
      await notify(prisma, { ...item, recipientUserId: user.id });
      summary.created += 1;
    }
  }
  return summary;
}

function firstCustomerEmail(): string | undefined {
  return DEMO_ACCOUNTS.find((account) => account.role === "CUSTOMER")?.email;
}
