import { describe, expect, it } from "vitest";

import type { EmailBranding, RenderedEmail } from "./email.layout.js";
import {
  EMAIL_TEMPLATE_NAMES,
  EMAIL_TEMPLATES,
  type EmailTemplateInput,
  type EmailTemplateName,
  renderPasswordResetEmail,
} from "./email.templates.js";

const RESET_URL = "https://fixflow.example.com/reset-password?token=abc_DEF-123";

describe("renderPasswordResetEmail", () => {
  const email = renderPasswordResetEmail({
    businessName: "CoolBreeze Home Services",
    resetUrl: RESET_URL,
    expiresInMinutes: 60,
  });

  it("names the business in the subject", () => {
    expect(email.subject).toBe("Reset your CoolBreeze Home Services password");
  });

  it("puts the link, the expiry and the 'ignore this' reassurance in both versions", () => {
    for (const body of [email.html, email.text]) {
      expect(body).toContain(RESET_URL);
      expect(body).toContain("expires in 60 minutes");
      expect(body).toContain("you can ignore this email");
    }
  });

  it("is a complete, accessible HTML document", () => {
    expect(email.html.startsWith("<!doctype html>")).toBe(true);
    expect(email.html).toContain('<html lang="en">');
    expect(email.html).toContain("<title>Reset your CoolBreeze Home Services password</title>");
    expect(email.html).toContain("<h1");
    expect(email.html).toContain(">Choose a new password</a>");
  });

  it("escapes the business name and the URL in HTML", () => {
    const hostile = renderPasswordResetEmail({
      businessName: '<img src=x onerror="alert(1)"> & Co',
      resetUrl: 'https://fixflow.example.com/reset-password?token=a"b&c=<d>',
      expiresInMinutes: 60,
    });

    expect(hostile.html).not.toContain("<img");
    expect(hostile.html).not.toContain('onerror="');
    expect(hostile.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Co");
    expect(hostile.html).toContain("token=a&quot;b&amp;c=&lt;d&gt;");
  });

  it("keeps the subject on one line even if the business name has a line break", () => {
    const injected = renderPasswordResetEmail({
      businessName: "Acme\r\nBcc: attacker@example.test",
      resetUrl: RESET_URL,
      expiresInMinutes: 60,
    });

    expect(injected.subject).not.toMatch(/[\r\n]/);
  });

  it("does not include the text 'undefined' or an unreplaced placeholder", () => {
    expect(email.html + email.text).not.toMatch(/undefined|\$\{|\{\{/);
  });
});

// --- Every template ----------------------------------------------------------------------------

const BRANDING: EmailBranding = {
  businessName: "CoolBreeze Home Services",
  contactEmail: "hello@coolbreeze.test",
  contactPhone: "(212) 555-0140",
};

const APP = "https://fixflow.example.com";
const REQUEST_URL = `${APP}/portal/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11`;
const QUOTATION_URL = `${APP}/portal/quotations/1c7d2f1f-7a2b-4c1f-8a2e-3e0e4b8d0b22`;
const JOB_URL = `${APP}/portal/jobs/2d8e3a20-8b3c-4d20-9b3f-4f1f5c9e1c33`;
const INVOICE_URL = `${APP}/portal/invoices/3e9f4b31-9c4d-4e31-8c40-5a2a6d0f2d44`;
const ADMIN_REQUEST_URL = `${APP}/app/requests/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11`;

const START = new Date("2026-11-10T14:00:00.000Z"); // 9:00 AM in New York
const END = new Date("2026-11-10T16:00:00.000Z"); // 11:00 AM

/**
 * One realistic input per template. The mapped type makes a template without a sample (or with a
 * wrong one) a compile error, and the fields here are the whole of what a template can receive.
 */
const SAMPLE_INPUTS: { [Name in EmailTemplateName]: EmailTemplateInput<Name> } = {
  "password-reset": { resetUrl: RESET_URL, expiresInMinutes: 60 },
  "smtp-test": { sentAt: new Date("2026-10-29T15:30:00.000Z"), timeZone: "America/New_York" },
  "request-received-customer": {
    customerName: "Alex Morgan",
    requestReference: "FF-2026-00012",
    serviceName: "AC Repair",
    requestUrl: REQUEST_URL,
  },
  "request-received-admin": {
    requestReference: "FF-2026-00012",
    serviceName: "AC Repair",
    customerName: "Alex Morgan",
    requestUrl: ADMIN_REQUEST_URL,
  },
  "request-cancelled": {
    customerName: "Alex Morgan",
    requestReference: "FF-2026-00012",
    serviceName: "AC Repair",
    requestUrl: REQUEST_URL,
  },
  "quotation-sent": {
    customerName: "Alex Morgan",
    quotationReference: "QT-2026-00004",
    serviceName: "AC Repair",
    totalAmount: "108.00",
    currencyCode: "USD",
    validUntil: "2026-11-24",
    quotationUrl: QUOTATION_URL,
  },
  "quotation-withdrawn": {
    customerName: "Alex Morgan",
    quotationReference: "QT-2026-00004",
    serviceName: "AC Repair",
    requestUrl: REQUEST_URL,
  },
  "quotation-decision-admin": {
    customerName: "Alex Morgan",
    quotationReference: "QT-2026-00004",
    serviceName: "AC Repair",
    decision: "ACCEPTED",
    totalAmount: "108.00",
    currencyCode: "USD",
    requestUrl: ADMIN_REQUEST_URL,
  },
  "job-scheduled": {
    customerName: "Alex Morgan",
    jobReference: "JOB-2026-00003",
    serviceName: "AC Repair",
    jobUrl: JOB_URL,
    scheduledStart: START,
    scheduledEnd: END,
    timeZone: "America/New_York",
  },
  "job-rescheduled": {
    customerName: "Alex Morgan",
    jobReference: "JOB-2026-00003",
    serviceName: "AC Repair",
    jobUrl: JOB_URL,
    scheduledStart: new Date("2026-11-12T15:00:00.000Z"),
    scheduledEnd: new Date("2026-11-12T17:00:00.000Z"),
    previousStart: START,
    previousEnd: END,
    timeZone: "America/New_York",
  },
  "job-needs-rescheduling": {
    customerName: "Alex Morgan",
    jobReference: "JOB-2026-00003",
    serviceName: "AC Repair",
    jobUrl: JOB_URL,
  },
  "job-completed": {
    customerName: "Alex Morgan",
    jobReference: "JOB-2026-00003",
    serviceName: "AC Repair",
    jobUrl: JOB_URL,
  },
  "job-cancelled": {
    customerName: "Alex Morgan",
    jobReference: "JOB-2026-00003",
    serviceName: "AC Repair",
    jobUrl: JOB_URL,
  },
  "invoice-issued": {
    customerName: "Alex Morgan",
    invoiceReference: "INV-2026-00007",
    totalAmount: "1284.50",
    currencyCode: "USD",
    dueDate: "2026-11-24",
    invoiceUrl: INVOICE_URL,
  },
  "invoice-voided": {
    customerName: "Alex Morgan",
    invoiceReference: "INV-2026-00007",
    invoiceUrl: INVOICE_URL,
  },
  "payment-recorded": {
    customerName: "Alex Morgan",
    invoiceReference: "INV-2026-00007",
    paymentAmount: "500.00",
    currencyCode: "USD",
    paymentDate: "2026-11-02",
    balance: "784.50",
    invoiceUrl: INVOICE_URL,
  },
};

/** Renders a template from its sample, with some fields (or the branding) replaced. */
function render(
  name: EmailTemplateName,
  overrides: Record<string, unknown> = {},
  branding: EmailBranding = BRANDING,
): RenderedEmail {
  const template = EMAIL_TEMPLATES[name] as (input: unknown) => RenderedEmail;
  return template({ ...SAMPLE_INPUTS[name], ...overrides, ...branding });
}

/** Free-text fields: they hold text a person or the database supplied, so they are escaped. */
const TEXT_FIELDS = [
  "customerName",
  "serviceName",
  "requestReference",
  "quotationReference",
  "jobReference",
  "invoiceReference",
] as const;
const URL_FIELDS = ["resetUrl", "requestUrl", "quotationUrl", "jobUrl", "invoiceUrl"] as const;

const SCRIPT = "<script>alert(1)</script>";
const ATTRIBUTE_BREAKOUT = '" onmouseover="alert(1)" x="';

function fieldsIn(name: EmailTemplateName, candidates: readonly string[]): string[] {
  return candidates.filter((field) => field in SAMPLE_INPUTS[name]);
}

describe("the template set (D-38)", () => {
  it("has a template for every notification event, the password reset and the SMTP test", () => {
    expect([...EMAIL_TEMPLATE_NAMES].sort()).toEqual([
      "invoice-issued",
      "invoice-voided",
      "job-cancelled",
      "job-completed",
      "job-needs-rescheduling",
      "job-rescheduled",
      "job-scheduled",
      "password-reset",
      "payment-recorded",
      "quotation-decision-admin",
      "quotation-sent",
      "quotation-withdrawn",
      "request-cancelled",
      "request-received-admin",
      "request-received-customer",
      "smtp-test",
    ]);
  });
});

describe.each(EMAIL_TEMPLATE_NAMES)("template %s", (name) => {
  const email = render(name);

  it("has a real, single-line subject", () => {
    expect(email.subject.length).toBeGreaterThan(10);
    expect(email.subject.length).toBeLessThanOrEqual(120);
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("is a complete, accessible HTML document with one heading and the business name", () => {
    expect(email.html.startsWith("<!doctype html>")).toBe(true);
    expect(email.html).toContain('<html lang="en">');
    expect(email.html).toContain('<meta name="viewport"');
    expect(email.html).toContain(`<title>${email.subject.replaceAll("&", "&amp;")}</title>`);
    expect(email.html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(email.html).toContain("CoolBreeze Home Services");
    expect(email.html).toContain("Powered by FixFlow");
  });

  it("has a plain-text version with the same substance", () => {
    expect(email.text.length).toBeGreaterThan(80);
    expect(email.text).toContain("CoolBreeze Home Services");
    expect(email.text).toContain("Powered by FixFlow");
    expect(email.text).toContain("Questions? Contact CoolBreeze Home Services");
    expect(email.text).not.toMatch(/<[a-z/][^>]*>/i);
  });

  it("leaves no placeholder, 'undefined', 'NaN' or object text behind", () => {
    expect(email.html + email.text).not.toMatch(/undefined|NaN|\[object|\$\{|\{\{/);
  });

  it("matches its snapshot", () => {
    expect({ subject: email.subject, text: email.text }).toMatchSnapshot("subject and text");
    expect(email.html).toMatchSnapshot("html");
  });

  it("escapes a script tag in every free-text field and in the business details", () => {
    for (const field of fieldsIn(name, TEXT_FIELDS)) {
      const hostile = render(name, { [field]: SCRIPT });
      expect(hostile.html, field).not.toContain("<script");
      expect(hostile.html, field).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    }
    const hostileBusiness = render(name, {}, { ...BRANDING, businessName: SCRIPT });
    expect(hostileBusiness.html).not.toContain("<script");
    expect(hostileBusiness.html).toContain("&lt;script&gt;");
  });

  it("keeps an attribute-injection payload from leaving its attribute", () => {
    for (const field of fieldsIn(name, TEXT_FIELDS)) {
      const hostile = render(name, { [field]: ATTRIBUTE_BREAKOUT });
      expect(hostile.html, field).not.toContain('" onmouseover="');
      expect(hostile.html, field).toContain("&quot; onmouseover=&quot;");
    }
    const hostile = render(
      name,
      {},
      { ...BRANDING, contactEmail: ATTRIBUTE_BREAKOUT, contactPhone: SCRIPT },
    );
    expect(hostile.html).not.toContain('" onmouseover="');
    expect(hostile.html).not.toContain("<script");
  });

  it("escapes a hostile link and refuses a script link", () => {
    for (const field of fieldsIn(name, URL_FIELDS)) {
      const hostile = render(name, { [field]: `${APP}/portal/x?a="><script>alert(1)</script>` });
      expect(hostile.html, field).not.toContain("<script");
      expect(hostile.html, field).toContain("&quot;&gt;&lt;script&gt;");

      expect(() => render(name, { [field]: "javascript:alert(1)" }), field).toThrow(TypeError);
      expect(() => render(name, { [field]: "/portal/relative" }), field).toThrow(TypeError);
    }
  });

  it("keeps the subject on one line when a field contains a line break", () => {
    const fields = fieldsIn(name, TEXT_FIELDS);
    const injected = render(
      name,
      Object.fromEntries(fields.map((field) => [field, "Alex\r\nBcc: attacker@example.test"])),
      { ...BRANDING, businessName: "Acme\r\nBcc: attacker@example.test" },
    );

    expect(injected.subject).not.toMatch(/[\r\n]/);
  });

  it("only accepts customer-safe fields (no notes, descriptions, addresses or credentials)", () => {
    const forbidden = /note|internal|description|address|street|password|secret|phone|staff/i;

    for (const field of Object.keys(SAMPLE_INPUTS[name])) {
      expect(field, `${name}.${field}`).not.toMatch(forbidden);
    }
  });
});

/** Every template except the SMTP test, which is the one message with nothing to click. */
const TEMPLATES_WITH_A_LINK = EMAIL_TEMPLATE_NAMES.filter((name) => name !== "smtp-test");

describe.each(TEMPLATES_WITH_A_LINK)("template %s link", (name) => {
  it("puts the same link first in the HTML and the text", () => {
    const email = render(name);
    const href = /href="([^"]+)"/.exec(email.html)?.[1]?.replaceAll("&amp;", "&");
    const textLink = /https?:\/\/\S+/.exec(email.text)?.[0];

    expect(href).toBeDefined();
    expect(textLink).toBe(href);
  });
});

describe("specific copy", () => {
  it("tells the customer the quotation total, the valid-until date and where to answer", () => {
    const email = render("quotation-sent");

    expect(email.subject).toBe("Your quotation QT-2026-00004 from CoolBreeze Home Services");
    expect(email.text).toContain("Total: $108.00");
    expect(email.text).toContain("Valid until: Nov 24, 2026");
    expect(email.html).toContain(`href="${QUOTATION_URL}"`);
    expect(email.html).toContain(">Review your quotation</a>");
  });

  it("shows the appointment in the business time zone, and the old time when rescheduled", () => {
    expect(render("job-scheduled").text).toContain("When: Tue, Nov 10, 2026, 9:00 – 11:00 AM EST");

    const moved = render("job-rescheduled").text;
    expect(moved).toContain("New time: Thu, Nov 12, 2026, 10:00 AM – 12:00 PM EST");
    expect(moved).toContain("Previous time: Tue, Nov 10, 2026, 9:00 – 11:00 AM EST");
  });

  it("says whether an invoice is settled or still has a balance after a payment", () => {
    const partial = render("payment-recorded");
    expect(partial.text).toContain("Balance: $784.50");
    expect(partial.text).toContain("A balance remains");

    const settled = render("payment-recorded", { balance: "0.00" });
    expect(settled.text).toContain("Balance: $0.00");
    expect(settled.text).toContain("paid in full");
    expect(settled.text).not.toContain("A balance remains");
  });

  it("words the admin decision email for acceptance and for a decline", () => {
    const accepted = render("quotation-decision-admin");
    expect(accepted.subject).toBe("Alex Morgan accepted quotation QT-2026-00004");
    expect(accepted.text).toContain("A job can now be created");

    const declined = render("quotation-decision-admin", { decision: "DECLINED" });
    expect(declined.subject).toBe("Alex Morgan declined quotation QT-2026-00004");
    expect(declined.text).toContain("No work will be scheduled");
  });

  it("points the admin emails at admin pages and the customer emails at portal pages", () => {
    for (const name of ["request-received-admin", "quotation-decision-admin"] as const) {
      expect(render(name).text).toContain(`${APP}/app/`);
    }
    for (const name of EMAIL_TEMPLATE_NAMES.filter((n) => !n.endsWith("-admin"))) {
      expect(render(name).text, name).not.toContain(`${APP}/app/`);
    }
  });

  it("omits the contact line when the business details are unknown", () => {
    const email = render("invoice-voided", {}, { businessName: "FixFlow" });

    expect(email.text).not.toContain("Questions?");
    expect(email.html).not.toContain("Questions?");
  });

  it("never claims the email was delivered or that payment was processed", () => {
    for (const name of EMAIL_TEMPLATE_NAMES) {
      expect(render(name).text, name).not.toMatch(/was delivered|has been delivered|card|charged/i);
    }
  });
});
