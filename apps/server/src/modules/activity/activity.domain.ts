import { ActivityValidationError } from "./activity.metadata.js";

/**
 * Pure rules for the words of an activity event (D-29, FR-093). Every event has an internal
 * `summary` for staff and, when the customer should see it, a `publicSummary`. Writing both by hand
 * at every call site drifts into different voices, so workflow code describes *what happened* once
 * and this builder phrases it for each audience.
 */

/** Who did it. Decides the voice of the customer's sentence. */
export type ActivityActor =
  { kind: "staff"; name: string } | { kind: "customer"; name: string } | { kind: "system" };

export interface ActivitySummaryInput {
  actor: ActivityActor;
  /**
   * What happened, in the past tense, without the actor: `"sent quotation QT-2026-00004 to Alex
   * Morgan"`. Staff see it behind the actor's name, so it may mention internal detail.
   */
  staff: string;
  /**
   * What the customer reads, in the past tense, without the actor: `"sent you quotation
   * QT-2026-00004"`. Leave it out to keep the event staff-only. Write nothing here that the customer
   * must not see: this text is shown to them as it is.
   */
  customer?: string | undefined;
}

export interface ActivitySummaries {
  /** For `recordActivity({ summary })`. */
  summary: string;
  /** For `recordActivity({ publicSummary })`; `null` for a staff-only event. */
  publicSummary: string | null;
}

/** One line, single spaces, no trailing full stop (the builder adds one). */
function cleanPhrase(name: string, value: string): string {
  const phrase = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  if (phrase === "") {
    throw new ActivityValidationError(`The ${name} part of an activity summary must not be empty.`);
  }
  return phrase;
}

function staffSubject(actor: ActivityActor): string {
  switch (actor.kind) {
    case "staff":
    case "customer": {
      const name = actor.name.replace(/\s+/g, " ").trim();
      if (name === "") {
        throw new ActivityValidationError("The actor of an activity summary needs a name.");
      }
      return name;
    }
    case "system":
      return "The system";
  }
}

/**
 * Staff voice: `"Morgan Reyes sent quotation QT-2026-00004 to Alex Morgan."`
 * Customer voice: `"We sent you quotation QT-2026-00004."` when staff or the system acted, and
 * `"You accepted quotation QT-2026-00004."` when the customer did. Both end with a full stop.
 */
export function buildActivitySummaries(input: ActivitySummaryInput): ActivitySummaries {
  const summary = `${staffSubject(input.actor)} ${cleanPhrase("staff", input.staff)}.`;

  if (input.customer === undefined) {
    return { summary, publicSummary: null };
  }
  const voice = input.actor.kind === "customer" ? "You" : "We";
  return { summary, publicSummary: `${voice} ${cleanPhrase("customer", input.customer)}.` };
}
