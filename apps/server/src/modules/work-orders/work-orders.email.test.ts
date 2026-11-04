import { describe, expect, it } from "vitest";

import { emailJob, renderEmailJob } from "../email/email.jobs.js";
import type { EmailTemplateInput } from "../email/email.templates.js";

/**
 * The job emails (T18, BR-19). Their inputs are customer-safe fields only: the job, the service, a
 * link, and for two of them the optional message the business wrote. There is no field for an
 * internal note, a reason or a technician, so none can be handed in. The `@ts-expect-error` lines
 * are the proof: the file stops compiling (an "unused directive" error) if a template input ever
 * gains such a field.
 */

const BRANDING = {
  businessName: "CoolBreeze Home Services",
  contactEmail: "hello@coolbreeze.test",
  contactPhone: "(212) 555-0100",
};

const COMMON = {
  customerName: "Alex Morgan",
  jobReference: "JOB-2026-00042",
  serviceName: "AC Repair",
  jobUrl: "https://app.fixflow.test/portal/jobs/0b6c1e0e-6f1a-4b0e-9f1d-2d9d3a7c9a11",
};

const SECRETS = ["INTERNAL-NOTE", "INTERNAL-REASON", "Jordan Lee", "555-0151"];

function rendered(job: ReturnType<typeof emailJob>) {
  const email = renderEmailJob(job, BRANDING);
  return `${email.subject}\n${email.html}\n${email.text}`;
}

describe("the job email inputs have no field for anything internal", () => {
  it("job-completed takes the job, the service and a link, and nothing more", () => {
    const withNote: EmailTemplateInput<"job-completed"> = {
      ...COMMON,
      // @ts-expect-error -- no internal note can be passed to the completion email
      internalNote: "INTERNAL-NOTE",
    };
    const withSummary: EmailTemplateInput<"job-completed"> = {
      ...COMMON,
      // @ts-expect-error -- nor the completion summary: the customer reads it on the job
      completionNote: "Done.",
    };
    const withReason: EmailTemplateInput<"job-completed"> = {
      ...COMMON,
      // @ts-expect-error -- nor a reason
      reason: "INTERNAL-REASON",
    };
    const withTechnician: EmailTemplateInput<"job-completed"> = {
      ...COMMON,
      // @ts-expect-error -- nor the technician
      technician: "Jordan Lee",
    };
    expect([withNote, withSummary, withReason, withTechnician]).toHaveLength(4);
  });

  it.each(["job-needs-rescheduling", "job-cancelled"] as const)(
    "%s takes an optional message for the customer, and no reason",
    (template) => {
      const withMessage: EmailTemplateInput<typeof template> = {
        ...COMMON,
        customerMessage: "We are sorry for the trouble.",
      };
      const withReason: EmailTemplateInput<typeof template> = {
        ...COMMON,
        // @ts-expect-error -- the internal reason cannot be passed
        reason: "INTERNAL-REASON",
      };
      const withNote: EmailTemplateInput<typeof template> = {
        ...COMMON,
        // @ts-expect-error -- nor an internal note
        internalNote: "INTERNAL-NOTE",
      };
      expect([withMessage, withReason, withNote]).toHaveLength(3);
      // The same template renders, with its service, whatever message it carries.
      expect(rendered(emailJob(template, "alex@example.test", withMessage))).toContain("AC Repair");
    },
  );
});

describe("the job emails as they are rendered", () => {
  it("say what happened and link to the job, with no internal text", () => {
    const completed = rendered(emailJob("job-completed", "alex@example.test", COMMON));
    expect(completed).toContain("Your AC Repair job is complete");
    expect(completed).toContain(COMMON.jobUrl);

    const cancelled = rendered(emailJob("job-cancelled", "alex@example.test", COMMON));
    expect(cancelled).toContain("Your AC Repair job was cancelled");

    const needs = rendered(emailJob("job-needs-rescheduling", "alex@example.test", COMMON));
    expect(needs).toContain("We need to find a new time for your AC Repair visit");

    for (const text of [completed, cancelled, needs]) {
      for (const secret of SECRETS) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it("carry the message the business wrote, escaped, and no 'message' heading without one", () => {
    const message = "Sorry about this.\n\nWe will <b>phone</b> you.";
    for (const template of ["job-needs-rescheduling", "job-cancelled"] as const) {
      const withMessage = renderEmailJob(
        emailJob(template, "alex@example.test", { ...COMMON, customerMessage: message }),
        BRANDING,
      );
      expect(withMessage.text).toContain("A message from CoolBreeze Home Services:");
      expect(withMessage.text).toContain("Sorry about this.");
      expect(withMessage.html).not.toContain("<b>phone</b>");
      expect(withMessage.html).toContain("&lt;b&gt;phone&lt;/b&gt;");

      const without = renderEmailJob(emailJob(template, "alex@example.test", COMMON), BRANDING);
      expect(without.text).not.toContain("A message from");
    }
  });
});
