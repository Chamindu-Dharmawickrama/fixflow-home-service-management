import type { FieldErrors } from "@fixflow/shared";
import type { ZodError } from "zod";

/** Key used for issues that are not tied to a single field. */
export const ROOT_FIELD = "_";

function joinPath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Flattens a Zod error into one message per field, keyed by dotted path (`lines.2.quantity`).
 * The first issue for a field wins. Unknown keys on a strict object are reported on the
 * offending key, so a form can show them beside the field. Messages never echo the input.
 */
export function fieldErrorsFromZod(error: ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};

  const add = (key: string, message: string): void => {
    fieldErrors[key] ??= message;
  };

  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        add(joinPath([...issue.path, key]), "Unknown field.");
      }
      continue;
    }
    add(joinPath(issue.path) || ROOT_FIELD, issue.message);
  }

  return fieldErrors;
}
