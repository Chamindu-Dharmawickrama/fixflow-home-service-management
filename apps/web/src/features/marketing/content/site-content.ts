/**
 * The words of the public website, in one reviewable place (T08). Every sentence describes what
 * FixFlow does or will do in the workflow of spec §7: a request, a written quotation the customer
 * accepts or declines, a scheduled visit, a completed job, an invoice and a payment the business
 * records by hand. There are no testimonials, ratings, client logos or invented statistics, and
 * nothing here claims an outcome the product does not deliver (CLAUDE.md §1, spec §22).
 *
 * Icons are named here and drawn by `components/content-icons.ts`, so this module stays plain data
 * that a test can read.
 */

export type ContentIcon =
  | "clipboard-list"
  | "file-text"
  | "calendar-check"
  | "receipt"
  | "file-check"
  | "list-checks"
  | "receipt-text"
  | "map-pin"
  | "phone"
  | "mail"
  | "shield-check";

export const HERO = {
  headline: "Home repairs and maintenance, handled from first request to final invoice",
  lead: "Tell us what needs fixing. We review your request, send a written quotation, schedule the visit and invoice you when the work is done. You can follow every step online.",
  primaryCta: "Request a service",
  secondaryCta: "Browse services",
  /** Sits beside the call to action: the quotation comes first, and an account is needed to follow the request. */
  assurance: "Written quotation first. Nothing starts until you say yes.",
  accountHint: "You will sign in or create a free account first, so you can follow your request.",
  /** Labels the example card in the hero, so it is never mistaken for a real customer's record. */
  exampleLabel: "Example of what you see in your account",
} as const;

/** The four stages of the example card in the hero, with the status the real screens show for each. */
export const HERO_EXAMPLE_STAGES = [
  { label: "Request", kind: "request", status: "SUBMITTED" },
  { label: "Quotation", kind: "quotation", status: "SENT" },
  { label: "Visit", kind: "workOrder", status: "SCHEDULED" },
  { label: "Invoice", kind: "invoice", status: "PAID" },
] as const;

export interface ProcessStep {
  id: "request" | "quotation" | "visit" | "invoice";
  title: string;
  description: string;
  icon: ContentIcon;
}

export const HOW_IT_WORKS = {
  title: "How it works",
  intro: "Four steps, each one visible to you online, from the first message to the last payment.",
  steps: [
    {
      id: "request",
      title: "Request",
      description:
        "Choose a service, describe the problem, tell us where the work is and when suits you. A free account lets you follow the request afterwards.",
      icon: "clipboard-list",
    },
    {
      id: "quotation",
      title: "Quotation",
      description:
        "We review your request and send a written quotation with line items and totals. You accept or decline it online. Nothing starts until you accept.",
      icon: "file-text",
    },
    {
      id: "visit",
      title: "Scheduled visit",
      description:
        "Once you accept, we schedule the visit and assign a technician. You see the day and time window, and any change to it, in your account.",
      icon: "calendar-check",
    },
    {
      id: "invoice",
      title: "Invoice and payment",
      description:
        "When the work is done we issue an invoice. You pay as the invoice explains, and we record the payment so you can see it.",
      icon: "receipt",
    },
  ],
} as const satisfies { title: string; intro: string; steps: readonly ProcessStep[] };

export interface TrustPoint {
  id: string;
  title: string;
  description: string;
  icon: ContentIcon;
}

export const TRUST = {
  title: "What you can expect",
  intro: "Three things the way we work gives you, and that you can check for yourself.",
  points: [
    {
      id: "written-quotations",
      title: "Written quotations before work starts",
      description:
        "You see the price, line by line, before anything begins. A quotation does not change after you have seen it. If the work changes, we send a new one.",
      icon: "file-check",
    },
    {
      id: "track-online",
      title: "Track every request online",
      description:
        "Your account shows where each request stands, from submitted to completed, with a timeline of what has happened.",
      icon: "list-checks",
    },
    {
      id: "clear-invoices",
      title: "Clear invoices and payment records",
      description:
        "Invoices list what you are paying for, and every payment we receive is recorded against the invoice you can open at any time.",
      icon: "receipt-text",
    },
  ],
} as const satisfies { title: string; intro: string; points: readonly TrustPoint[] };

export interface FaqEntry {
  id: string;
  question: string;
  /** Paragraphs of plain text. */
  answer: readonly string[];
  /** Shown only in the portfolio demo. */
  demoOnly?: boolean;
}

export const FAQ = {
  title: "Questions people ask",
  intro: "Answers about quotations, payment and changes, written from how we actually work.",
  entries: [
    {
      id: "how-to-request",
      question: "How do I request a service?",
      answer: [
        "Choose a service, then select Request this service. You sign in or create a free account, then describe the problem, give the address where the work is needed and say which day and time of day suit you.",
        "The request appears in your account straight away, and its status updates as we work on it.",
      ],
    },
    {
      id: "pay-first",
      question: "Do I pay before any work starts?",
      answer: [
        "No. You receive a written quotation first and nothing starts until you accept it. The invoice comes after the work is completed.",
      ],
    },
    {
      id: "decline-quotation",
      question: "What if I don't want to go ahead with a quotation?",
      answer: [
        "Decline it in your account, and tell us why if you wish. Declining costs nothing. If the job itself changes, we can send you a replacement quotation, and the earlier one stays on record.",
      ],
    },
    {
      id: "quotation-price",
      question: "Can the price change after I accept?",
      answer: [
        "A quotation is never edited once you have seen it, so the price you accepted is the price on the quotation. Extra work found on site is quoted and agreed with you before it starts.",
      ],
    },
    {
      id: "paying",
      question: "How do I pay, and where can I see what I have paid?",
      answer: [
        "Your invoice says how to pay. We do not take card payments on this website. When your payment reaches us we record it against the invoice, and the payment, and what is still owed, appear in your account.",
      ],
    },
    {
      id: "change-or-cancel",
      question: "Can I change or cancel a request?",
      answer: [
        "Contact us using the details on this page and we can cancel a request before work has started. A visit that has been scheduled can be moved to another day, and you will see the new time in your account.",
      ],
    },
    {
      id: "is-this-real",
      question: "Is CoolBreeze Home Services a real business?",
      answer: [
        "No. This is a portfolio demonstration of FixFlow, a service-management application. The business, its services, prices, phone numbers and addresses are fictional, and the data is reset every day.",
        "Please do not enter real personal information. The privacy notice explains what the demo stores.",
      ],
      demoOnly: true,
    },
  ],
} as const satisfies { title: string; intro: string; entries: readonly FaqEntry[] };

/** The FAQ entries to show: the demo-only ones appear only in the portfolio demo. */
export function faqEntriesFor(demoMode: boolean): readonly FaqEntry[] {
  return FAQ.entries.filter((entry) => demoMode || !("demoOnly" in entry && entry.demoOnly));
}

export const SERVICE_AREA = {
  title: "Where we work",
  /** Shown when the business has not described its service area in settings. */
  fallback:
    "Tell us your address when you send a request and we will confirm that we cover it before we quote.",
} as const;

export const CONTACT = {
  title: "Contact us",
  intro: "Questions before you request a service? Reach us any time.",
} as const;

export const CTA_BAND = {
  title: "Ready when you are",
  description:
    "Send a request in a few minutes. You will have a written quotation before any work begins.",
} as const;

export const SERVICES_PAGE = {
  title: "Our services",
  intro:
    "Everything we offer, with the price we start from or a note that we quote after reviewing your request. Choose a service to see what is included.",
  emptyTitle: "No services are listed right now",
  emptyDescription:
    "We are not offering any services online at the moment. Please check back soon, or contact us using the details at the foot of this page.",
} as const;

/** The notice shown under the demo banner and in the footer when the site is the portfolio demo. */
export const DEMO_NOTICE = {
  banner: "FixFlow portfolio demo — {business} is a fictional business. Data resets daily.",
  /** When the business name could not be loaded. */
  bannerWithoutName:
    "FixFlow portfolio demo — the business shown here is fictional. Data resets daily.",
  footer: "FixFlow portfolio demo — fictional business and data.",
  linkLabel: "Privacy and demo notice",
} as const;

export interface PrivacySection {
  id: string;
  title: string;
  /** Paragraphs of plain text. */
  paragraphs: readonly string[];
  /** Short bullet points after the paragraphs. */
  items?: readonly string[];
}

export interface PrivacyContext {
  demoMode: boolean;
  businessName: string;
  /** The business contact email, when it is known. */
  contactEmail: string | undefined;
}

/**
 * The privacy and demo notice (spec §15.2), written for a visitor rather than a lawyer. It states
 * only what the application does, and in the portfolio demo it leads with the warning not to enter
 * real personal information, because the published demo accounts can read what visitors enter (D-09).
 */
export function buildPrivacySections(context: PrivacyContext): PrivacySection[] {
  const { demoMode, businessName, contactEmail } = context;
  const sections: PrivacySection[] = [];

  if (demoMode) {
    sections.push({
      id: "demo",
      title: "This is a portfolio demonstration",
      paragraphs: [
        `${businessName} is a fictional business. This website is a demonstration of FixFlow, a service-management application built as a portfolio project. No real service will be carried out and no real invoice or payment exists.`,
        "Do not submit real personal information. The demo's sign-in details are published so anyone can explore the business side, which means anyone can read the names, email addresses and requests that visitors enter. Use made-up details, such as a name and an address that do not belong to you.",
        "The demo's data is reset every day, and anything you enter, including an account you create, may be deleted at any time without notice.",
        "To keep the demo usable for everyone, the shared demo accounts cannot change their passwords or the business's name, logo and contact details, and there are limits on how many changes and new accounts one visitor can make in a short time.",
        "The photographs on this website are royalty-free stock images that illustrate the kind of work involved. The people and equipment in them are not this business's staff, customers or work.",
      ],
    });
  }

  sections.push(
    {
      id: "collected",
      title: "What is collected",
      paragraphs: ["The application stores only what the service workflow needs:"],
      items: [
        "Your account: name, email address, optional phone number, and a password (stored only as a one-way hash, never as plain text) or a link to your Google account if you sign in with Google.",
        "Your service addresses, and the access notes you choose to add to them.",
        "Your requests, with the description, preferred time and status.",
        "Quotations, scheduled visits, invoices and payment records for your work, with a timeline of what happened and when.",
        "Notifications and the emails sent to you about your requests.",
      ],
    },
    {
      id: "why",
      title: "Why it is collected",
      paragraphs: [
        "To run the work you asked for, from request to invoice, to show you its progress, and to contact you about it. Nothing is collected for advertising, and nothing is sold or shared for marketing.",
      ],
    },
    {
      id: "google",
      title: "Signing in with Google",
      paragraphs: [
        "If you choose Google, we receive your name, your email address and Google's identifier for your account, and nothing else from your Google account. The Google sign-in button is loaded from Google on the sign-in page, so Google can see that visit.",
      ],
    },
    {
      id: "cookies",
      title: "Cookies",
      paragraphs: [
        "When you sign in, one cookie keeps you signed in. It is needed for the site to work, it cannot be read by scripts on the page, and it is removed when you sign out or after it expires. There are no analytics, advertising or tracking cookies.",
      ],
    },
    {
      id: "visibility",
      title: "Who can see it",
      paragraphs: [
        "You can see your own requests, quotations, visits and invoices. The business team can see the customers and records they need to do the work. Internal notes the team writes about a request are never shown to you.",
      ],
    },
    {
      id: "logs",
      title: "Technical logs",
      paragraphs: [
        "The servers keep technical logs to find faults and spot abuse. They do not contain passwords, sign-in cookies, or the text of your requests and addresses.",
      ],
    },
    {
      id: "choices",
      title: "Your choices",
      paragraphs: [
        contactEmail
          ? `To ask for your details to be corrected or removed, email ${contactEmail}.`
          : "To ask for your details to be corrected or removed, contact the business using the details on this website.",
      ],
    },
  );

  return sections;
}
