import {
  type AdminWorkOrderDto,
  type ScheduleWorkOrderBody,
  wallClockToInstant,
  WorkOrderStatus,
} from "@fixflow/shared";

import type { PrismaClient } from "../lib/db.js";
import type { TestAppOverrides } from "./build-test-app.js";
import {
  createQuotation,
  createServiceRequest,
  createTechnician,
  createWorkOrder,
} from "./fixtures.js";
import {
  CUSTOMER_QUOTATIONS,
  dataOf,
  makeRequest,
  type QuotationWorld,
  quotationWorld,
  sentQuotation,
} from "./quotation-world.js";

/**
 * What the work-order integration tests start from: the quotation world (two customers, an admin, two
 * services, everyone signed in) plus three technicians, and helpers that make a job the real way (a
 * request, a sent quotation, the customer's acceptance, the admin's conversion) or insert one in an
 * exact state. The test clock starts at 2 March 2026, 04:00 in New York, so "3 March" is tomorrow.
 */

export const ADMIN_WORK_ORDERS = "/api/v1/admin/work-orders";
export const ADMIN_QUOTATION_ROUTES = "/api/v1/admin/quotations";
export const BUSINESS_ZONE = "America/New_York";

export async function workOrderWorld(prisma: PrismaClient, options: TestAppOverrides = {}) {
  const w = await quotationWorld(prisma, options);
  const jordan = await createTechnician(prisma, {
    name: "Jordan Lee",
    calendarColor: "blue",
    phone: "(212) 555-0151",
    email: "jordan.lee@coolbreeze.test",
    notes: "Senior technician. Do not send to the Larkspur Lane job.",
  });
  const sam = await createTechnician(prisma, { name: "Sam Ortiz", calendarColor: "green" });
  const retired = await createTechnician(prisma, {
    name: "Rae Retired",
    calendarColor: "amber",
    isActive: false,
  });
  return { ...w, jordan, sam, retired };
}

export type WorkOrderWorld = Awaited<ReturnType<typeof workOrderWorld>>;

/** An instant on the business's clocks: `at("2026-03-03", "10:00")` is 15:00 UTC in winter. */
export function at(date: string, time: string): string {
  const instant = wallClockToInstant(date, time, BUSINESS_ZONE);
  if (instant === null) {
    throw new Error(`${date} ${time} does not exist in ${BUSINESS_ZONE}.`);
  }
  return instant.toISOString();
}

/** A request whose quotation was sent and accepted by the customer, through the real endpoints. */
export async function acceptedQuotation(w: QuotationWorld, owner: "alex" | "priya" = "alex") {
  const request = await makeRequest(w, { owner });
  const quotation = await sentQuotation(w, request.id);
  const response = await w.client.post(`${CUSTOMER_QUOTATIONS}/${quotation.id}/accept`, {
    cookie: owner === "alex" ? w.alexCookie : w.priyaCookie,
  });
  if (response.status !== 200) {
    throw new Error(`Accepting failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return { request, quotation };
}

export function convertRequest(w: QuotationWorld, quotationId: string, cookie = w.adminCookie) {
  return w.client.post(`${ADMIN_QUOTATION_ROUTES}/${quotationId}/work-order`, { cookie });
}

/** A new job, made the real way: `PENDING_SCHEDULING`. */
export async function newJob(
  w: QuotationWorld,
  owner: "alex" | "priya" = "alex",
): Promise<AdminWorkOrderDto> {
  const { quotation } = await acceptedQuotation(w, owner);
  const response = await convertRequest(w, quotation.id);
  if (response.status !== 201) {
    throw new Error(`Converting failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return dataOf<AdminWorkOrderDto>(response);
}

export function scheduleBody(
  job: Pick<AdminWorkOrderDto, "status">,
  technicianId: string,
  start: string,
  end: string,
  overrides: Partial<ScheduleWorkOrderBody> = {},
): ScheduleWorkOrderBody {
  return {
    scheduledStart: start,
    scheduledEnd: end,
    technicianId,
    expectedStatus: job.status,
    ...overrides,
  };
}

export function scheduleRequest(
  w: QuotationWorld,
  id: string,
  body: object,
  cookie = w.adminCookie,
) {
  return w.client.patch(`${ADMIN_WORK_ORDERS}/${id}/schedule`, { cookie }).send(body);
}

/** Schedules a job through the endpoint and returns it, failing the test setup if it is refused. */
export async function schedule(
  w: QuotationWorld,
  job: Pick<AdminWorkOrderDto, "id" | "status">,
  technicianId: string,
  start: string,
  end: string,
  overrides: Partial<ScheduleWorkOrderBody> = {},
): Promise<AdminWorkOrderDto> {
  const response = await scheduleRequest(
    w,
    job.id,
    scheduleBody(job, technicianId, start, end, overrides),
  );
  if (response.status !== 200) {
    throw new Error(`Scheduling failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return dataOf<AdminWorkOrderDto>(response);
}

/**
 * A job inserted directly, in exactly the state a test needs: its own request and accepted
 * quotation (a job has one of each), `CONVERTED_TO_JOB`. With `technicianId` and times it holds that
 * technician's time when its status is `SCHEDULED` or `IN_PROGRESS`.
 */
export async function insertJob(
  w: QuotationWorld,
  options: {
    status?: WorkOrderStatus;
    technicianId?: string | null;
    start?: string | null;
    end?: string | null;
    owner?: "alex" | "priya";
    createdAt?: Date;
  } = {},
) {
  const { status = WorkOrderStatus.SCHEDULED, owner = "alex" } = options;
  const request = await makeRequest(w, { owner, status: "CONVERTED_TO_JOB" });
  const quotation = await createQuotation(w.prisma, {
    requestId: request.id,
    customerId: w[owner].profile.id,
    createdByUserId: w.admin.id,
    status: "ACCEPTED",
    sentAt: new Date("2026-03-01T15:00:00.000Z"),
    respondedAt: new Date("2026-03-01T16:00:00.000Z"),
  });
  const times =
    options.start === undefined || options.start === null
      ? {}
      : {
          scheduledStart: new Date(options.start),
          scheduledEnd: new Date(options.end ?? options.start),
        };
  return createWorkOrder(w.prisma, {
    requestId: request.id,
    quotationId: quotation.id,
    customerId: w[owner].profile.id,
    serviceId: w.service.id,
    serviceNameSnapshot: "AC Repair",
    createdByUserId: w.admin.id,
    status,
    ...(options.technicianId !== undefined && { technicianId: options.technicianId }),
    ...times,
    ...(status === WorkOrderStatus.CANCELLED && {
      cancelledAt: new Date("2026-03-02T10:00:00.000Z"),
      cancelReason: "The customer moved away.",
    }),
    ...(status === WorkOrderStatus.COMPLETED && {
      completedAt: new Date("2026-03-02T12:00:00.000Z"),
    }),
    ...(options.createdAt !== undefined && { createdAt: options.createdAt }),
  });
}

/** A scheduled job inserted directly: it holds `technicianId`'s time from `start` to `end`. */
export function bookedJob(
  w: QuotationWorld,
  technicianId: string,
  start: string,
  end: string,
  status: WorkOrderStatus = WorkOrderStatus.SCHEDULED,
) {
  return insertJob(w, { status, technicianId, start, end });
}

// Re-exported so a test file imports its fixtures from one place.
export { createQuotation, createServiceRequest };
