import type { EmailBranding, RenderedEmail } from "./email.layout.js";
import {
  EMAIL_TEMPLATES,
  type EmailTemplateInput,
  type EmailTemplateName,
} from "./email.templates.js";

/**
 * One email a business operation wants sent once it has committed (BR-22). It is plain data: which
 * template, to whom, with which customer-safe input. Rendering and sending happen later in the
 * dispatcher, so a mistake in a template can never roll the operation back.
 */
export type EmailJob = {
  [Name in EmailTemplateName]: {
    template: Name;
    /** The recipient. Empty, `null` or `undefined` is recorded as `SKIPPED`. */
    to: string | null | undefined;
    input: EmailTemplateInput<Name>;
    /** The in-app notification this email repeats, so the delivery log can be traced to it. */
    notificationId?: string | undefined;
  };
}[EmailTemplateName];

/**
 * Builds a job whose `input` is checked against the template named by `template`:
 * `emailJob("quotation-sent", customer.email, { …quotation fields… })`.
 */
export function emailJob<Name extends EmailTemplateName>(
  template: Name,
  to: string | null | undefined,
  input: EmailTemplateInput<Name>,
  options: { notificationId?: string } = {},
): EmailJob {
  return { template, to, input, notificationId: options.notificationId };
}

/** Renders a queued job with the business branding. Throws if the template cannot be built. */
export function renderEmailJob(job: EmailJob, branding: EmailBranding): RenderedEmail {
  // The same correlation TypeScript cannot follow: `emailJob` guaranteed this input fits this template.
  const render = EMAIL_TEMPLATES[job.template] as (input: unknown) => RenderedEmail;
  return render({ ...job.input, ...branding });
}
