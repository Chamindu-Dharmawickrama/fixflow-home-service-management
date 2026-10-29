"use client";

import { TriangleAlert } from "lucide-react";
import { type MouseEvent, useEffect, useRef } from "react";
import type { FieldErrors, FieldValues } from "react-hook-form";

import { getFieldId } from "@/components/forms/field-id";
import { collectFormErrors, hasServerErrors } from "@/components/forms/form-errors";
import { cn } from "@/lib/utils";

export interface FormErrorSummaryProps {
  errors: FieldErrors<FieldValues>;
  /** Human labels by field path. A path without one is shown as its last segment. */
  labels?: Record<string, string>;
  idPrefix?: string | undefined;
  /**
   * Pass `formState.submitCount`. The summary stays hidden until the first submit: a summary that
   * appears when a field is left (blur validation) pushes the page down while the pointer is
   * pressing the submit button, so the click lands on empty space and nothing is submitted. Each
   * failed submit also moves focus back to the summary, so a screen-reader user hears the list
   * again even when it already showed. Errors from the server (`applyApiFieldErrors`) always show:
   * they only exist because a request was made. Without this prop the summary shows whenever there
   * are errors.
   */
  submitCount?: number | undefined;
  className?: string | undefined;
}

function fallbackLabel(path: string): string {
  const last = path.split(".").at(-1) ?? path;
  const spaced = last.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Lists everything wrong with a long form, each item linking to its field. It appears only while
 * there are errors and takes focus when a submit fails. Short forms can rely on inline errors;
 * use the summary for forms with more than a handful of fields or with repeating rows. Create the
 * form with `useForm({ shouldFocusError: false })` so focus goes to the summary, not the first field.
 */
export function FormErrorSummary({
  errors,
  labels = {},
  idPrefix,
  submitCount,
  className,
}: FormErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const items = collectFormErrors(errors);
  const count = items.length;
  // Client-side errors wait for the first submit; errors from the server never do (see `submitCount`).
  const hidden = submitCount === 0 && !hasServerErrors(errors);

  useEffect(() => {
    if (count === 0 || hidden || submitCount === undefined || submitCount === 0) {
      return undefined;
    }
    // React Hook Form focuses the first invalid field from its own effect, which runs after this
    // one (a parent's effects follow its children's). Deferring to the next task lets the summary
    // have the last word. Pass `shouldFocusError: false` to `useForm` to stop the field flashing focus first.
    const timer = window.setTimeout(() => ref.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [count, hidden, submitCount]);

  if (count === 0 || hidden) {
    return null;
  }

  const focusField = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (target) {
      event.preventDefault();
      target.focus();
      target.scrollIntoView({ block: "center" });
    }
  };

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cn(
        "rounded-xl border border-danger-edge bg-danger-soft p-4 text-danger focus-visible:outline-offset-4",
        className,
      )}
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
        {count === 1 ? "There is 1 problem to fix" : `There are ${count} problems to fix`}
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-9 text-sm">
        {items.map((item) => {
          const id = getFieldId(item.name, idPrefix);
          const label = labels[item.name] ?? fallbackLabel(item.name);
          const isFormLevel = item.name.startsWith("root.");
          return (
            <li key={item.name}>
              {isFormLevel ? (
                <span>{item.message}</span>
              ) : (
                <a
                  href={`#${id}`}
                  onClick={(event) => focusField(event, id)}
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  {label}: {item.message}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
