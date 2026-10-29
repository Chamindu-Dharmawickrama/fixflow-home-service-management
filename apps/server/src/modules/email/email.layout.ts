import { singleLine } from "./email.domain.js";
import { httpUrl, markup, type SafeHtml } from "./email.html.js";
import type { EmailMessage } from "./email.types.js";

/**
 * The shared look and structure of every transactional email: a branded card with a heading, short
 * paragraphs, a few labelled facts, one call to action and a small footer. A template describes its
 * *content*; this module turns it into the HTML and the plain-text version at once, so the two
 * cannot drift apart and every value is escaped in one place.
 */

/** Business details every email may show. Staff-editable text, so it is escaped like any other. */
export interface EmailBranding {
  businessName: string;
  /** Shown as "Questions?" in the footer when at least one of the two is known. */
  contactEmail?: string | undefined;
  contactPhone?: string | undefined;
}

export interface EmailContent {
  subject: string;
  /** The visible heading (the document's single `h1`). */
  heading: string;
  /** Opening paragraphs, one string each. */
  intro: readonly string[];
  /** Labelled facts such as the reference, the date or the amount. */
  details?: ReadonlyArray<{ label: string; value: string }>;
  /** The one thing to do next. The URL must be absolute `http(s)`. */
  action?: { label: string; url: string };
  /** Paragraphs after the button. */
  outro?: readonly string[];
}

export type RenderedEmail = Pick<EmailMessage, "subject" | "html" | "text">;

// Plain, widely supported inline styles (mail clients ignore style sheets). Colours match the design
// tokens: deep brand blue for the button, near-black ink, muted grey for small print.
const FONT = "Arial,Helvetica,sans-serif";
const INK = "#1a2730";
const MUTED = "#4a5963";
const BRAND = "#0f4c75";

const SIGN_OFF_DASH = "— ";
const FOOTER_TEXT = "Powered by FixFlow";

function paragraph(content: string): SafeHtml {
  return markup`<p style="margin:0 0 16px;">${content}</p>`;
}

function detailRow({ label, value }: { label: string; value: string }): SafeHtml {
  return markup`<p style="margin:0 0 4px;"><strong>${label}:</strong> ${value}</p>`;
}

/** The button and, under it, the same address in plain sight for mail clients that block buttons. */
function actionBlock(action: { label: string; url: string }, afterDetails: boolean): SafeHtml {
  return markup`<p style="margin:${afterDetails ? "20px" : "8px"} 0 24px;"><a href="${action.url}" style="display:inline-block;padding:12px 20px;background:${BRAND};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">${action.label}</a></p>
      <p style="margin:0 0 24px;color:${MUTED};">If the button does not work, copy this address into your browser:<br><a href="${action.url}" style="color:${BRAND};word-break:break-all;">${action.url}</a></p>`;
}

function contactLine(businessName: string, contact: string): SafeHtml {
  return markup`<p style="margin:0 0 16px;color:${MUTED};">Questions? Contact ${businessName}: ${contact}</p>`;
}

/** Builds the subject, HTML and plain-text bodies from the content and the branding. */
export function renderEmail(branding: EmailBranding, content: EmailContent): RenderedEmail {
  const businessName = singleLine(branding.businessName);
  const subject = singleLine(content.subject);
  const heading = singleLine(content.heading);
  const intro = content.intro.map(singleLine);
  const outro = (content.outro ?? []).map(singleLine);
  const details = (content.details ?? []).map(({ label, value }) => ({
    label: singleLine(label),
    value: singleLine(value),
  }));
  const action =
    content.action === undefined
      ? undefined
      : { label: singleLine(content.action.label), url: httpUrl(content.action.url) };
  const contact = [branding.contactEmail, branding.contactPhone]
    .filter((item): item is string => item !== undefined && item.trim() !== "")
    .map(singleLine)
    .join(" · ");

  const textBlocks: string[] = [heading, ...intro];
  if (details.length > 0) {
    textBlocks.push(details.map(({ label, value }) => `${label}: ${value}`).join("\n"));
  }
  if (action !== undefined) {
    textBlocks.push(`${action.label}:\n${action.url}`);
  }
  textBlocks.push(...outro);
  if (contact !== "") {
    textBlocks.push(`Questions? Contact ${businessName}: ${contact}`);
  }
  textBlocks.push(`${SIGN_OFF_DASH}${businessName}`, FOOTER_TEXT);
  const text = textBlocks.join("\n\n");

  const body = markup`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f4f6f7;font-family:${FONT};font-size:16px;line-height:1.5;color:${INK};">
    <div style="max-width:560px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #d5dce0;border-radius:8px;">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${heading}</h1>
      ${intro.map(paragraph)}
      ${details.map(detailRow)}
      ${action && actionBlock(action, details.length > 0)}
      ${outro.map(paragraph)}
      ${contact !== "" && contactLine(businessName, contact)}
      <p style="margin:24px 0 0;">${businessName}</p>
      <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #d5dce0;font-size:13px;color:${MUTED};">${FOOTER_TEXT}</p>
    </div>
  </body>
</html>
`;

  return { subject, html: body.value, text };
}
