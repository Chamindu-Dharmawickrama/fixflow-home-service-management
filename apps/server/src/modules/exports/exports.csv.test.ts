import { describe, expect, it } from "vitest";

import { CSV_BOM, CSV_NEWLINE, csvField, csvRecord, neutralizeFormula } from "./exports.csv.js";

describe("neutralizeFormula (FR-084)", () => {
  it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"])(
    "puts an apostrophe in front of %j, so a spreadsheet shows text",
    (value) => {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    },
  );

  it.each([
    "Alex Morgan",
    "A=B",
    "AC repair + install",
    "2026-03-05",
    "120.00",
    "",
    " =not at the start",
  ])("leaves %j alone", (value) => {
    expect(neutralizeFormula(value)).toBe(value);
  });

  it("guards the well-known payloads", () => {
    expect(neutralizeFormula('=HYPERLINK("http://evil.test","x")')).toBe(
      `'=HYPERLINK("http://evil.test","x")`,
    );
    expect(neutralizeFormula("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
  });
});

describe("csvField (RFC 4180)", () => {
  it("writes plain text as it is", () => {
    expect(csvField("Harbor City")).toBe("Harbor City");
    expect(csvField(42)).toBe("42");
  });

  it("writes null and undefined as an empty field", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes a field with a comma", () => {
    expect(csvField("Reyes, Morgan")).toBe('"Reyes, Morgan"');
  });

  it("quotes a field with a double quote and doubles the quote", () => {
    expect(csvField('The "big" job')).toBe('"The ""big"" job"');
  });

  it("quotes a field with a line feed or a carriage return, and keeps them", () => {
    expect(csvField("one\ntwo")).toBe('"one\ntwo"');
    expect(csvField("one\r\ntwo")).toBe('"one\r\ntwo"');
  });

  it("applies the formula guard before the quoting", () => {
    expect(csvField('=A1,"x"')).toBe(`"'=A1,""x"""`);
    expect(csvField("=1+1")).toBe("'=1+1");
  });

  it("guards a text cell that starts with a minus: a customer name can be anything", () => {
    expect(csvField("-5 Degrees Ltd")).toBe("'-5 Degrees Ltd");
  });
});

describe("csvRecord", () => {
  it("joins fields with commas and ends with CRLF", () => {
    expect(csvRecord(["FF-2026-00001", null, "a,b"])).toBe(`FF-2026-00001,,"a,b"${CSV_NEWLINE}`);
    expect(CSV_NEWLINE).toBe("\r\n");
  });

  it("exposes a UTF-8 byte-order mark for Excel", () => {
    expect(CSV_BOM).toBe("﻿");
  });
});
