import { randomUUID } from "node:crypto";

import {
  type CustomerRequestDto,
  type CustomerRequestListResponse,
  ErrorCode,
  type NewRequestAddress,
} from "@fixflow/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { FakeClock } from "../../lib/clock.js";
import { RATE_LIMITS } from "../../lib/rate-limit/limits.js";
import { createLocalAdmin, createLocalCustomer, signInAs } from "../../test/auth-helpers.js";
import { buildTestApp } from "../../test/build-test-app.js";
import { disconnectTestPrisma, getTestPrisma, resetDatabase } from "../../test/db.js";
import {
  createAddress,
  createAdmin,
  createBusinessSettings,
  createService,
  createServiceRequest,
} from "../../test/fixtures.js";
import { api, bodyOf, expectApiError } from "../../test/http.js";

const prisma = getTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await disconnectTestPrisma();
});

const ALEX = "alex.morgan@example.test";
const PRIYA = "priya.shah@example.test";
const REQUESTS = "/api/v1/requests";
const MINE = "/api/v1/requests/me";
const MISSING_ID = "0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11";

const DESCRIPTION = "The AC unit stopped cooling overnight and rattles loudly when it starts up.";
const STREET = "214 Larkspur Lane";
const ACCESS_NOTES = "Gate code 4821, dog in the yard.";

// The default test clock is 2026-03-02T09:00Z, which is 04:00 on 2 March in New York. So the range
// is 2026-03-03 to 2026-05-31, the clocks go forward on 2026-03-08, and:
const BEFORE_DST = "2026-03-04"; // EST, UTC-5
const DST_DAY = "2026-03-08"; // the day the clocks go forward
const AFTER_DST = "2026-03-10"; // EDT, UTC-4

const NEW_ADDRESS: NewRequestAddress = {
  label: "Rental unit",
  line1: "73 Millrace Court",
  city: "Harbor City",
  region: "NY",
  postalCode: "10998",
  accessNotes: "Ring twice.",
};

/** An app with two customers, two admins, an active service, and each customer's saved address. */
async function world(options: Parameters<typeof buildTestApp>[0] = {}) {
  await createBusinessSettings(prisma);
  const test = buildTestApp({ prisma, ...options });
  const alex = await createLocalCustomer(prisma, { email: ALEX, name: "Alex Morgan" });
  const priya = await createLocalCustomer(prisma, { email: PRIYA, name: "Priya Shah" });
  const admin = await createLocalAdmin(prisma);
  const secondAdmin = await createAdmin(prisma, {
    email: "second.admin@demo.fixflow.test",
    name: "Second Admin",
  });
  const service = await createService(prisma, { name: "AC Repair", slug: "ac-repair" });
  const alexAddress = await createAddress(prisma, alex.profile.id, {
    label: "Home",
    line1: STREET,
    line2: "Unit 4",
    city: "Harbor City",
    region: "NY",
    postalCode: "10001",
    accessNotes: ACCESS_NOTES,
    isDefault: true,
  });
  const priyaAddress = await createAddress(prisma, priya.profile.id, {
    label: "Priya's home",
    line1: "9 Orchard Row",
    isDefault: true,
  });
  return {
    ...test,
    client: api(test.app),
    alex,
    priya,
    admin,
    secondAdmin,
    service,
    alexAddress,
    priyaAddress,
    alexCookie: await signInAs(test.app, ALEX),
    priyaCookie: await signInAs(test.app, PRIYA),
    adminCookie: await signInAs(test.app, admin.email),
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** A valid body for a saved address; each test changes only what it is about. */
function validBody(w: World, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serviceId: w.service.id,
    description: DESCRIPTION,
    serviceAddressId: w.alexAddress.id,
    preferredDate: AFTER_DST,
    preferredWindow: "MORNING",
    submissionKey: randomUUID(),
    ...overrides,
  };
}

/** A valid body for a new address, without the saved-address id. */
function newAddressBody(w: World, overrides: Record<string, unknown> = {}) {
  const { serviceAddressId: _omit, ...rest } = validBody(w);
  return { ...rest, newAddress: NEW_ADDRESS, ...overrides };
}

function submit(w: World, body: Record<string, unknown>, cookie: string = w.alexCookie) {
  return w.client.post(REQUESTS, { cookie }).send(body);
}

const requestOf = (response: { body: unknown }) =>
  (response.body as { data: CustomerRequestDto }).data;

/** Everything a submission may create or touch, to prove a rejected one left nothing behind. */
async function footprint(w: Pick<World, "emails">) {
  const [requests, addresses, activity, notifications, deliveries, counters] = await Promise.all([
    prisma.serviceRequest.count(),
    prisma.serviceAddress.count(),
    prisma.activityEvent.count(),
    prisma.notification.count(),
    prisma.emailDeliveryLog.count(),
    prisma.referenceCounter.count(),
  ]);
  return {
    requests,
    addresses,
    activity,
    notifications,
    deliveries,
    counters,
    sent: w.emails.sent.length,
  };
}

describe("authentication and roles", () => {
  it("answers 401 to every endpoint without a session", async () => {
    const { app } = buildTestApp({ prisma });
    const client = api(app);

    for (const response of [
      await client.post(REQUESTS).send({}),
      await client.get(MINE),
      await client.get(`${REQUESTS}/${MISSING_ID}`),
    ]) {
      expectApiError(response, { status: 401, code: ErrorCode.UNAUTHENTICATED });
    }
  });

  it("refuses an admin who tries to submit a request (403) and creates nothing", async () => {
    const w = await world();
    const before = await footprint(w);

    const response = await submit(w, validBody(w), w.adminCookie);

    expectApiError(response, { status: 403, code: ErrorCode.FORBIDDEN });
    expect(await footprint(w)).toEqual(before);
  });

  it("refuses an admin before reading the body: an empty body is 403, not a validation error", async () => {
    const w = await world();

    const response = await w.client.post(REQUESTS, { cookie: w.adminCookie }).send({});

    expectApiError(response, { status: 403, code: ErrorCode.FORBIDDEN });
  });

  it("refuses an admin the customer's own list (403)", async () => {
    const w = await world();

    expectApiError(await w.client.get(MINE, { cookie: w.adminCookie }), {
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
  });

  it("refuses a submission from another origin (CSRF) and creates nothing", async () => {
    const w = await world();
    const before = await footprint(w);

    const response = await w.client
      .post(REQUESTS, { cookie: w.alexCookie, origin: "https://evil.example.com" })
      .send(validBody(w));

    expectApiError(response, { status: 403, code: ErrorCode.CSRF_ORIGIN_MISMATCH });
    expect(await footprint(w)).toEqual(before);
  });
});

describe("POST /requests: a valid submission (FR-020, FR-021, G.1)", () => {
  it("creates the request with a reference, SUBMITTED status and the snapshots", async () => {
    const w = await world();

    const response = await submit(w, validBody(w, { preferredWindow: "AFTERNOON" }));

    expect(response.status).toBe(201);
    const request = requestOf(response);
    expect(request.reference).toMatch(/^FF-\d{4}-\d{5}$/);
    expect(request.reference).toBe("FF-2026-00001");
    expect(request).toMatchObject({
      status: "SUBMITTED",
      statusLabel: "Submitted",
      nextStep: "We're reviewing your request and will send a quotation.",
      serviceName: "AC Repair",
      description: DESCRIPTION,
      preferredDate: AFTER_DST,
      preferredWindow: "AFTERNOON",
      address: {
        line1: STREET,
        line2: "Unit 4",
        city: "Harbor City",
        region: "NY",
        postalCode: "10001",
        accessNotes: ACCESS_NOTES,
      },
    });

    const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row).toMatchObject({
      reference: "FF-2026-00001",
      customerId: w.alex.profile.id,
      serviceId: w.service.id,
      serviceNameSnapshot: "AC Repair",
      serviceAddressId: w.alexAddress.id,
      addressLine1: STREET,
      addressLine2: "Unit 4",
      addressCity: "Harbor City",
      addressRegion: "NY",
      addressPostalCode: "10001",
      accessNotesSnapshot: ACCESS_NOTES,
      description: DESCRIPTION,
      status: "SUBMITTED",
      preferredWindow: "AFTERNOON",
      submittedAt: w.clock.now(),
      cancelReason: null,
    });
    expect(row.preferredDate.toISOString()).toBe("2026-03-10T00:00:00.000Z");
  });

  it("lists it in the customer's own requests and returns the same request by id", async () => {
    const w = await world();
    const created = requestOf(await submit(w, validBody(w)));

    const list = await w.client.get(MINE, { cookie: w.alexCookie });
    const detail = await w.client.get(`${REQUESTS}/${created.id}`, { cookie: w.alexCookie });

    expect(list.status).toBe(200);
    const page = bodyOf<CustomerRequestListResponse>(list);
    expect(page.data.map((item) => item.id)).toEqual([created.id]);
    expect(page.data[0]).toMatchObject({
      reference: created.reference,
      statusLabel: "Submitted",
      serviceName: "AC Repair",
    });
    expect(page.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 1, totalPages: 1 });
    expect(requestOf(detail)).toEqual(created);
  });

  it("gives each request the next reference, with no gaps", async () => {
    const w = await world();

    const references = [];
    for (let index = 0; index < 3; index += 1) {
      references.push(requestOf(await submit(w, validBody(w))).reference);
    }

    expect(references).toEqual(["FF-2026-00001", "FF-2026-00002", "FF-2026-00003"]);
  });

  it("numbers requests that arrive at the same moment without a duplicate or a gap", async () => {
    const w = await world();

    const responses = await Promise.all(Array.from({ length: 6 }, () => submit(w, validBody(w))));

    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(201));
    const references = responses.map((response) => requestOf(response).reference).sort();
    expect(references).toEqual([
      "FF-2026-00001",
      "FF-2026-00002",
      "FF-2026-00003",
      "FF-2026-00004",
      "FF-2026-00005",
      "FF-2026-00006",
    ]);
  });

  it("takes the year of the reference from the business's calendar, not UTC's", async () => {
    // 04:30 UTC on 1 January 2027 is 23:30 on 31 December 2026 in New York.
    const w = await world({ clock: new FakeClock("2027-01-01T04:30:00.000Z") });

    const response = await submit(w, validBody(w, { preferredDate: "2027-01-05" }));

    expect(response.status).toBe(201);
    expect(requestOf(response).reference).toBe("FF-2026-00001");
  });

  it("keeps the description as typed, with only its ends trimmed", async () => {
    const w = await world();

    const response = await submit(
      w,
      validBody(w, { description: `  ${DESCRIPTION}\n\nThanks.  ` }),
    );

    expect(requestOf(response).description).toBe(`${DESCRIPTION}\n\nThanks.`);
  });

  it("refuses a body that names the owner, the status, the reference or the times (422)", async () => {
    const w = await world();
    const before = await footprint(w);

    for (const extra of [
      { customerId: w.priya.profile.id },
      { status: "ACCEPTED" },
      { reference: "FF-2026-99999" },
      { submittedAt: "2020-01-01T00:00:00.000Z" },
      { preferredStart: "2026-03-10T00:00:00.000Z" },
    ]) {
      const response = await submit(w, validBody(w, extra));
      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(Object.values(error.fieldErrors ?? {})).toContain("Unknown field.");
    }

    expect(await footprint(w)).toEqual(before);
  });
});

describe("the preferred window in the business time zone (D-35, G.8)", () => {
  async function windowOf(w: World, preferredDate: string, preferredWindow: string) {
    const request = requestOf(await submit(w, validBody(w, { preferredDate, preferredWindow })));
    return [request.preferredStart, request.preferredEnd];
  }

  it("stores UTC instants worked out for the day itself: winter time before the change", async () => {
    const w = await world();

    expect(await windowOf(w, BEFORE_DST, "MORNING")).toEqual([
      "2026-03-04T13:00:00.000Z",
      "2026-03-04T17:00:00.000Z",
    ]);
  });

  it("uses summer time all day on the day the clocks go forward", async () => {
    const w = await world();

    expect(await windowOf(w, DST_DAY, "MORNING")).toEqual([
      "2026-03-08T12:00:00.000Z",
      "2026-03-08T16:00:00.000Z",
    ]);
  });

  it("uses summer time after the change, and the evening ends at 19:00 local", async () => {
    const w = await world();

    expect(await windowOf(w, AFTER_DST, "EVENING")).toEqual([
      "2026-03-10T20:00:00.000Z",
      "2026-03-10T23:00:00.000Z",
    ]);
  });

  it("converts a date across the autumn change as well", async () => {
    const w = await world({ clock: new FakeClock("2026-10-30T14:00:00.000Z") });

    expect(await windowOf(w, "2026-10-31", "MORNING")).toEqual([
      "2026-10-31T12:00:00.000Z",
      "2026-10-31T16:00:00.000Z",
    ]);
    // 1 November: the clocks went back overnight, so 08:00 is 13:00 UTC.
    expect(await windowOf(w, "2026-11-01", "MORNING")).toEqual([
      "2026-11-01T13:00:00.000Z",
      "2026-11-01T17:00:00.000Z",
    ]);
  });

  it("follows the business's time zone setting, not a built-in one", async () => {
    const w = await world();
    await prisma.businessSettings.updateMany({ data: { timeZone: "Europe/London" } });

    // 10 March 2026 is still Greenwich Mean Time (UTC+0): London's clocks go forward on 29 March.
    expect(await windowOf(w, AFTER_DST, "MORNING")).toEqual([
      "2026-03-10T08:00:00.000Z",
      "2026-03-10T12:00:00.000Z",
    ]);
  });
});

describe("the preferred date range (tomorrow to 90 days ahead, injected clock)", () => {
  it("accepts tomorrow and the last day of the range", async () => {
    const w = await world();

    expect((await submit(w, validBody(w, { preferredDate: "2026-03-03" }))).status).toBe(201);
    expect((await submit(w, validBody(w, { preferredDate: "2026-05-31" }))).status).toBe(201);
  });

  it.each([
    ["today", "2026-03-02", /from tomorrow/],
    ["yesterday", "2026-03-01", /from tomorrow/],
    ["a year ago", "2025-03-02", /from tomorrow/],
    ["the day after the range", "2026-06-01", /90 days/],
    ["next year", "2027-03-02", /90 days/],
  ])(
    "rejects %s with a message on the date field and creates nothing",
    async (_name, date, message) => {
      const w = await world();
      const before = await footprint(w);

      const response = await submit(w, validBody(w, { preferredDate: date }));

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(error.fieldErrors?.preferredDate).toMatch(message);
      expect(await footprint(w)).toEqual(before);
    },
  );

  it("judges 'today' by the business's calendar late in the evening (UTC is already tomorrow)", async () => {
    // 02:30 UTC on 3 March is 21:30 on 2 March in New York, so 3 March is still tomorrow.
    const w = await world({ clock: new FakeClock("2026-03-03T02:30:00.000Z") });

    expect((await submit(w, validBody(w, { preferredDate: "2026-03-03" }))).status).toBe(201);
    const today = await submit(w, validBody(w, { preferredDate: "2026-03-02" }));
    expectApiError(today, { status: 422, code: ErrorCode.VALIDATION_ERROR });
  });

  it("moves the range with the clock", async () => {
    const w = await world();
    expect((await submit(w, validBody(w, { preferredDate: "2026-03-05" }))).status).toBe(201);

    // Three days later, 05 March is today. (The clock stays inside the 7-day session.)
    w.clock.set("2026-03-05T15:00:00.000Z");
    const today = await submit(w, validBody(w, { preferredDate: "2026-03-05" }));
    const tomorrow = await submit(w, validBody(w, { preferredDate: "2026-03-06" }));

    expectApiError(today, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(tomorrow.status).toBe(201);
  });
});

describe("validation failures create nothing (G.2)", () => {
  const CASES: Array<[string, (w: World) => Record<string, unknown>, string]> = [
    [
      "a description that is too short",
      (w) => validBody(w, { description: "Broken." }),
      "description",
    ],
    ["a missing description", (w) => validBody(w, { description: undefined }), "description"],
    [
      "an unknown time window",
      (w) => validBody(w, { preferredWindow: "NIGHT" }),
      "preferredWindow",
    ],
    [
      "a date that does not exist",
      (w) => validBody(w, { preferredDate: "2026-02-30" }),
      "preferredDate",
    ],
    [
      "a date in the wrong format",
      (w) => validBody(w, { preferredDate: "10/03/2026" }),
      "preferredDate",
    ],
    [
      "a service id that is not an id",
      (w) => validBody(w, { serviceId: "ac-repair" }),
      "serviceId",
    ],
    [
      "a submission key that is not a UUID",
      (w) => validBody(w, { submissionKey: "abc" }),
      "submissionKey",
    ],
    [
      "both a saved and a new address",
      (w) => validBody(w, { newAddress: NEW_ADDRESS }),
      "newAddress",
    ],
    [
      "neither a saved nor a new address",
      (w) => validBody(w, { serviceAddressId: undefined }),
      "serviceAddressId",
    ],
    [
      "a new address with no street",
      (w) => newAddressBody(w, { newAddress: { ...NEW_ADDRESS, line1: "" } }),
      "newAddress.line1",
    ],
    [
      "a new address saved without a label",
      (w) =>
        newAddressBody(w, {
          newAddress: { ...NEW_ADDRESS, label: undefined },
          saveAddressToProfile: true,
        }),
      "newAddress.label",
    ],
    [
      "'save to profile' for a saved address",
      (w) => validBody(w, { saveAddressToProfile: true }),
      "saveAddressToProfile",
    ],
  ];

  it.each(CASES)(
    "rejects %s with a field error, and nothing is created",
    async (_name, build, field) => {
      const w = await world();
      const before = await footprint(w);

      const response = await submit(w, build(w));

      const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
      expect(error.fieldErrors).toHaveProperty([field]);
      expect(await footprint(w)).toEqual(before);
    },
  );

  it("reports every invalid field at once; the rule between the two address fields follows once those are valid", async () => {
    const w = await world();

    const response = await submit(w, {
      serviceId: "x",
      description: "short",
      preferredDate: "never",
      preferredWindow: "NIGHT",
      submissionKey: "y",
    });

    const error = expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual([
      "description",
      "preferredDate",
      "preferredWindow",
      "serviceId",
      "submissionKey",
    ]);
  });

  it("does not save the address typed in when the date is wrong (nothing is half-done)", async () => {
    const w = await world();
    const before = await footprint(w);

    const response = await submit(
      w,
      newAddressBody(w, { saveAddressToProfile: true, preferredDate: "2026-03-01" }),
    );

    expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    expect(await footprint(w)).toEqual(before);
    expect(await prisma.serviceAddress.count({ where: { customerId: w.alex.profile.id } })).toBe(1);
  });

  it("rolls everything back when the database fails after the address was saved", async () => {
    const w = await world();
    // The next reference will be FF-2026-00001, which another request already has: the insert fails
    // after the address has been written, inside the same transaction.
    await createServiceRequest(prisma, {
      customerId: w.priya.profile.id,
      serviceId: w.service.id,
      reference: "FF-2026-00001",
    });
    const before = await footprint(w);

    const response = await submit(w, newAddressBody(w, { saveAddressToProfile: true }));

    expectApiError(response, { status: 500, code: ErrorCode.INTERNAL_ERROR });
    expect(await footprint(w)).toEqual(before);
    expect(await prisma.serviceAddress.count({ where: { customerId: w.alex.profile.id } })).toBe(1);
    expect(await prisma.referenceCounter.count()).toBe(0);
    expect(w.emails.sent).toHaveLength(0);
  });
});

describe("only an active service can be requested (FR-006, G.3)", () => {
  async function rejectsService(w: World, serviceId: string) {
    const before = await footprint(w);
    const response = await submit(w, validBody(w, { serviceId }));

    const error = expectApiError(response, { status: 422, code: ErrorCode.SERVICE_INACTIVE });
    expect(error.fieldErrors?.serviceId).toMatch(/isn't open for new requests/);
    expect(await footprint(w)).toEqual(before);
  }

  it("rejects an unpublished service", async () => {
    const w = await world();
    const draft = await createService(prisma, { name: "Draft", isPublished: false });

    await rejectsService(w, draft.id);
  });

  it("rejects an archived service", async () => {
    const w = await world();
    const archived = await createService(prisma, {
      name: "Old",
      isPublished: false,
      archivedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await rejectsService(w, archived.id);
  });

  it("rejects a service that is both published and archived (archived wins)", async () => {
    const w = await world();
    const odd = await createService(prisma, {
      name: "Odd",
      isPublished: true,
      archivedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await rejectsService(w, odd.id);
  });

  it("rejects a service that does not exist, in the same words as an inactive one", async () => {
    const w = await world();
    const draft = await createService(prisma, { name: "Draft", isPublished: false });

    const missing = await submit(w, validBody(w, { serviceId: MISSING_ID }));
    const inactive = await submit(w, validBody(w, { serviceId: draft.id }));

    expect(bodyOf<{ error: { message: string } }>(missing).error.message).toBe(
      bodyOf<{ error: { message: string } }>(inactive).error.message,
    );
    expectApiError(missing, { status: 422, code: ErrorCode.SERVICE_INACTIVE });
  });

  it("stops accepting a service as soon as it is archived", async () => {
    const w = await world();
    expect((await submit(w, validBody(w))).status).toBe(201);

    await prisma.service.update({
      where: { id: w.service.id },
      data: { isPublished: false, archivedAt: new Date("2026-03-02T09:30:00.000Z") },
    });

    expectApiError(await submit(w, validBody(w)), {
      status: 422,
      code: ErrorCode.SERVICE_INACTIVE,
    });
    expect(await prisma.serviceRequest.count()).toBe(1);
  });

  it("reports the inactive service together with the other problems", async () => {
    const w = await world();
    const draft = await createService(prisma, { name: "Draft", isPublished: false });

    const response = await submit(
      w,
      validBody(w, { serviceId: draft.id, preferredDate: "2026-03-01" }),
    );

    const error = expectApiError(response, { status: 422, code: ErrorCode.SERVICE_INACTIVE });
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(["preferredDate", "serviceId"]);
  });
});

describe("the address (D-36)", () => {
  it("refuses another customer's saved address like one that does not exist, and creates nothing", async () => {
    const w = await world();
    const before = await footprint(w);

    const foreign = await submit(w, validBody(w, { serviceAddressId: w.priyaAddress.id }));
    const missing = await submit(w, validBody(w, { serviceAddressId: MISSING_ID }));

    const foreignError = expectApiError(foreign, {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    const missingError = expectApiError(missing, {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
    expect(foreignError.fieldErrors).toEqual(missingError.fieldErrors);
    expect(foreignError.fieldErrors).toHaveProperty(["serviceAddressId"]);
    expect(await footprint(w)).toEqual(before);
    // Nothing about Priya's address leaked into the answer.
    expect(JSON.stringify(foreign.body)).not.toContain("Orchard");
  });

  it("copies a new address that is not saved and links to no saved address", async () => {
    const w = await world();

    const response = await submit(w, newAddressBody(w, { saveAddressToProfile: false }));

    expect(response.status).toBe(201);
    const request = requestOf(response);
    expect(request.address).toEqual({
      line1: "73 Millrace Court",
      line2: null,
      city: "Harbor City",
      region: "NY",
      postalCode: "10998",
      accessNotes: "Ring twice.",
    });
    const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.serviceAddressId).toBeNull();
    expect(await prisma.serviceAddress.count({ where: { customerId: w.alex.profile.id } })).toBe(1);
  });

  it("saves a new address to the profile with the request, and links the two", async () => {
    const w = await world();

    const response = await submit(w, newAddressBody(w, { saveAddressToProfile: true }));

    expect(response.status).toBe(201);
    const saved = await prisma.serviceAddress.findFirstOrThrow({
      where: { customerId: w.alex.profile.id, label: "Rental unit" },
    });
    expect(saved).toMatchObject({
      line1: "73 Millrace Court",
      postalCode: "10998",
      accessNotes: "Ring twice.",
      // Alex already has a default, so the new one is not.
      isDefault: false,
    });
    const row = await prisma.serviceRequest.findUniqueOrThrow({
      where: { id: requestOf(response).id },
    });
    expect(row.serviceAddressId).toBe(saved.id);
  });

  it("makes a saved address the default when it is the customer's first", async () => {
    const w = await world();
    await prisma.serviceAddress.deleteMany({ where: { customerId: w.alex.profile.id } });

    await submit(w, newAddressBody(w, { saveAddressToProfile: true }));

    const saved = await prisma.serviceAddress.findMany({
      where: { customerId: w.alex.profile.id },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.isDefault).toBe(true);
  });

  it("refuses to save an eleventh address and creates nothing", async () => {
    const w = await world();
    for (let index = 0; index < 9; index += 1) {
      await createAddress(prisma, w.alex.profile.id, { label: `Extra ${index}` });
    }
    expect(await prisma.serviceAddress.count({ where: { customerId: w.alex.profile.id } })).toBe(
      10,
    );
    const before = await footprint(w);

    const response = await submit(w, newAddressBody(w, { saveAddressToProfile: true }));

    expectApiError(response, { status: 409, code: ErrorCode.ADDRESS_LIMIT_REACHED });
    expect(await footprint(w)).toEqual(before);
  });

  it("still takes a new address that is not saved when the customer has ten saved", async () => {
    const w = await world();
    for (let index = 0; index < 9; index += 1) {
      await createAddress(prisma, w.alex.profile.id, { label: `Extra ${index}` });
    }

    const response = await submit(w, newAddressBody(w, { saveAddressToProfile: false }));

    expect(response.status).toBe(201);
  });

  it("keeps its own copy when the saved address is edited, and when it is deleted", async () => {
    const w = await world();
    const created = requestOf(await submit(w, validBody(w)));

    await prisma.serviceAddress.update({
      where: { id: w.alexAddress.id },
      data: { line1: "999 Changed Street", accessNotes: "New code 0000" },
    });
    const afterEdit = requestOf(
      await w.client.get(`${REQUESTS}/${created.id}`, { cookie: w.alexCookie }),
    );
    await prisma.serviceAddress.delete({ where: { id: w.alexAddress.id } });
    const afterDelete = requestOf(
      await w.client.get(`${REQUESTS}/${created.id}`, { cookie: w.alexCookie }),
    );

    expect(afterEdit.address).toEqual(created.address);
    expect(afterDelete.address).toEqual(created.address);
    expect(afterDelete.address.line1).toBe(STREET);
    const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.serviceAddressId).toBeNull();
  });

  it("keeps the service name it was requested under when the service is renamed", async () => {
    const w = await world();
    const created = requestOf(await submit(w, validBody(w)));

    await prisma.service.update({ where: { id: w.service.id }, data: { name: "Cooling Repair" } });
    const later = requestOf(
      await w.client.get(`${REQUESTS}/${created.id}`, { cookie: w.alexCookie }),
    );

    expect(later.serviceName).toBe("AC Repair");
  });
});

describe("duplicate submissions (D-45, API-06, G.4)", () => {
  it("returns the first request with 200 for the same key and creates nothing more", async () => {
    const w = await world();
    const body = validBody(w);

    const first = await submit(w, body);
    const second = await submit(w, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(requestOf(second)).toEqual(requestOf(first));
    expect(await prisma.serviceRequest.count()).toBe(1);
    expect(await prisma.activityEvent.count()).toBe(1);
    // One notification for each of the two admins, and one customer and one admin email: once.
    expect(await prisma.notification.count()).toBe(2);
    await w.deps.emailDispatcher.idle();
    expect(w.emails.sent).toHaveLength(2);
    expect(await prisma.referenceCounter.findFirstOrThrow()).toMatchObject({ value: 1 });
  });

  it("creates one request when the same key arrives several times at once", async () => {
    const w = await world();
    const body = validBody(w);

    const responses = await Promise.all(Array.from({ length: 6 }, () => submit(w, body)));

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(5);
    expect(new Set(responses.map((response) => requestOf(response).id)).size).toBe(1);
    expect(await prisma.serviceRequest.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(2);
    await w.deps.emailDispatcher.idle();
    expect(w.emails.sent).toHaveLength(2);
    // The one reference used is the first: no number was spent on a duplicate.
    const next = await submit(w, validBody(w));
    expect(requestOf(next).reference).toBe("FF-2026-00002");
  });

  it("returns the original even when it is repeated with other content", async () => {
    const w = await world();
    const key = randomUUID();
    const first = await submit(w, validBody(w, { submissionKey: key }));

    const second = await submit(
      w,
      validBody(w, { submissionKey: key, description: `${DESCRIPTION} (edited)` }),
    );

    expect(second.status).toBe(200);
    expect(requestOf(second).description).toBe(DESCRIPTION);
    expect(requestOf(second).id).toBe(requestOf(first).id);
  });

  it("returns the original after the service was archived or the date passed (the retry is still a retry)", async () => {
    const w = await world();
    const body = validBody(w, { preferredDate: "2026-03-04" });
    const first = await submit(w, body);
    await prisma.service.update({
      where: { id: w.service.id },
      data: { isPublished: false, archivedAt: new Date() },
    });
    // Four days on, 04 March is in the past. (The clock stays inside the 7-day session.)
    w.clock.set("2026-03-06T12:00:00.000Z");

    const retry = await submit(w, body);

    expect(retry.status).toBe(200);
    expect(requestOf(retry).id).toBe(requestOf(first).id);
  });

  it("does not let one customer's key collide with another's", async () => {
    const w = await world();
    const key = randomUUID();

    const alexs = await submit(w, validBody(w, { submissionKey: key }));
    const priyas = await submit(
      w,
      validBody(w, { submissionKey: key, serviceAddressId: w.priyaAddress.id }),
      w.priyaCookie,
    );

    expect(alexs.status).toBe(201);
    expect(priyas.status).toBe(201);
    expect(requestOf(priyas).id).not.toBe(requestOf(alexs).id);
  });

  it("gives different keys different requests", async () => {
    const w = await world();

    await submit(w, validBody(w));
    await submit(w, validBody(w));

    expect(await prisma.serviceRequest.count()).toBe(2);
  });
});

describe("GET /requests/me (FR-022)", () => {
  async function insertRequests(w: World, count: number, customerId: string, status = "SUBMITTED") {
    for (let index = 0; index < count; index += 1) {
      await createServiceRequest(prisma, {
        customerId,
        serviceId: w.service.id,
        serviceNameSnapshot: "AC Repair",
        status: status as "SUBMITTED",
        submittedAt: new Date(Date.UTC(2026, 0, 1, 10, index)),
      });
    }
  }

  it("lists only the caller's requests, newest first, in pages", async () => {
    const w = await world();
    await insertRequests(w, 25, w.alex.profile.id);
    await insertRequests(w, 3, w.priya.profile.id);

    const first = bodyOf<CustomerRequestListResponse>(
      await w.client.get(MINE, { cookie: w.alexCookie }),
    );
    const second = bodyOf<CustomerRequestListResponse>(
      await w.client.get(`${MINE}?page=2`, { cookie: w.alexCookie }),
    );

    expect(first.data).toHaveLength(20);
    expect(second.data).toHaveLength(5);
    expect(first.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 25, totalPages: 2 });
    const times = [...first.data, ...second.data].map((item) => item.submittedAt);
    expect(times).toEqual([...times].sort().reverse());
    const priyas = await prisma.serviceRequest.findMany({
      where: { customerId: w.priya.profile.id },
      select: { id: true },
    });
    const seen = new Set([...first.data, ...second.data].map((item) => item.id));
    for (const { id } of priyas) {
      expect(seen.has(id)).toBe(false);
    }
  });

  it("filters by status", async () => {
    const w = await world();
    await insertRequests(w, 2, w.alex.profile.id, "SUBMITTED");
    await insertRequests(w, 3, w.alex.profile.id, "CANCELLED");

    const cancelled = bodyOf<CustomerRequestListResponse>(
      await w.client.get(`${MINE}?status=CANCELLED`, { cookie: w.alexCookie }),
    );

    expect(cancelled.data).toHaveLength(3);
    expect(cancelled.data.every((item) => item.status === "CANCELLED")).toBe(true);
    expect(cancelled.data[0]).toMatchObject({ statusLabel: "Cancelled" });
    expect(cancelled.pagination.totalItems).toBe(3);
  });

  it("is an empty page, not an error, for a customer with no requests", async () => {
    const w = await world();

    const response = await w.client.get(MINE, { cookie: w.alexCookie });

    expect(response.status).toBe(200);
    expect(bodyOf<CustomerRequestListResponse>(response)).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    });
  });

  it.each(["?status=OPEN", "?sort=reference", "?pageSize=101", "?page=0"])(
    "rejects the query %s with 422",
    async (query) => {
      const w = await world();

      expectApiError(await w.client.get(`${MINE}${query}`, { cookie: w.alexCookie }), {
        status: 422,
        code: ErrorCode.VALIDATION_ERROR,
      });
    },
  );

  it("shows list rows without the description or the address", async () => {
    const w = await world();
    await submit(w, validBody(w));

    const response = await w.client.get(MINE, { cookie: w.alexCookie });

    const text = JSON.stringify(response.body);
    expect(text).not.toContain(DESCRIPTION);
    expect(text).not.toContain(STREET);
    expect(text).not.toContain(ACCESS_NOTES);
  });

  it("ignores a customer id in the query", async () => {
    const w = await world();
    await insertRequests(w, 2, w.priya.profile.id);

    const response = await w.client.get(`${MINE}?customerId=${w.priya.profile.id}`, {
      cookie: w.alexCookie,
    });

    expect(bodyOf<CustomerRequestListResponse>(response).data).toHaveLength(0);
  });
});

describe("GET /requests/:id: ownership and the customer's view (D-41, BR-21, G.5)", () => {
  it("answers another customer 404, exactly like an id that does not exist", async () => {
    const w = await world();
    const created = requestOf(await submit(w, validBody(w)));

    const foreign = await w.client.get(`${REQUESTS}/${created.id}`, { cookie: w.priyaCookie });
    const missing = await w.client.get(`${REQUESTS}/${MISSING_ID}`, { cookie: w.priyaCookie });

    expectApiError(foreign, { status: 404, code: ErrorCode.NOT_FOUND });
    expectApiError(missing, { status: 404, code: ErrorCode.NOT_FOUND });
    expect(bodyOf<{ error: { message: string } }>(foreign).error.message).toBe(
      bodyOf<{ error: { message: string } }>(missing).error.message,
    );
    const text = JSON.stringify(foreign.body);
    expect(text).not.toContain(created.reference);
    expect(text).not.toContain(DESCRIPTION);
  });

  it("never treats the reference as a way in", async () => {
    const w = await world();
    const created = requestOf(await submit(w, validBody(w)));

    for (const cookie of [w.alexCookie, w.priyaCookie, w.adminCookie]) {
      const response = await w.client.get(`${REQUESTS}/${created.reference}`, { cookie });
      expectApiError(response, { status: 422, code: ErrorCode.VALIDATION_ERROR });
    }
    // Searching by reference through the list does not exist either.
    const list = await w.client.get(`${MINE}?reference=${created.reference}`, {
      cookie: w.priyaCookie,
    });
    expect(bodyOf<CustomerRequestListResponse>(list).data).toHaveLength(0);
  });

  it("gives an admin the same customer view (a preview, D-41)", async () => {
    const w = await world();
    const created = requestOf(await submit(w, validBody(w)));

    const asAdmin = await w.client.get(`${REQUESTS}/${created.id}`, { cookie: w.adminCookie });
    const asOwner = await w.client.get(`${REQUESTS}/${created.id}`, { cookie: w.alexCookie });

    expect(asAdmin.status).toBe(200);
    expect(requestOf(asAdmin)).toEqual(requestOf(asOwner));
  });

  it("answers an admin 404 for an id that does not exist", async () => {
    const w = await world();

    expectApiError(await w.client.get(`${REQUESTS}/${MISSING_ID}`, { cookie: w.adminCookie }), {
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });

  it("refuses an admin who is no longer on the allowlist", async () => {
    const w = await world();
    const created = requestOf(await submit(w, validBody(w)));
    const delisted = await createLocalAdmin(prisma, { email: "former.admin@demo.fixflow.test" });
    const cookie = await signInAs(w.app, delisted.email);

    const response = await w.client.get(`${REQUESTS}/${created.id}`, { cookie });

    expectApiError(response, { status: 403, code: ErrorCode.FORBIDDEN });
  });

  it("never includes an internal note or an internal activity event, for the owner or an admin", async () => {
    const w = await world();
    const created = requestOf(await submit(w, validBody(w)));
    const INTERNAL_NOTE = "Customer was rude on the phone last year; quote high.";
    const INTERNAL_EVENT = "Morgan flagged this address as a repeat no-show.";
    const VISIBLE_NOTE = "We will bring a replacement capacitor with us.";
    await prisma.requestNote.createMany({
      data: [
        {
          requestId: created.id,
          authorUserId: w.admin.id,
          body: INTERNAL_NOTE,
          visibility: "INTERNAL",
        },
        {
          requestId: created.id,
          authorUserId: w.admin.id,
          body: VISIBLE_NOTE,
          visibility: "CUSTOMER_VISIBLE",
        },
      ],
    });
    await prisma.activityEvent.create({
      data: {
        actorUserId: w.admin.id,
        entityType: "SERVICE_REQUEST",
        entityId: created.id,
        action: "request.flagged",
        summary: INTERNAL_EVENT,
        publicSummary: null,
        requestId: created.id,
        customerId: w.alex.profile.id,
      },
    });
    // Even an event that has a public summary stays out when it belongs to someone else.
    await prisma.activityEvent.create({
      data: {
        actorUserId: w.admin.id,
        entityType: "SERVICE_REQUEST",
        entityId: created.id,
        action: "request.misfiled",
        summary: "Wrong customer.",
        publicSummary: "This belongs to somebody else.",
        requestId: created.id,
        customerId: w.priya.profile.id,
      },
    });

    for (const cookie of [w.alexCookie, w.adminCookie]) {
      const response = await w.client.get(`${REQUESTS}/${created.id}`, { cookie });
      const request = requestOf(response);
      const text = JSON.stringify(response.body);

      expect(text).not.toContain(INTERNAL_NOTE);
      expect(text).not.toContain(INTERNAL_EVENT);
      expect(text).not.toContain("somebody else");
      expect(text).not.toContain("Test Admin");
      expect(text).not.toContain(w.admin.id);
      expect(request.notes).toHaveLength(1);
      expect(request.notes[0]).toMatchObject({
        body: VISIBLE_NOTE,
        // The business, not the staff member's name.
        author: "CoolBreeze Home Services",
      });
      expect(Object.keys(request.notes[0] ?? {}).sort()).toEqual([
        "author",
        "body",
        "createdAt",
        "id",
      ]);
      expect(request.timeline).toHaveLength(1);
      expect(request.timeline[0]).toMatchObject({
        publicSummary: "You submitted your request.",
        actor: "You",
        toStatus: "SUBMITTED",
      });
      expect(Object.keys(request.timeline[0] ?? {}).sort()).toEqual([
        "actor",
        "createdAt",
        "id",
        "publicSummary",
        "toStatus",
      ]);
    }
  });

  it("has exactly the customer's fields (an allowlist)", async () => {
    const w = await world();
    const created = requestOf(await submit(w, validBody(w)));

    const request = requestOf(
      await w.client.get(`${REQUESTS}/${created.id}`, { cookie: w.alexCookie }),
    );

    expect(Object.keys(request).sort()).toEqual(
      [
        "id",
        "reference",
        "status",
        "statusLabel",
        "nextStep",
        "serviceName",
        "preferredDate",
        "preferredWindow",
        "submittedAt",
        "description",
        "address",
        "preferredStart",
        "preferredEnd",
        "cancellation",
        "notes",
        "timeline",
      ].sort(),
    );
    const text = JSON.stringify(request);
    expect(text).not.toContain(w.alex.profile.id);
    expect(text).not.toContain(w.alex.user.id);
    expect(text).not.toContain(w.service.id);
  });

  it("rejects an id that is not a UUID with 422", async () => {
    const w = await world();

    expectApiError(await w.client.get(`${REQUESTS}/123`, { cookie: w.alexCookie }), {
      status: 422,
      code: ErrorCode.VALIDATION_ERROR,
    });
  });
});

describe("notifications, history and email (G.6, BR-22)", () => {
  it("notifies every active admin that a request was received, with a link to it", async () => {
    const w = await world();
    const inactive = await createAdmin(prisma, {
      email: "retired.admin@demo.fixflow.test",
      isActive: false,
    });

    const created = requestOf(await submit(w, validBody(w)));

    const notifications = await prisma.notification.findMany();
    expect(notifications.map((n) => n.recipientUserId).sort()).toEqual(
      [w.admin.id, w.secondAdmin.id].sort(),
    );
    expect(notifications.map((n) => n.recipientUserId)).not.toContain(inactive.id);
    for (const notification of notifications) {
      expect(notification).toMatchObject({
        type: "REQUEST_RECEIVED",
        title: `New request ${created.reference}`,
        message: "Alex Morgan asked for AC Repair. It is waiting for review.",
        linkPath: `/app/requests/${created.id}`,
        entityType: "SERVICE_REQUEST",
        entityId: created.id,
        readAt: null,
      });
    }
  });

  it("does not notify the customer in the app (D-38: they get the confirmation email)", async () => {
    const w = await world();

    await submit(w, validBody(w));

    expect(await prisma.notification.count({ where: { recipientUserId: w.alex.user.id } })).toBe(0);
  });

  it("puts nothing a customer typed into a notification", async () => {
    const w = await world();

    await submit(w, validBody(w));

    const text = JSON.stringify(await prisma.notification.findMany());
    expect(text).not.toContain(DESCRIPTION);
    expect(text).not.toContain(STREET);
    expect(text).not.toContain(ACCESS_NOTES);
  });

  it("records one activity event: staff text, the customer's own line, and only safe metadata", async () => {
    const w = await world();

    const created = requestOf(await submit(w, validBody(w)));

    const events = await prisma.activityEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: w.alex.user.id,
      entityType: "SERVICE_REQUEST",
      entityId: created.id,
      requestId: created.id,
      customerId: w.alex.profile.id,
      action: "request.submitted",
      fromStatus: null,
      toStatus: "SUBMITTED",
      summary: `Alex Morgan submitted request ${created.reference} for AC Repair.`,
      publicSummary: "You submitted your request.",
      metadata: {
        requestReference: created.reference,
        preferredDate: AFTER_DST,
        preferredWindow: "MORNING",
      },
    });
    const text = JSON.stringify(events);
    expect(text).not.toContain(DESCRIPTION);
    expect(text).not.toContain(STREET);
  });

  it("sends a confirmation to the customer and an alert to the business, and logs both as LOGGED", async () => {
    const w = await world();

    const created = requestOf(
      await submit(w, validBody(w, { preferredDate: BEFORE_DST, preferredWindow: "AFTERNOON" })),
    );
    await w.deps.emailDispatcher.idle();

    const logs = await prisma.emailDeliveryLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs.map((log) => [log.template, log.status, log.transport])).toEqual([
      ["request-received-customer", "LOGGED", "log"],
      ["request-received-admin", "LOGGED", "log"],
    ]);

    const customerEmail = w.emails.sent.find((email) => email.to === ALEX);
    expect(customerEmail?.subject).toBe(`We received your request ${created.reference}`);
    expect(customerEmail?.text).toContain(created.reference);
    expect(customerEmail?.text).toContain("AC Repair");
    // The preferred window, in the business time zone: 12:00-16:00 on 4 March, EST.
    expect(customerEmail?.text).toContain("Wed, Mar 4, 2026, 12:00 – 4:00 PM EST");
    expect(customerEmail?.text).toContain("What happens next");
    expect(customerEmail?.text).toContain(
      `${w.deps.config.email.publicWebUrl}/portal/requests/${created.id}`,
    );

    const businessEmail = w.emails.sent.find((email) => email.to === "hello@coolbreeze.test");
    expect(businessEmail?.subject).toBe(`New request ${created.reference}: AC Repair`);
    expect(businessEmail?.text).toContain("Alex Morgan");
    expect(businessEmail?.text).toContain(
      `${w.deps.config.email.publicWebUrl}/app/requests/${created.id}`,
    );
  });

  it("keeps the description and the address out of both emails", async () => {
    const w = await world();

    await submit(w, validBody(w));
    await w.deps.emailDispatcher.idle();

    expect(w.emails.sent).toHaveLength(2);
    for (const email of w.emails.sent) {
      for (const secret of [DESCRIPTION, STREET, ACCESS_NOTES]) {
        expect(email.text).not.toContain(secret);
        expect(email.html).not.toContain(secret);
      }
    }
  });

  it("escapes a customer's name in the emails", async () => {
    const w = await world();
    await prisma.user.update({
      where: { id: w.alex.user.id },
      data: { name: "<script>alert(1)</script> Alex" },
    });

    await submit(w, validBody(w));
    await w.deps.emailDispatcher.idle();

    for (const email of w.emails.sent) {
      expect(email.html).not.toContain("<script>");
      expect(email.html).toContain("&lt;script&gt;");
    }
  });

  it("still succeeds, and records FAILED, when the mail server is down", async () => {
    const w = await world();
    w.emails.failWith = Object.assign(new Error("connect ECONNREFUSED smtp.internal:587"), {
      code: "ECONNECTION",
    });

    const response = await submit(w, validBody(w));
    await w.deps.emailDispatcher.idle();

    expect(response.status).toBe(201);
    expect(await prisma.serviceRequest.count()).toBe(1);
    const statuses = (await prisma.emailDeliveryLog.findMany()).map((log) => log.status);
    expect(statuses).toEqual(["FAILED", "FAILED"]);
  });

  it("sends nothing for a submission that was rejected", async () => {
    const w = await world();

    await submit(w, validBody(w, { description: "short" }));
    await w.deps.emailDispatcher.idle();

    expect(w.emails.sent).toHaveLength(0);
    expect(await prisma.emailDeliveryLog.count()).toBe(0);
  });
});

describe("logs hold neither the description nor the address", () => {
  it("stays clean over a success, a rejection, a duplicate and a database failure", async () => {
    const w = await world({ logLevel: "info" });
    const body = validBody(w);

    await submit(w, body);
    await submit(w, body); // a duplicate
    await submit(w, validBody(w, { preferredDate: "2020-01-01" })); // rejected
    await createServiceRequest(prisma, {
      customerId: w.priya.profile.id,
      serviceId: w.service.id,
      reference: "FF-2026-00002",
    });
    // The next reference, FF-2026-00002, is taken: a real database failure after the address insert.
    await submit(w, newAddressBody(w, { saveAddressToProfile: true }));
    await w.deps.emailDispatcher.idle();

    const text = w.logs.text();
    expect(text.length).toBeGreaterThan(0);
    for (const secret of [
      DESCRIPTION,
      "rattles loudly",
      STREET,
      "Larkspur",
      ACCESS_NOTES,
      "Gate code",
      "Millrace",
      "Ring twice",
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("rate limit: 10 submissions an hour per customer (D-12)", () => {
  it("is ten per hour by default", () => {
    expect(RATE_LIMITS.requestSubmit).toEqual({ limit: 10, windowSeconds: 3600 });
  });

  it("answers the eleventh submission 429 with Retry-After and creates no eleventh request", async () => {
    const w = await world({ rateLimits: { requestSubmit: { limit: 10, windowSeconds: 3600 } } });

    for (let index = 0; index < 10; index += 1) {
      expect((await submit(w, validBody(w))).status).toBe(201);
    }
    const eleventh = await submit(w, validBody(w));

    expectApiError(eleventh, { status: 429, code: ErrorCode.RATE_LIMITED });
    expect(Number(eleventh.headers["retry-after"])).toBeGreaterThan(0);
    expect(await prisma.serviceRequest.count()).toBe(10);
  });

  it("counts per customer, and does not limit reading", async () => {
    const w = await world({ rateLimits: { requestSubmit: { limit: 1, windowSeconds: 3600 } } });
    await submit(w, validBody(w));

    const secondForAlex = await submit(w, validBody(w));
    const firstForPriya = await submit(
      w,
      validBody(w, { serviceAddressId: w.priyaAddress.id }),
      w.priyaCookie,
    );
    const read = await w.client.get(MINE, { cookie: w.alexCookie });

    expect(secondForAlex.status).toBe(429);
    expect(firstForPriya.status).toBe(201);
    expect(read.status).toBe(200);
  });

  it("opens again when the hour has passed", async () => {
    const w = await world({ rateLimits: { requestSubmit: { limit: 1, windowSeconds: 3600 } } });
    await submit(w, validBody(w));
    expect((await submit(w, validBody(w))).status).toBe(429);

    w.clock.advanceSeconds(3601);

    expect((await submit(w, validBody(w))).status).toBe(201);
  });
});
