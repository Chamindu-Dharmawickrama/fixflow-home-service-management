/**
 * The DOM id of a form control, derived from its field name so the error summary can link to it
 * without any shared state: `getFieldId("lines.0.quantity")` → `"field-lines-0-quantity"`. When two
 * forms with the same field names share a page (for example a dialog over a page), give each an
 * `idPrefix`.
 */
export function getFieldId(name: string, idPrefix = ""): string {
  return `${idPrefix}field-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
