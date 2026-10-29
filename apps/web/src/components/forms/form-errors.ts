import type { FieldErrors as ApiFieldErrors } from "@fixflow/shared";
import type { FieldErrors, FieldValues, UseFormSetError } from "react-hook-form";

export interface FormErrorItem {
  /** The field path, for example `lines.2.quantity`. */
  name: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Flattens React Hook Form's nested error tree into one ordered list of `{ name, message }`.
 * Entries without a string message (for example a bare `ref`) are skipped, and a parent's own
 * message (a rule on an array, say) comes before the messages of its children.
 */
export function collectFormErrors(errors: FieldErrors<FieldValues>): FormErrorItem[] {
  const items: FormErrorItem[] = [];

  const visit = (node: unknown, path: string) => {
    if (!isRecord(node)) {
      return;
    }
    if (typeof node.message === "string" && node.message.length > 0 && path.length > 0) {
      items.push({ name: path, message: node.message });
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "ref" || key === "message" || key === "type" || key === "types") {
        continue;
      }
      visit(child, path.length > 0 ? `${path}.${key}` : key);
    }
  };

  visit(errors, "");
  return items;
}

/**
 * True when any error was put there by `applyApiFieldErrors` (type `server`). Such an error exists
 * only because a request was made and answered, so it is never a surprise that appears while a
 * person is still moving between fields.
 */
export function hasServerErrors(errors: FieldErrors<FieldValues>): boolean {
  const visit = (node: unknown): boolean => {
    if (!isRecord(node)) {
      return false;
    }
    if (node.type === "server" && typeof node.message === "string") {
      return true;
    }
    return Object.entries(node).some(([key, child]) => key !== "ref" && visit(child));
  };
  return visit(errors);
}

/** The key the API uses for an issue that is not tied to one field (`FieldErrors["_"]`). */
const API_FORM_LEVEL_KEY = "_";

/**
 * Puts the API's `fieldErrors` (`{ "lines.2.quantity": "Must be greater than zero" }`) onto a
 * React Hook Form form so each message appears beside its field. A form-level issue is stored as
 * `root.server`, which `FormErrorSummary` shows without a link. Returns the paths it applied.
 */
export function applyApiFieldErrors<TFieldValues extends FieldValues>(
  setError: UseFormSetError<TFieldValues>,
  fieldErrors: ApiFieldErrors | undefined,
): string[] {
  const applied: string[] = [];
  for (const [path, message] of Object.entries(fieldErrors ?? {})) {
    if (path === API_FORM_LEVEL_KEY) {
      setError("root.server", { type: "server", message });
    } else {
      // The API's paths are runtime strings; React Hook Form's typings expect the form's own keys.
      setError(path as Parameters<typeof setError>[0], { type: "server", message });
    }
    applied.push(path);
  }
  return applied;
}
