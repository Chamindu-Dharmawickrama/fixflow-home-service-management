import { describe, expect, it } from "vitest";

import { CONTENT_ICONS } from "../components/content-icons";
import {
  buildPrivacySections,
  CONTACT,
  CTA_BAND,
  DEMO_NOTICE,
  FAQ,
  faqEntriesFor,
  HERO,
  HERO_EXAMPLE_STAGES,
  HOW_IT_WORKS,
  SERVICE_AREA,
  SERVICES_PAGE,
  TRUST,
} from "./site-content";

/** Every sentence on the public website that is not read from the API. */
function allText(demoMode: boolean): string {
  const privacy = buildPrivacySections({
    demoMode,
    businessName: "CoolBreeze Home Services",
    contactEmail: "hello@coolbreeze.test",
  })
    .flatMap((section) => [section.title, ...section.paragraphs, ...(section.items ?? [])])
    .join("\n");
  return [
    JSON.stringify(HERO),
    JSON.stringify(HOW_IT_WORKS),
    JSON.stringify(TRUST),
    JSON.stringify(faqEntriesFor(demoMode)),
    JSON.stringify(SERVICE_AREA),
    JSON.stringify(CONTACT),
    JSON.stringify(CTA_BAND),
    JSON.stringify(SERVICES_PAGE),
    JSON.stringify(DEMO_NOTICE),
    privacy,
  ].join("\n");
}

describe("the homepage content (FR-001, FR-005)", () => {
  it("has the headline and the two calls to action the brief asks for", () => {
    expect(HERO.headline).toBe(
      "Home repairs and maintenance, handled from first request to final invoice",
    );
    expect(HERO.primaryCta).toBe("Request a service");
    expect(HERO.secondaryCta).toBe("Browse services");
  });

  it("describes the four real stages of the workflow, in order", () => {
    expect(HOW_IT_WORKS.steps.map((step) => step.id)).toEqual([
      "request",
      "quotation",
      "visit",
      "invoice",
    ]);
    expect(HOW_IT_WORKS.steps.map((step) => step.title)).toEqual([
      "Request",
      "Quotation",
      "Scheduled visit",
      "Invoice and payment",
    ]);
  });

  it("lists exactly the three trust points the product delivers", () => {
    expect(TRUST.points.map((point) => point.title)).toEqual([
      "Written quotations before work starts",
      "Track every request online",
      "Clear invoices and payment records",
    ]);
  });

  it("shows the example card with a status for each stage, labelled as an example", () => {
    expect(HERO.exampleLabel).toMatch(/example/i);
    expect(HERO_EXAMPLE_STAGES.map((stage) => `${stage.kind}:${stage.status}`)).toEqual([
      "request:SUBMITTED",
      "quotation:SENT",
      "workOrder:SCHEDULED",
      "invoice:PAID",
    ]);
  });

  it("gives every step and trust point a drawing", () => {
    for (const item of [...HOW_IT_WORKS.steps, ...TRUST.points]) {
      expect(CONTENT_ICONS[item.icon], item.id).toBeDefined();
    }
  });
});

describe("the FAQ (FR-005)", () => {
  it("has between five and seven questions, whichever mode the site is in", () => {
    expect(faqEntriesFor(false).length).toBeGreaterThanOrEqual(5);
    expect(faqEntriesFor(false).length).toBeLessThanOrEqual(7);
    expect(faqEntriesFor(true).length).toBeLessThanOrEqual(7);
  });

  it("shows the 'is this a real business' answer only in the portfolio demo", () => {
    const demo = faqEntriesFor(true).map((entry) => entry.id);
    const real = faqEntriesFor(false).map((entry) => entry.id);
    expect(demo).toContain("is-this-real");
    expect(real).not.toContain("is-this-real");
    expect(demo.length).toBe(real.length + 1);
  });

  it("has unique ids, questions that end in a question mark and non-empty answers", () => {
    const ids = FAQ.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of FAQ.entries) {
      expect(entry.question.endsWith("?"), entry.question).toBe(true);
      expect(entry.answer.length, entry.id).toBeGreaterThan(0);
      for (const paragraph of entry.answer) {
        expect(paragraph.trim().length, entry.id).toBeGreaterThan(20);
      }
    }
  });

  it("answers from the real workflow: a quotation first, no card payments, no customer self-cancellation", () => {
    const text = JSON.stringify(FAQ.entries);
    expect(text).toContain("written quotation first");
    expect(text).toContain("We do not take card payments");
    // Only the business can cancel a request (spec §7): the answer says to contact them.
    expect(text).toContain("Contact us");
  });
});

describe("honesty (CLAUDE.md §1, spec §22)", () => {
  it.each([false, true])(
    "has no testimonials, ratings, logos or invented figures (demo %s)",
    (demoMode) => {
      const text = allText(demoMode).toLowerCase();
      for (const forbidden of [
        "lorem",
        "ipsum",
        "testimonial",
        "★",
        "5-star",
        "five-star",
        "rated",
        "trusted by",
        "happy customers",
        "years of experience",
        "satisfaction guarantee",
        "award",
        "ai-powered",
        "stripe",
        "paypal",
      ]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
    },
  );

  it("has no percentages or counts presented as results", () => {
    expect(allText(true)).not.toMatch(/\d+\s?%/);
    expect(allText(true)).not.toMatch(/\b\d{2,}\+?\s+(customers|clients|jobs|homes|reviews)\b/i);
  });

  it("uses the notice wording the brief gives for the demo banner and footer", () => {
    expect(DEMO_NOTICE.banner.replace("{business}", "CoolBreeze Home Services")).toBe(
      "FixFlow portfolio demo — CoolBreeze Home Services is a fictional business. Data resets daily.",
    );
    expect(DEMO_NOTICE.footer).toBe("FixFlow portfolio demo — fictional business and data.");
  });
});

describe("buildPrivacySections (spec §15.2)", () => {
  const context = {
    businessName: "CoolBreeze Home Services",
    contactEmail: "hello@coolbreeze.test",
  };

  it("leads with the demo warning in the portfolio demo", () => {
    const sections = buildPrivacySections({ ...context, demoMode: true });
    expect(sections[0]?.id).toBe("demo");
    const text = sections[0]?.paragraphs.join(" ") ?? "";
    expect(text).toContain("CoolBreeze Home Services is a fictional business");
    expect(text).toContain("Do not submit real personal information");
    expect(text).toContain("reset every day");
  });

  it("says what the demo locks and limits, so a visitor is not surprised (T24)", () => {
    const text =
      buildPrivacySections({ ...context, demoMode: true })[0]?.paragraphs.join(" ") ?? "";
    expect(text).toContain("cannot change their passwords");
    expect(text).toContain("name, logo and contact details");
    expect(text).toContain("limits on how many changes and new accounts");
  });

  it("has no demo section outside the demo", () => {
    const ids = buildPrivacySections({ ...context, demoMode: false }).map((section) => section.id);
    expect(ids).not.toContain("demo");
    expect(JSON.stringify(buildPrivacySections({ ...context, demoMode: false }))).not.toMatch(
      /fictional|portfolio/i,
    );
  });

  it("says what is collected, why, cookies, who sees it, logs and the reader's choices", () => {
    const ids = buildPrivacySections({ ...context, demoMode: false }).map((section) => section.id);
    expect(ids).toEqual(["collected", "why", "google", "cookies", "visibility", "logs", "choices"]);
  });

  it("states that passwords are never stored as plain text and that no tracking cookies exist", () => {
    const text = JSON.stringify(buildPrivacySections({ ...context, demoMode: false }));
    expect(text).toContain("one-way hash");
    expect(text).toContain("no analytics, advertising or tracking cookies");
  });

  it("gives the business's contact email for corrections, or a general pointer without one", () => {
    const choices = (email: string | undefined) =>
      buildPrivacySections({ ...context, contactEmail: email, demoMode: false })
        .find((section) => section.id === "choices")
        ?.paragraphs.join(" ");
    expect(choices("hello@coolbreeze.test")).toContain("hello@coolbreeze.test");
    expect(choices(undefined)).toContain("contact the business");
  });

  it("gives every section a unique id, a title and some text", () => {
    const sections = buildPrivacySections({ ...context, demoMode: true });
    expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length);
    for (const section of sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.paragraphs.length).toBeGreaterThan(0);
    }
  });
});
