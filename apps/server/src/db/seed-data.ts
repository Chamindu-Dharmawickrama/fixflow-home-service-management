import type { Prisma } from "../generated/prisma/client.js";

/**
 * The base demo data (spec §19, D-09, D-47). Everything here is fictional: reserved `.test` email
 * domains, phone numbers in the 555-01xx range that is set aside for fiction, and invented street
 * addresses. No password appears in this file; the demo passwords come from the environment.
 */

/** `BusinessSettings` for the demo business (D-47). */
export const DEMO_SETTINGS = {
  businessName: "CoolBreeze Home Services",
  tagline: "Home comfort and repairs, done properly the first time.",
  contactEmail: "hello@coolbreeze.test",
  phone: "(212) 555-0142",
  addressLine1: "48 Harbor Point Road",
  addressLine2: "Unit 3",
  city: "Harbor City",
  region: "NY",
  postalCode: "10999",
  serviceAreaDescription:
    "Harbor City and the neighbouring towns within about 25 miles. Not sure we cover your street? Send a request and we will confirm.",
  currencyCode: "USD",
  timeZone: "America/New_York",
  defaultTaxRate: "8.00",
  quotationValidityDays: 14,
  invoiceDueDays: 14,
  defaultQuotationTerms:
    "Prices are based on the information in your request and are valid until the date shown. Any extra work found on site is quoted and agreed with you before it starts. Workmanship is guaranteed for 30 days.",
  invoiceFooter:
    "Thank you for choosing CoolBreeze Home Services. Questions about this invoice? Email hello@coolbreeze.test or call (212) 555-0142.",
  paymentInstructions:
    "Pay by bank transfer, cheque or in person at our office, quoting the invoice number as your payment reference. We never ask for card details by phone or email. Bank details are provided on request.",
} as const satisfies Omit<Prisma.BusinessSettingsUncheckedCreateInput, "id">;

/**
 * The demo business's logo: one of the bundled marks (D-30, `BUNDLED_LOGOS`). Kept apart from
 * {@link DEMO_SETTINGS} so the test fixtures, which spread that object, start without a logo.
 */
export const DEMO_LOGO_KEY = "breeze";

/** The five services of spec §19.1, in display order. Each uses one of the bundled pictures (D-30). */
export const DEMO_SERVICES: readonly Prisma.ServiceUncheckedCreateInput[] = [
  {
    name: "AC Diagnostic Visit",
    slug: "ac-diagnostic-visit",
    category: "Air conditioning",
    shortDescription:
      "A technician finds out why your air conditioner is warm, noisy or leaking, and quotes the repair.",
    fullDescription:
      "Book this when your air conditioner is not cooling properly, makes unusual noises, leaks water or keeps switching itself off. A CoolBreeze technician inspects the indoor and outdoor units, the thermostat and the electrical connections, explains what is wrong in plain language and sends you a written quotation for any repair. Nothing is repaired until you approve the quotation.",
    inclusions: [
      "On-site inspection of the indoor and outdoor units",
      "Refrigerant pressure and airflow checks",
      "Thermostat and electrical connection check",
      "A written explanation of the fault and a repair quotation",
    ],
    estimatedDurationMinutes: 60,
    pricingMode: "QUOTE_REQUIRED",
    startingPrice: null,
    isPublished: true,
    imageKey: "air-conditioning",
    sortOrder: 10,
  },
  {
    name: "AC Routine Maintenance",
    slug: "ac-routine-maintenance",
    category: "Air conditioning",
    shortDescription:
      "A yearly service that keeps your air conditioner efficient and helps prevent summer breakdowns.",
    fullDescription:
      "A thorough service for split and ducted air conditioners, best booked in spring before the hot weather arrives. The technician cleans the filters, coils and drain line, checks the refrigerant level and electrical connections, and tests the unit through a full cooling cycle. The starting price covers one indoor unit; extra units, heavy cleaning or repairs are quoted before any work begins.",
    inclusions: [
      "Filter, coil and drain line cleaning",
      "Refrigerant level and pressure check",
      "Electrical connection and thermostat test",
      "Full cooling-cycle test and a short service report",
    ],
    estimatedDurationMinutes: 90,
    pricingMode: "FIXED",
    startingPrice: "129.00",
    isPublished: true,
    imageKey: "air-conditioning",
    sortOrder: 20,
  },
  {
    name: "Washing Machine Repair",
    slug: "washing-machine-repair",
    category: "Appliance repair",
    shortDescription:
      "Fixes for washers that will not drain, spin, start or stop leaking, at your home.",
    fullDescription:
      "Front-loading and top-loading washing machines that will not drain, will not spin, leak, shake violently or fail to start. The technician diagnoses the fault at your home, explains the options and quotes the repair, including any parts. If a repair is not worth the cost, we will tell you so honestly.",
    inclusions: [
      "Diagnosis of the fault at your home",
      "A written quotation including parts and labour",
      "Repair on the same visit when the parts are on the van",
      "Testing a full wash cycle before we leave",
    ],
    estimatedDurationMinutes: 90,
    pricingMode: "QUOTE_REQUIRED",
    startingPrice: null,
    isPublished: true,
    imageKey: "appliance-repair",
    sortOrder: 30,
  },
  {
    name: "Electrical Safety Inspection",
    slug: "electrical-safety-inspection",
    category: "Electrical",
    shortDescription:
      "A visual and tested check of your home's wiring, sockets and consumer unit, with a written report.",
    fullDescription:
      "A careful inspection of the electrical installation in your home, ideal when you are buying or renting out a property, or if the house is more than ten years old. The electrician checks the consumer unit, earthing, sockets and switches, and tests circuits where it is safe to do so. You receive a written report that lists anything that needs attention, and a quotation for any remedial work.",
    inclusions: [
      "Visual inspection of the consumer unit, sockets and switches",
      "Earthing and circuit protection checks",
      "Insulation and continuity testing where it is safe to do so",
      "A written report with a priority list and a quotation for remedial work",
    ],
    estimatedDurationMinutes: 120,
    pricingMode: "QUOTE_REQUIRED",
    startingPrice: null,
    isPublished: true,
    imageKey: "electrical",
    sortOrder: 40,
  },
  {
    name: "Home Deep Cleaning",
    slug: "home-deep-cleaning",
    category: "Cleaning",
    shortDescription:
      "A top-to-bottom clean of kitchens, bathrooms and living areas by a two-person crew.",
    fullDescription:
      "A thorough clean for a flat or small house: kitchen surfaces, oven and hob, bathrooms, floors, skirting boards, door frames and interior windows. The starting price covers a one- or two-bedroom home; larger homes, carpets and heavy build-up are quoted after you describe the space. We bring our own equipment and products; please tell us about any allergies in your request.",
    inclusions: [
      "Kitchen surfaces, oven and hob",
      "Bathrooms, tiles, taps and mirrors",
      "Floors, skirting boards and door frames",
      "Interior windows and sills",
    ],
    estimatedDurationMinutes: 240,
    pricingMode: "FIXED",
    startingPrice: "189.00",
    isPublished: true,
    imageKey: "cleaning",
    sortOrder: 50,
  },
];

/** Who may be assigned to jobs. They are resource records and cannot sign in. */
export const DEMO_TECHNICIANS: readonly Prisma.TechnicianUncheckedCreateInput[] = [
  {
    name: "Jordan Lee",
    phone: "(212) 555-0151",
    email: "jordan.lee@coolbreeze.test",
    specialties: ["Air conditioning", "Heat pumps", "Diagnostics"],
    notes: "Senior technician. Takes the diagnostic visits first thing in the morning.",
    calendarColor: "blue",
  },
  {
    name: "Sam Okafor",
    phone: "(212) 555-0162",
    email: "sam.okafor@coolbreeze.test",
    specialties: ["Washing machines", "Dryers", "Electrical safety"],
    notes: "Carries the common washing machine parts on the van.",
    calendarColor: "green",
  },
  {
    name: "Taylor Brooks",
    phone: "(212) 555-0173",
    email: "taylor.brooks@coolbreeze.test",
    specialties: ["Deep cleaning", "Move-out cleaning"],
    notes: "Leads the two-person cleaning crew.",
    calendarColor: "amber",
  },
];

export interface DemoAccount {
  email: string;
  name: string;
  /** Which environment variable holds this account's password. */
  passwordVariable: "DEMO_ADMIN_PASSWORD" | "DEMO_CUSTOMER_PASSWORD";
  role: "BUSINESS_ADMIN" | "CUSTOMER";
  /** Customers only. */
  phone?: string;
  address?: {
    label: string;
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postalCode: string;
    accessNotes?: string;
  };
}

/** The documented demo accounts (D-09). Ordinary local-password users; there is no login bypass. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: "admin@demo.fixflow.test",
    name: "Morgan Reyes",
    passwordVariable: "DEMO_ADMIN_PASSWORD",
    role: "BUSINESS_ADMIN",
  },
  {
    email: "alex.morgan@example.test",
    name: "Alex Morgan",
    passwordVariable: "DEMO_CUSTOMER_PASSWORD",
    role: "CUSTOMER",
    phone: "(212) 555-0171",
    address: {
      label: "Home",
      line1: "214 Larkspur Lane",
      line2: "Apt 2B",
      city: "Harbor City",
      region: "NY",
      postalCode: "10999",
      accessNotes: "Buzz apartment 2B. There is a friendly dog in the flat.",
    },
  },
  {
    email: "priya.shah@example.test",
    name: "Priya Shah",
    passwordVariable: "DEMO_CUSTOMER_PASSWORD",
    role: "CUSTOMER",
    phone: "(212) 555-0188",
    address: {
      label: "Home",
      line1: "73 Millrace Court",
      city: "Harbor City",
      region: "NY",
      postalCode: "10998",
      accessNotes: "Side gate is latched but not locked. Please call on arrival.",
    },
  },
];
