import type { Moment } from "./showcase-time.js";

/**
 * The showcase cast and stories (T24, spec §19.3). Everything here is fictional: reserved `.test`
 * email domains, phone numbers in the 555-01xx range that is set aside for fiction, invented streets
 * and no real person or business. No password appears in this file.
 *
 * Every date is a {@link Moment}: a number of days from the day the seed runs and a time on the
 * business's clock, so the demo always looks current. The stories are plain data; `showcase.ts` turns
 * each into calls on the same services the application uses, in time order.
 */

export interface ShowcaseAddress {
  label: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  accessNotes?: string;
}

export interface ShowcaseCustomer {
  key: string;
  name: string;
  email: string;
  phone: string;
  /** When the account was opened. */
  joined: Moment;
  addresses: readonly ShowcaseAddress[];
}

/** The two seeded demo customers keep their base-seed account and first address; these are added to them. */
export const DEMO_CUSTOMER_EXTRAS: Readonly<
  Record<string, { joined: Moment; addresses: readonly ShowcaseAddress[] }>
> = {
  alex: {
    joined: [-62, "10:20"],
    addresses: [
      {
        label: "Mum's flat",
        line1: "9 Orchard Row",
        line2: "Flat 1",
        city: "Harbor City",
        region: "NY",
        postalCode: "10997",
        accessNotes: "Ground floor. Mum, Rosa, will let you in; please ring the bell twice.",
      },
    ],
  },
  priya: {
    joined: [-58, "14:05"],
    addresses: [
      {
        label: "Rental flat",
        line1: "12 Quarry Steps",
        line2: "Unit 4",
        city: "Harbor City",
        region: "NY",
        postalCode: "10996",
        accessNotes: "Key safe by the front door; the code is sent when a visit is booked.",
      },
    ],
  },
};

/** The six customers that exist only in the showcase. They cannot sign in (see `showcase.ts`). */
export const SHOWCASE_CUSTOMERS: readonly ShowcaseCustomer[] = [
  {
    key: "marcus",
    name: "Marcus Webb",
    email: "marcus.webb@example.test",
    phone: "(212) 555-0104",
    joined: [-55, "09:40"],
    addresses: [
      {
        label: "Home",
        line1: "31 Heron Street",
        city: "Harbor City",
        region: "NY",
        postalCode: "10995",
        accessNotes: "Park on the street. Side door is the one with the green mat.",
      },
      {
        label: "Rental flat",
        line1: "6 Mill Lane",
        line2: "Flat 3",
        city: "Harbor City",
        region: "NY",
        postalCode: "10994",
      },
    ],
  },
  {
    key: "elena",
    name: "Elena Rossi",
    email: "elena.rossi@example.test",
    phone: "(212) 555-0119",
    joined: [-52, "16:10"],
    addresses: [
      {
        label: "Home",
        line1: "88 Bellflower Avenue",
        city: "Harbor City",
        region: "NY",
        postalCode: "10993",
      },
      {
        label: "Studio",
        line1: "5 Canal Walk",
        city: "Harbor City",
        region: "NY",
        postalCode: "10992",
        accessNotes: "Studio is on the first floor, entrance through the courtyard.",
      },
    ],
  },
  {
    key: "tomas",
    name: "Tomás Herrera",
    email: "tomas.herrera@example.test",
    phone: "(212) 555-0126",
    joined: [-36, "11:25"],
    addresses: [
      {
        label: "Flat",
        line1: "402 Cedar Court",
        line2: "Unit 7",
        city: "Harbor City",
        region: "NY",
        postalCode: "10991",
        accessNotes: "Call on arrival: the entry-phone does not always work.",
      },
    ],
  },
  {
    key: "aisha",
    name: "Aisha Khan",
    email: "aisha.khan@example.test",
    phone: "(212) 555-0133",
    joined: [-33, "08:55"],
    addresses: [
      {
        label: "Home",
        line1: "17 Wren Lane",
        city: "Harbor City",
        region: "NY",
        postalCode: "10990",
        accessNotes: "Dog (friendly, called Biscuit). Please close the garden gate.",
      },
    ],
  },
  {
    key: "ben",
    name: "Ben Carter",
    email: "ben.carter@example.test",
    phone: "(212) 555-0147",
    joined: [-28, "13:30"],
    addresses: [
      {
        label: "Home",
        line1: "260 Foundry Road",
        city: "Harbor City",
        region: "NY",
        postalCode: "10989",
      },
      {
        label: "Rental A",
        line1: "14 Saltmarsh Close",
        line2: "Flat 2",
        city: "Harbor City",
        region: "NY",
        postalCode: "10988",
      },
      {
        label: "Rental B",
        line1: "14 Saltmarsh Close",
        line2: "Flat 5",
        city: "Harbor City",
        region: "NY",
        postalCode: "10988",
      },
    ],
  },
  {
    key: "hannah",
    name: "Hannah Kim",
    email: "hannah.kim@example.test",
    phone: "(212) 555-0152",
    joined: [-24, "17:45"],
    addresses: [
      {
        label: "Flat",
        line1: "55 Linden Terrace",
        line2: "Apt 9",
        city: "Harbor City",
        region: "NY",
        postalCode: "10987",
        accessNotes: "Lift is out of order most weekends; the flat is on the third floor.",
      },
    ],
  },
];

/** The fourth technician (the base seed has three). */
export const SHOWCASE_TECHNICIAN = {
  name: "Casey Nguyen",
  phone: "(212) 555-0184",
  email: "casey.nguyen@coolbreeze.test",
  specialties: ["Electrical safety", "Appliance repair", "Fault finding"],
  notes: "Qualified electrician. Writes the inspection reports.",
  calendarColor: "purple",
} as const;

/** Technician keys used by the stories → the names of the technicians. */
export const TECHNICIAN_NAMES = {
  jordan: "Jordan Lee",
  sam: "Sam Okafor",
  taylor: "Taylor Brooks",
  casey: "Casey Nguyen",
} as const;
export type TechnicianKey = keyof typeof TECHNICIAN_NAMES;

export interface Line {
  description: string;
  quantity: string;
  unitPrice: string;
  taxable: boolean;
}

const line = (description: string, unitPrice: string, taxable: boolean, quantity = "1"): Line => ({
  description,
  quantity,
  unitPrice,
  taxable,
});

export type Visit =
  | { start: Moment; end: Moment }
  /** The `n`th day after today that is not a Sunday. */
  | { workday: number; from: string; to: string }
  /** Today: the visit that is in progress now. */
  | "TODAY";

export interface PaymentPlan {
  at: Moment;
  /** A decimal string, or `REMAINDER` for whatever is still owed. */
  amount: string;
  method: "CASH" | "BANK_TRANSFER" | "CARD_TERMINAL" | "CHEQUE" | "OTHER";
  reference?: string;
  notes?: string;
}

export interface InvoicePlan {
  draft: Moment;
  /** Lines added to the ones copied from the quotation (extra parts or labour, C-11). */
  extraLines?: readonly Line[];
  customerNote?: string;
  /** Left out for an invoice that stays a draft. */
  issue?: Moment;
  void?: { at: Moment; reason: string };
  payments?: readonly PaymentPlan[];
}

export interface Plan {
  /** A label for the story, used in error messages. */
  label: string;
  customer: string;
  /** Which of the customer's addresses, in the order they are listed. */
  address: number;
  service: string;
  description: string;
  window: "MORNING" | "AFTERNOON" | "EVENING";
  /** The day asked for, as days from the day of submission. Defaults to the visit day, else 3. */
  preferredAfterDays?: number;
  submitted: Moment;
  review?: Moment;
  notes?: readonly { at: Moment; body: string; visibility: "INTERNAL" | "CUSTOMER_VISIBLE" }[];
  quote?: {
    sent: Moment;
    lines: readonly Line[];
    discount?: string;
    customerNote?: string;
    /** A second quotation that replaces this one while it is still waiting (the first is voided). */
    replacement?: { sent: Moment; extraLines: readonly Line[]; customerNote?: string };
    /** The quotation lapses unanswered; the request goes back under review, and a new draft is started. */
    expires?: { draft: Moment; lines: readonly Line[] };
  };
  decision?: { at: Moment; kind: "accept" | "decline"; reason?: string };
  convert?: Moment;
  schedule?: { at: Moment; technician: TechnicianKey; visit: Visit };
  /** Starts the job (at the visit's start, or `now` for the one in progress). */
  started?: boolean;
  completed?: { note: string; internalNote?: string };
  needsRescheduling?: { at: Moment; reason: string; message?: string };
  cancelJob?: { at: Moment; reason: string; message?: string };
  invoice?: InvoicePlan;
  cancelRequest?: { at: Moment; reason: string; message?: string };
}

/**
 * The twenty requests. Thirteen became jobs (every job status appears, and every live invoice status
 * has its own completed job), and seven did not (every request status appears). Counted:
 * 20 requests, 19 quotations, 13 jobs, 6 invoices, 5 payments (see `showcase-volumes.ts`).
 */
export const PLANS: readonly Plan[] = [
  // ---- Completed jobs, one for each way an invoice can stand --------------------------------------
  {
    label: "R1 Priya, AC maintenance, invoice PAID",
    customer: "priya",
    address: 0,
    service: "ac-routine-maintenance",
    description:
      "Annual service for the split AC in our living room and the second unit in the bedroom. Last serviced about 14 months ago and the filters are visibly dusty. Both units work fine, we just want them ready for summer.",
    window: "MORNING",
    submitted: [-44, "09:12"],
    review: [-44, "10:05"],
    quote: {
      sent: [-43, "11:20"],
      lines: [
        line("AC routine maintenance: split system, indoor unit 1", "129.00", true),
        line("Second indoor unit service", "79.00", true),
      ],
      customerNote: "Both units can be done in one visit; allow about two hours.",
    },
    decision: { at: [-42, "19:02"], kind: "accept" },
    convert: [-41, "09:00"],
    schedule: {
      at: [-41, "09:20"],
      technician: "jordan",
      visit: { start: [-38, "10:00"], end: [-38, "12:00"] },
    },
    started: true,
    completed: {
      note: "Cleaned filters, indoor coils and drain lines on both units and tested a full cooling cycle on each. Both cool well (about an 11 degree drop at the vents). We suggest another service in 12 months.",
      internalNote: "Bedroom unit drain was slightly slow; cleared. Remind customer next spring.",
    },
    invoice: {
      draft: [-37, "09:30"],
      issue: [-37, "09:45"],
      payments: [
        {
          at: [-35, "14:10"],
          amount: "150.00",
          method: "BANK_TRANSFER",
          reference: "TRF-20714",
          notes: "First instalment, as agreed on the phone.",
        },
        { at: [-29, "11:00"], amount: "REMAINDER", method: "CASH", notes: "Paid at the office." },
      ],
    },
  },
  {
    label: "R3 Elena, electrical inspection, invoice OVERDUE",
    customer: "elena",
    address: 0,
    service: "electrical-safety-inspection",
    description:
      "We are buying the house next month and the survey recommended an electrical check. Three bedrooms, original consumer unit from the 1990s, a few older sockets in the kitchen. Please include a written report for our solicitor.",
    window: "MORNING",
    submitted: [-40, "15:30"],
    review: [-40, "16:10"],
    quote: {
      sent: [-39, "09:40"],
      lines: [
        line("Electrical safety inspection: three-bedroom house", "245.00", true),
        line("Written condition report", "40.00", true),
      ],
      discount: "20.00",
      customerNote: "A new-customer discount has been applied.",
    },
    decision: { at: [-38, "12:15"], kind: "accept" },
    convert: [-37, "14:00"],
    schedule: {
      at: [-37, "14:20"],
      technician: "casey",
      visit: { start: [-34, "09:00"], end: [-34, "11:30"] },
    },
    started: true,
    completed: {
      note: "Inspected the consumer unit, every circuit and 28 outlets. The written report is on its way: two minor observations (an old kitchen socket and unlabelled circuits) and no urgent hazards.",
      internalNote:
        "Kitchen socket near the sink should be replaced; offered a quote, customer will think.",
    },
    invoice: { draft: [-33, "09:10"], issue: [-33, "09:25"] },
  },
  {
    label: "R2 Marcus, washing machine, invoice PARTIALLY_PAID",
    customer: "marcus",
    address: 0,
    service: "washing-machine-repair",
    description:
      "Front-loading washing machine (about 6 years old) stopped draining mid-cycle. It shows a drain error on the display and there is water left in the drum. I cleared the filter at the front but it did not help.",
    window: "AFTERNOON",
    submitted: [-24, "18:15"],
    review: [-23, "08:50"],
    quote: {
      sent: [-23, "10:30"],
      lines: [
        line("Diagnosis and call-out", "65.00", false),
        line("Drain pump (replacement part)", "54.50", true),
        line("Labour: pump replacement (45 minutes)", "70.00", false),
      ],
    },
    decision: { at: [-22, "20:10"], kind: "accept" },
    convert: [-21, "09:10"],
    schedule: {
      at: [-21, "09:30"],
      technician: "sam",
      visit: { start: [-17, "13:00"], end: [-17, "14:30"] },
    },
    started: true,
    completed: {
      note: "Replaced the blocked drain pump and removed a sock from the filter housing. Ran a full wash and spin cycle with no leaks. The old pump has been taken away.",
    },
    invoice: {
      draft: [-11, "10:00"],
      issue: [-11, "10:15"],
      payments: [
        {
          at: [-6, "15:20"],
          amount: "100.00",
          method: "BANK_TRANSFER",
          reference: "TRF-31877",
          notes: "Part payment; balance to follow.",
        },
      ],
    },
  },
  {
    label: "R4 Alex, AC diagnostic, invoice ISSUED",
    customer: "alex",
    address: 0,
    service: "ac-diagnostic-visit",
    description:
      "Upstairs AC unit runs but blows warm air since the weekend; outdoor fan isn't spinning. The downstairs unit is fine. There is a humming noise from the outdoor box when it tries to start.",
    window: "MORNING",
    submitted: [-12, "20:40"],
    review: [-11, "08:45"],
    notes: [
      {
        at: [-11, "09:05"],
        body: "Rang Alex: the outdoor fan hums but does not turn. Probably the fan capacitor; Jordan to bring a spare.",
        visibility: "INTERNAL",
      },
    ],
    quote: {
      sent: [-11, "11:10"],
      lines: [
        line("AC diagnostic visit (1 hour)", "89.00", false),
        line("Outdoor fan motor capacitor", "38.00", true),
        line("Labour: capacitor replacement", "45.00", false),
      ],
      customerNote:
        "If the fault is not the capacitor we will stop and quote again before going on.",
    },
    decision: { at: [-10, "18:25"], kind: "accept" },
    convert: [-9, "09:15"],
    schedule: {
      at: [-9, "09:35"],
      technician: "jordan",
      visit: { start: [-6, "09:00"], end: [-6, "10:15"] },
    },
    started: true,
    completed: {
      note: "Replaced the faulty outdoor fan motor capacitor. The fan now spins freely and the upstairs unit blows cold air again (14 degrees at the vent after ten minutes).",
      internalNote: "Spare capacitor used. Coil is dirty: suggested the maintenance visit.",
    },
    invoice: {
      draft: [-5, "09:30"],
      extraLines: [line("Outdoor coil rinse", "25.00", false)],
      customerNote: "Thank you, Alex. We added a coil rinse while we were on the roof.",
      issue: [-5, "09:50"],
    },
  },
  {
    label: "R5 Tomás, deep cleaning, completed, invoice voided (awaiting a new one)",
    customer: "tomas",
    address: 0,
    service: "home-deep-cleaning",
    description:
      "Move-out clean for a two-bedroom flat before the landlord's inspection on Friday. The oven and hob are the main concern, plus the bathroom tiles. No pets. Parking is available outside the building.",
    window: "MORNING",
    submitted: [-16, "13:05"],
    review: [-16, "14:20"],
    quote: {
      sent: [-15, "09:15"],
      lines: [
        line("Home deep clean: two-bedroom flat, two-person crew", "189.00", true),
        line("Inside oven and hob, extra clean", "35.00", true),
      ],
    },
    decision: { at: [-14, "10:45"], kind: "accept" },
    convert: [-13, "08:55"],
    schedule: {
      at: [-13, "09:10"],
      technician: "taylor",
      visit: { start: [-9, "09:00"], end: [-9, "13:00"] },
    },
    started: true,
    completed: {
      note: "The two-person crew cleaned the flat from top to bottom: kitchen including oven and hob, both bathrooms, floors, skirting boards and interior windows.",
    },
    invoice: {
      draft: [-8, "10:00"],
      issue: [-8, "10:10"],
      void: {
        at: [-7, "09:20"],
        reason:
          "Issued to the old address on the tenancy. The customer asked for it to be corrected and reissued.",
      },
    },
  },
  {
    label: "R6 Aisha, AC maintenance, completed, invoice still a DRAFT",
    customer: "aisha",
    address: 0,
    service: "ac-routine-maintenance",
    description:
      "Routine service for the split AC in the home office. It has started to smell musty when it first switches on, and the airflow feels weaker than it did last year.",
    window: "AFTERNOON",
    submitted: [-9, "10:35"],
    review: [-9, "11:30"],
    quote: {
      sent: [-8, "09:50"],
      lines: [line("AC routine maintenance: split system, indoor unit 1", "129.00", true)],
    },
    decision: { at: [-7, "08:20"], kind: "accept" },
    convert: [-7, "09:40"],
    schedule: {
      at: [-7, "09:55"],
      technician: "jordan",
      visit: { start: [-4, "14:00"], end: [-4, "15:30"] },
    },
    started: true,
    completed: {
      note: "Serviced the indoor unit, replaced the air filter and flushed the drain line. The musty smell is gone and airflow is back to normal.",
    },
    invoice: {
      draft: [-3, "09:00"],
      extraLines: [line("Replacement air filter", "18.00", true)],
    },
  },

  // ---- Jobs in progress, booked, waiting, in trouble or cancelled -----------------------------------
  {
    label: "R7 Ben, AC diagnostic, job IN_PROGRESS today",
    customer: "ben",
    address: 0,
    service: "ac-diagnostic-visit",
    description:
      "Bedroom AC cools slowly and ices up on the pipe near the indoor unit every few hours. Defrosting it makes it work again for a while. It was installed about four years ago.",
    window: "MORNING",
    submitted: [-5, "19:20"],
    review: [-4, "08:40"],
    quote: {
      sent: [-4, "10:20"],
      lines: [
        line("AC diagnostic visit (1 hour)", "89.00", false),
        line("Refrigerant top-up (R32), per kg", "120.00", true, "0.60"),
      ],
    },
    decision: { at: [-3, "12:30"], kind: "accept" },
    convert: [-3, "14:05"],
    schedule: { at: [-2, "09:30"], technician: "jordan", visit: "TODAY" },
    started: true,
  },
  {
    label: "R8 Alex, AC maintenance, job SCHEDULED (Jordan): Alex has a visit to come",
    customer: "alex",
    address: 0,
    service: "ac-routine-maintenance",
    description:
      "Yearly maintenance for the downstairs AC unit, the one that still works. Please check the condensate pump as well; it gurgled loudly last summer.",
    window: "AFTERNOON",
    submitted: [-4, "16:45"],
    review: [-3, "08:55"],
    quote: {
      sent: [-3, "11:15"],
      lines: [
        line("AC routine maintenance: split system, indoor unit 1", "129.00", true),
        line("Condensate pump clean and check", "25.00", false),
      ],
    },
    decision: { at: [-2, "09:05"], kind: "accept" },
    convert: [-2, "10:10"],
    schedule: {
      at: [-2, "10:30"],
      technician: "jordan",
      visit: { workday: 2, from: "09:00", to: "10:30" },
    },
  },
  {
    label: "R9 Marcus, electrical inspection, job SCHEDULED (Casey), first of a back-to-back pair",
    customer: "marcus",
    address: 1,
    service: "electrical-safety-inspection",
    description:
      "Safety inspection for my rental flat before the new tenants move in. Two bedrooms, and the consumer unit was replaced in 2016. I need the report for the letting agent.",
    window: "MORNING",
    submitted: [-6, "12:10"],
    review: [-5, "09:00"],
    quote: {
      sent: [-5, "10:40"],
      lines: [
        line("Electrical safety inspection: two-bedroom flat", "195.00", true),
        line("Written condition report", "30.00", true),
      ],
    },
    decision: { at: [-4, "17:35"], kind: "accept" },
    convert: [-4, "18:20"],
    schedule: {
      at: [-1, "09:15"],
      technician: "casey",
      visit: { workday: 1, from: "10:00", to: "12:00" },
    },
  },
  {
    label: "R10 Elena, washing machine, job SCHEDULED (Casey), straight after R9",
    customer: "elena",
    address: 1,
    service: "washing-machine-repair",
    description:
      "My front-loading washer leaks a little water around the door at the end of every wash and leaves a small puddle on the floor. The rubber seal looks cracked at the bottom.",
    window: "AFTERNOON",
    submitted: [-3, "09:25"],
    review: [-3, "10:15"],
    quote: {
      sent: [-3, "14:40"],
      lines: [
        line("Diagnosis and call-out", "65.00", false),
        line("Door seal (replacement part)", "72.00", true),
        line("Labour: door seal replacement (1 hour)", "80.00", false),
      ],
    },
    decision: { at: [-2, "08:30"], kind: "accept" },
    convert: [-2, "09:35"],
    schedule: {
      at: [-1, "10:00"],
      technician: "casey",
      visit: { workday: 1, from: "12:00", to: "13:30" },
    },
  },
  {
    label: "R12 Priya, AC diagnostic, job PENDING_SCHEDULING",
    customer: "priya",
    address: 1,
    service: "ac-diagnostic-visit",
    description:
      "The AC in the rental flat keeps dripping water inside along the wall below the unit, and the room is not getting as cool as usual. It started during the heatwave last week.",
    window: "MORNING",
    preferredAfterDays: 5,
    submitted: [-4, "11:50"],
    review: [-4, "12:40"],
    quote: {
      sent: [-3, "09:30"],
      lines: [
        line("AC diagnostic visit (1 hour)", "89.00", false),
        line("Condensate drain unblock", "55.00", false),
      ],
    },
    decision: { at: [-2, "21:10"], kind: "accept" },
    convert: [-1, "08:45"],
  },
  {
    label: "R13 Tomás, washing machine, job NEEDS_RESCHEDULING",
    customer: "tomas",
    address: 0,
    service: "washing-machine-repair",
    description:
      "The washing machine fills very slowly and sometimes stops with an error about the water supply. The tap is fully open and the other taps in the flat have good pressure.",
    window: "MORNING",
    submitted: [-14, "09:45"],
    review: [-14, "10:50"],
    quote: {
      sent: [-13, "11:30"],
      lines: [
        line("Diagnosis and call-out", "65.00", false),
        line("Water inlet valve (replacement part)", "38.00", true),
        line("Labour: valve replacement", "60.00", false),
      ],
    },
    decision: { at: [-12, "13:15"], kind: "accept" },
    convert: [-12, "14:00"],
    schedule: {
      at: [-11, "09:40"],
      technician: "sam",
      visit: { start: [-2, "10:00"], end: [-2, "11:30"] },
    },
    needsRescheduling: {
      at: [-2, "11:40"],
      reason: "Nobody answered the door or the phone; rebook with the customer.",
      message:
        "We could not reach you for this morning's visit. Please choose a new time that suits you.",
    },
  },
  {
    label: "R14 Hannah, deep cleaning, job CANCELLED",
    customer: "hannah",
    address: 0,
    service: "home-deep-cleaning",
    description:
      "Deep clean for the flat, including inside the windows. We are hosting family over the holidays and want the kitchen and bathroom spotless before they arrive.",
    window: "MORNING",
    submitted: [-30, "17:10"],
    review: [-30, "17:50"],
    quote: {
      sent: [-29, "10:05"],
      lines: [
        line("Home deep clean: one-bedroom flat", "189.00", true),
        line("Interior windows", "30.00", true),
      ],
    },
    decision: { at: [-28, "09:00"], kind: "accept" },
    convert: [-27, "10:30"],
    schedule: {
      at: [-27, "10:45"],
      technician: "taylor",
      visit: { start: [-21, "09:00"], end: [-21, "13:00"] },
    },
    cancelJob: {
      at: [-22, "16:20"],
      reason: "The customer is travelling and asked to cancel. She will rebook in the new year.",
      message:
        "As you asked, we have cancelled this visit. Send a new request whenever you are ready.",
    },
  },

  // ---- Requests that have not become jobs ----------------------------------------------------------
  {
    label:
      "R15 Alex, electrical inspection, QUOTED (a first quotation replaced; the new one awaits an answer)",
    customer: "alex",
    address: 1,
    service: "electrical-safety-inspection",
    description:
      "My mum's flat needs an electrical safety check. Several sockets in the kitchen spark slightly when plugs go in, and the lights flicker when the kettle is on. She lives alone, so I would like this sorted soon.",
    window: "MORNING",
    submitted: [-5, "20:05"],
    review: [-4, "08:30"],
    notes: [
      {
        at: [-4, "08:45"],
        body: "Likely a loose neutral or an overloaded kitchen ring. Casey to look at the consumer unit first.",
        visibility: "INTERNAL",
      },
    ],
    quote: {
      sent: [-4, "11:45"],
      lines: [
        line("Electrical safety inspection: one-bedroom flat", "165.00", true),
        line("Written condition report", "30.00", true),
      ],
      replacement: {
        sent: [-2, "10:25"],
        extraLines: [line("Test of the six extra sockets in the garage", "40.00", true)],
        customerNote: "As we discussed on the phone, this now includes the garage sockets.",
      },
    },
  },
  {
    label: "R16 Aisha, washing machine, ACCEPTED (waiting to become a job)",
    customer: "aisha",
    address: 0,
    service: "washing-machine-repair",
    description:
      "The washer won't heat the water: the programme finishes but the clothes come out cold and smell of detergent. It is a seven-year-old machine.",
    window: "AFTERNOON",
    submitted: [-8, "12:20"],
    review: [-8, "13:30"],
    quote: {
      sent: [-7, "10:10"],
      lines: [
        line("Diagnosis and call-out", "65.00", false),
        line("Heating element (replacement part)", "49.00", true),
        line("Labour: heating element (1 hour)", "75.00", false),
      ],
      discount: "10.00",
      customerNote: "A returning-customer discount has been applied.",
    },
    decision: { at: [-1, "19:15"], kind: "accept" },
  },
  {
    label: "R17 Elena, AC maintenance, DECLINED",
    customer: "elena",
    address: 0,
    service: "ac-routine-maintenance",
    description:
      "Servicing for the two split units in the house (the living room and the main bedroom). They work, but we want them looked at before the hot weather arrives.",
    window: "MORNING",
    submitted: [-11, "14:30"],
    review: [-11, "15:40"],
    quote: {
      sent: [-10, "09:20"],
      lines: [
        line("AC routine maintenance: split system, indoor unit 1", "129.00", true),
        line("Second indoor unit service", "79.00", true),
      ],
    },
    decision: {
      at: [-8, "20:45"],
      kind: "decline",
      reason: "Thank you, but we have decided to wait until the spring and book it then.",
    },
  },
  {
    label:
      "R18 Hannah, AC diagnostic, UNDER_REVIEW (the first quotation expired; a new draft is started)",
    customer: "hannah",
    address: 0,
    service: "ac-diagnostic-visit",
    description:
      "The AC clicks, hums and then switches off after about a minute. This happens every time we start it. The indoor display shows an error code, E6.",
    window: "MORNING",
    submitted: [-27, "08:50"],
    review: [-27, "09:40"],
    quote: {
      sent: [-26, "10:15"],
      lines: [
        line("AC diagnostic visit (1 hour)", "89.00", false),
        line("Compressor start capacitor", "64.00", true),
        line("Labour: capacitor replacement", "55.00", false),
      ],
      expires: {
        draft: [-3, "15:10"],
        lines: [
          line("AC diagnostic visit (1 hour)", "89.00", false),
          line("Compressor start capacitor (revised price)", "59.00", true),
          line("Labour: capacitor replacement", "55.00", false),
        ],
      },
    },
    notes: [
      {
        at: [-3, "15:00"],
        body: "Customer rang to say the unit is still broken and asked for the quotation again. Starting a new draft.",
        visibility: "INTERNAL",
      },
    ],
  },
  {
    label: "R19 Marcus, deep cleaning, SUBMITTED today",
    customer: "marcus",
    address: 1,
    service: "home-deep-cleaning",
    description:
      "Deep clean for a two-bedroom flat after the builders finished: fine dust everywhere, marks on the kitchen cupboards and paint splashes on the window frames. Hoping for a visit early next week.",
    window: "MORNING",
    preferredAfterDays: 5,
    submitted: [0, "08:10"],
  },
  {
    label: "R20 Priya, electrical inspection, CANCELLED",
    customer: "priya",
    address: 1,
    service: "electrical-safety-inspection",
    description:
      "Safety check of the wiring and sockets in my rental flat before the next tenant moves in. Two bedrooms and a fairly new consumer unit. Please tell me the cost first.",
    window: "AFTERNOON",
    submitted: [-10, "21:15"],
    review: [-9, "08:40"],
    cancelRequest: {
      at: [-9, "09:30"],
      reason:
        "Duplicate: the customer sent the same request twice by mistake and asked us to cancel this one.",
      message:
        "We have cancelled this request because you sent it twice. Your other request is still open.",
    },
  },
  {
    label: "R21 Aisha, electrical inspection, SUBMITTED today",
    customer: "aisha",
    address: 0,
    service: "electrical-safety-inspection",
    description:
      "Several light switches in the house feel warm, and one makes a buzzing noise when the dimmer is on. I would like an electrician to check the wiring, ideally on a weekday morning.",
    window: "MORNING",
    preferredAfterDays: 4,
    submitted: [0, "08:25"],
  },
];
