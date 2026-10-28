import { ReferenceType } from "@fixflow/shared";

/** The prefix of each human-readable reference (D-17). The API allocates them; the web only displays. */
const PREFIX_TO_TYPE: Readonly<Record<string, ReferenceType>> = {
  FF: ReferenceType.REQUEST,
  QT: ReferenceType.QUOTATION,
  JOB: ReferenceType.WORK_ORDER,
  INV: ReferenceType.INVOICE,
};

const REFERENCE_PATTERN = /^(FF|QT|JOB|INV)-(\d{4})-(\d{5,})$/;

/**
 * Normalises a reference for display: trimmed and upper-case, for example `" ff-2026-00125 "` →
 * `"FF-2026-00125"`. A reference is a display identifier only, never authorization (BR-21). A value
 * that is not shaped like a reference is returned trimmed and otherwise unchanged, so an unexpected
 * value from the API is shown rather than hidden.
 */
export function formatReference(reference: string): string {
  const normalised = reference.trim().toUpperCase();
  return REFERENCE_PATTERN.test(normalised) ? normalised : reference.trim();
}

/** The kind of document a reference belongs to, or `null` if it is not shaped like one. */
export function referenceType(reference: string): ReferenceType | null {
  const match = REFERENCE_PATTERN.exec(reference.trim().toUpperCase());
  const prefix = match?.[1];
  return prefix ? (PREFIX_TO_TYPE[prefix] ?? null) : null;
}
