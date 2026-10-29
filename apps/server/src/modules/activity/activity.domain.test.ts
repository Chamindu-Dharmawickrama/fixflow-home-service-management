import { describe, expect, it } from "vitest";

import { buildActivitySummaries } from "./activity.domain.js";
import { ActivityValidationError } from "./activity.metadata.js";

describe("buildActivitySummaries", () => {
  it("phrases a staff action for staff and for the customer in one consistent voice", () => {
    const result = buildActivitySummaries({
      actor: { kind: "staff", name: "Morgan Reyes" },
      staff: "sent quotation QT-2026-00004 to Alex Morgan",
      customer: "sent you quotation QT-2026-00004",
    });

    expect(result).toEqual({
      summary: "Morgan Reyes sent quotation QT-2026-00004 to Alex Morgan.",
      publicSummary: "We sent you quotation QT-2026-00004.",
    });
  });

  it("says 'You' to the customer when the customer acted", () => {
    const result = buildActivitySummaries({
      actor: { kind: "customer", name: "Alex Morgan" },
      staff: "accepted quotation QT-2026-00004",
      customer: "accepted quotation QT-2026-00004",
    });

    expect(result.summary).toBe("Alex Morgan accepted quotation QT-2026-00004.");
    expect(result.publicSummary).toBe("You accepted quotation QT-2026-00004.");
  });

  it("names the system internally and speaks as the business to the customer", () => {
    const result = buildActivitySummaries({
      actor: { kind: "system" },
      staff: "expired quotation QT-2026-00004 because its valid-until date passed",
      customer: "marked quotation QT-2026-00004 as expired",
    });

    expect(result.summary).toBe(
      "The system expired quotation QT-2026-00004 because its valid-until date passed.",
    );
    expect(result.publicSummary).toBe("We marked quotation QT-2026-00004 as expired.");
  });

  it("keeps an event staff-only when there is no customer wording", () => {
    const result = buildActivitySummaries({
      actor: { kind: "staff", name: "Morgan Reyes" },
      staff: "added an internal note to request FF-2026-00012",
    });

    expect(result.publicSummary).toBeNull();
    expect(result.summary).toBe("Morgan Reyes added an internal note to request FF-2026-00012.");
  });

  it("never lets the staff wording into the customer's sentence", () => {
    const result = buildActivitySummaries({
      actor: { kind: "staff", name: "Morgan Reyes" },
      staff: "cancelled the job because the customer was rude on the phone",
      customer: "cancelled your job",
    });

    expect(result.publicSummary).toBe("We cancelled your job.");
    expect(result.publicSummary).not.toContain("rude");
    expect(result.publicSummary).not.toContain("Morgan");
  });

  it("tidies whitespace and a trailing full stop, and adds exactly one", () => {
    const result = buildActivitySummaries({
      actor: { kind: "staff", name: "  Morgan   Reyes " },
      staff: "  sent   the quotation.\n",
      customer: "sent you a quotation!! ",
    });

    expect(result.summary).toBe("Morgan Reyes sent the quotation.");
    expect(result.publicSummary).toBe("We sent you a quotation.");
  });

  it("rejects empty wording and an actor without a name", () => {
    expect(() => buildActivitySummaries({ actor: { kind: "system" }, staff: "  " })).toThrow(
      ActivityValidationError,
    );
    expect(() =>
      buildActivitySummaries({ actor: { kind: "system" }, staff: "did it", customer: "." }),
    ).toThrow(ActivityValidationError);
    expect(() =>
      buildActivitySummaries({ actor: { kind: "staff", name: " " }, staff: "did it" }),
    ).toThrow(ActivityValidationError);
  });
});
