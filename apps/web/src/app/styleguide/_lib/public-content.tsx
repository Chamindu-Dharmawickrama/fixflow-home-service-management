import type { LucideIcon } from "lucide-react";
import { ClipboardList, FileText, ReceiptText, Wind, Wrench } from "lucide-react";

/** Example public-site content for the shell demos: the fictional CoolBreeze Home Services. */

export interface ExampleService {
  slug: string;
  name: string;
  category: string;
  short: string;
  description: string;
  inclusions: readonly string[];
  durationMinutes: number;
  /** A decimal string for "From $X", or `null` for "Request a quote". */
  startingPrice: string | null;
}

export const EXAMPLE_SERVICES: readonly ExampleService[] = [
  {
    slug: "ac-diagnostic-visit",
    name: "AC Diagnostic Visit",
    category: "Air conditioning",
    short:
      "A technician finds out why your air conditioner is warm, noisy or leaking, and quotes the repair.",
    description:
      "Book this when your air conditioner is not cooling properly, makes unusual noises, leaks water or keeps switching itself off. A technician inspects the indoor and outdoor units, explains what is wrong in plain language and sends you a written quotation for any repair. Nothing is repaired until you approve the quotation.",
    inclusions: [
      "On-site inspection of the indoor and outdoor units",
      "Refrigerant pressure and airflow checks",
      "Thermostat and electrical connection check",
      "A written explanation of the fault and a repair quotation",
    ],
    durationMinutes: 60,
    startingPrice: null,
  },
  {
    slug: "ac-routine-maintenance",
    name: "AC Routine Maintenance",
    category: "Air conditioning",
    short:
      "A yearly service that keeps your air conditioner efficient and helps prevent summer breakdowns.",
    description:
      "A thorough service for split and ducted air conditioners, best booked in spring before the hot weather arrives. The technician cleans the filters, coils and drain line, checks the refrigerant level and electrical connections, and tests the unit through a full cooling cycle. The starting price covers one indoor unit; extra units, heavy cleaning or repairs are quoted before any work begins.",
    inclusions: [
      "Filter, coil and drain line cleaning",
      "Refrigerant level and pressure check",
      "Electrical connection and thermostat test",
      "Full cooling-cycle test and a short service report",
    ],
    durationMinutes: 90,
    startingPrice: "129.00",
  },
  {
    slug: "washing-machine-repair",
    name: "Washing Machine Repair",
    category: "Appliance repair",
    short: "Fixes for washers that will not drain, spin, start or stop leaking, at your home.",
    description:
      "Front-loading and top-loading washing machines that will not drain, will not spin, leak, shake violently or fail to start. The technician diagnoses the fault at your home, explains the options and quotes the repair, including any parts. If a repair is not worth the cost, we will tell you so honestly.",
    inclusions: [
      "Diagnosis of the fault at your home",
      "A written quotation including parts and labour",
      "Repair on the same visit when the parts are on the van",
      "Testing a full wash cycle before we leave",
    ],
    durationMinutes: 90,
    startingPrice: null,
  },
  {
    slug: "electrical-safety-inspection",
    name: "Electrical Safety Inspection",
    category: "Electrical",
    short:
      "A visual and tested check of your home's wiring, sockets and consumer unit, with a written report.",
    description:
      "A careful inspection of the electrical installation in your home, ideal when you are buying or renting out a property, or if the house is more than ten years old. You receive a written report that lists anything that needs attention, and a quotation for any remedial work.",
    inclusions: [
      "Visual inspection of the consumer unit, sockets and switches",
      "Earthing and circuit protection checks",
      "Insulation and continuity testing where it is safe to do so",
      "A written report with a priority list and a quotation for remedial work",
    ],
    durationMinutes: 120,
    startingPrice: null,
  },
  {
    slug: "home-deep-cleaning",
    name: "Home Deep Cleaning",
    category: "Cleaning",
    short: "A top-to-bottom clean of kitchens, bathrooms and living areas by a two-person crew.",
    description:
      "A thorough clean for a flat or small house: kitchen surfaces, oven and hob, bathrooms, floors, skirting boards, door frames and interior windows. The starting price covers a one- or two-bedroom home; larger homes, carpets and heavy build-up are quoted after you describe the space.",
    inclusions: [
      "Kitchen surfaces, oven and hob",
      "Bathrooms, tiles, taps and mirrors",
      "Floors, skirting boards and door frames",
      "Interior windows and sills",
    ],
    durationMinutes: 240,
    startingPrice: "189.00",
  },
];

export function findExampleService(slug: string): ExampleService | undefined {
  return EXAMPLE_SERVICES.find((service) => service.slug === slug);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minutes`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hoursText = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? `About ${hoursText}` : `About ${hoursText} ${rest} minutes`;
}

export interface ProcessStep {
  title: string;
  description: string;
  icon: LucideIcon;
}

export const PROCESS_STEPS: readonly ProcessStep[] = [
  {
    title: "Tell us what is wrong",
    description:
      "Choose a service, describe the problem and say when suits you. It takes a couple of minutes.",
    icon: ClipboardList,
  },
  {
    title: "Get a written quotation",
    description:
      "We review your request and send a clear, itemised quotation. You accept or decline online.",
    icon: FileText,
  },
  {
    title: "We do the work",
    description:
      "A technician arrives in the agreed window. You can follow the job's progress at any time.",
    icon: Wrench,
  },
  {
    title: "Pay with a clear invoice",
    description:
      "You receive an invoice with the payment instructions. Payments are recorded as we receive them.",
    icon: ReceiptText,
  },
];

export const PROMISES = [
  {
    title: "A written quotation first",
    description:
      "Nothing starts until you have seen the price and said yes. Extra work is agreed with you before it begins.",
  },
  {
    title: "Starting prices up front",
    description:
      "Where a job has a fixed starting price, we show it. Where it depends on the fault, we say so.",
  },
  {
    title: "Workmanship guaranteed",
    description:
      "Our work is guaranteed for 30 days. If something is not right, tell us and we will come back.",
  },
] as const;

/** The mark for the fictional business in the header's identity slot. */
export function BusinessIdentity() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Wind aria-hidden="true" className="size-5" />
      </span>
      <span className="font-display text-xl font-bold tracking-tight text-ink">CoolBreeze</span>
      <span className="hidden text-sm text-ink-secondary lg:inline">Home Services</span>
    </span>
  );
}
