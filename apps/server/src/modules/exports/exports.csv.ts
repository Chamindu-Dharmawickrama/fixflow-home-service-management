/**
 * CSV writing for the exports (FR-084): RFC 4180 quoting and protection against formula injection. Pure
 * functions, so every rule is tested without a database.
 */

/** RFC 4180 ends every record with CRLF. */
export const CSV_NEWLINE = "\r\n";

/** UTF-8 byte-order mark: it makes Excel read the file as UTF-8, so names with accents survive. */
export const CSV_BOM = "﻿";

/**
 * A spreadsheet runs a cell that starts with one of these as a formula, and a formula can read other
 * cells or call out (CSV injection). A customer chooses their own name and a service's name is typed
 * by staff, so any text cell may start with one.
 */
const FORMULA_STARTERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Neutralises a cell that a spreadsheet would run as a formula by putting `'` in front of it, which
 * every common spreadsheet shows as plain text. Text that does not start with a trigger is unchanged.
 */
export function neutralizeFormula(value: string): string {
  const first = value.charAt(0);
  return first !== "" && FORMULA_STARTERS.has(first) ? `'${value}` : value;
}

/**
 * One field as it is written: the formula guard first, then RFC 4180 quoting. A field is quoted when it
 * holds a comma, a double quote, a carriage return or a line feed, and a double quote inside it is
 * doubled. `null` and `undefined` are empty.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = neutralizeFormula(String(value));
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One record, with its line ending. */
export function csvRecord(fields: ReadonlyArray<string | number | null | undefined>): string {
  return fields.map(csvField).join(",") + CSV_NEWLINE;
}
