import { ReferenceType } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { formatReference, referenceType } from "./reference";

describe("formatReference", () => {
  it("returns a well-formed reference unchanged", () => {
    expect(formatReference("FF-2026-00125")).toBe("FF-2026-00125");
    expect(formatReference("INV-2026-00007")).toBe("INV-2026-00007");
  });

  it("trims and upper-cases", () => {
    expect(formatReference("  ff-2026-00125 ")).toBe("FF-2026-00125");
    expect(formatReference("job-2026-00031")).toBe("JOB-2026-00031");
  });

  it("allows the sequence to grow past five digits", () => {
    expect(formatReference("QT-2026-100000")).toBe("QT-2026-100000");
  });

  it("shows an unexpected value rather than hiding it", () => {
    expect(formatReference(" pending ")).toBe("pending");
    expect(formatReference("FF-26-1")).toBe("FF-26-1");
  });
});

describe("referenceType", () => {
  it("maps each prefix to its document type", () => {
    expect(referenceType("FF-2026-00125")).toBe(ReferenceType.REQUEST);
    expect(referenceType("QT-2026-00042")).toBe(ReferenceType.QUOTATION);
    expect(referenceType("JOB-2026-00031")).toBe(ReferenceType.WORK_ORDER);
    expect(referenceType("inv-2026-00007")).toBe(ReferenceType.INVOICE);
  });

  it("returns null for anything else", () => {
    expect(referenceType("XX-2026-00001")).toBeNull();
    expect(referenceType("FF-2026")).toBeNull();
    expect(referenceType("")).toBeNull();
  });
});
