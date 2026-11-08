"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useTransition } from "react";

import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { buildHref } from "@/lib/url";

import { INVOICES_PATH } from "../lib/invoices";
import { SEARCH_DEBOUNCE_MS, useDraft } from "../lib/use-draft";

export interface InvoicesFiltersProps {
  /** The committed filters, from the URL. */
  q: string | undefined;
  dueFrom: string | undefined;
  dueTo: string | undefined;
  /** What a change keeps: the status and the sort, exactly as they are in the URL. */
  preserve: Readonly<Record<string, string>>;
  /** Any of this form's own filters is set, so "Clear filters" has something to clear. */
  canClear: boolean;
}

interface Fields {
  q: string;
  dueFrom: string;
  dueTo: string;
}

/**
 * The invoice list's search and due-date range (FR-074). Typing in the search box reloads the list
 * shortly after the last key; the dates reload it at once. Every change lands in the URL (D-40), on
 * page 1, with the status and sort kept, so the result can be bookmarked and the back button works.
 * It is also a plain `GET` form, so it still works without JavaScript: the button submits it. The
 * dates are days on the business's calendar, both ends included.
 */
export function InvoicesFilters({ q, dueFrom, dueTo, preserve, canClear }: InvoicesFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [text, setText] = useDraft(q ?? "");
  const [from, setFrom] = useDraft(dueFrom ?? "");
  const [to, setTo] = useDraft(dueTo ?? "");

  // The timer fires later than the render that started it, so it reads the fields from here, which
  // always holds the latest.
  const latest = useRef<Fields>({ q: text, dueFrom: from, dueTo: to });
  useEffect(() => {
    latest.current = { q: text, dueFrom: from, dueTo: to };
  }, [text, from, to]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const rangeError = from !== "" && to !== "" && from > to;

  const apply = (fields: Fields) => {
    clearTimeout(timer.current);
    if (fields.dueFrom !== "" && fields.dueTo !== "" && fields.dueFrom > fields.dueTo) return;
    const href = buildHref(INVOICES_PATH, preserve, {
      q: fields.q.trim(),
      dueFrom: fields.dueFrom,
      dueTo: fields.dueTo,
    });
    startTransition(() => router.replace(href, { scroll: false }));
  };

  const change = (patch: Partial<Fields>, { wait }: { wait: boolean }) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    if (patch.q !== undefined) setText(patch.q);
    if (patch.dueFrom !== undefined) setFrom(patch.dueFrom);
    if (patch.dueTo !== undefined) setTo(patch.dueTo);

    clearTimeout(timer.current);
    if (wait) {
      timer.current = setTimeout(() => apply(latest.current), SEARCH_DEBOUNCE_MS);
    } else {
      apply(next);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    apply(latest.current);
  };

  return (
    <form
      method="get"
      action={INVOICES_PATH}
      role="search"
      aria-label="Search and filter invoices"
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      {Object.entries(preserve).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <Field id="invoice-search" label="Search" className="min-w-0 sm:min-w-64 sm:flex-1">
        {(control) => (
          <Input
            {...control}
            name="q"
            type="search"
            value={text}
            onChange={(event) => change({ q: event.target.value }, { wait: true })}
            placeholder="Invoice number, customer or job"
            autoComplete="off"
            maxLength={100}
          />
        )}
      </Field>

      <Field id="invoice-due-from" label="Due from" className="min-w-0 sm:w-40">
        {(control) => (
          <DateInput
            {...control}
            name="dueFrom"
            value={from}
            max={to === "" ? undefined : to}
            onChange={(event) => change({ dueFrom: event.target.value }, { wait: false })}
          />
        )}
      </Field>

      <Field
        id="invoice-due-to"
        label="Due to"
        className="min-w-0 sm:w-40"
        error={rangeError ? "Choose a date on or after the start date." : undefined}
      >
        {(control) => (
          <DateInput
            {...control}
            name="dueTo"
            value={to}
            min={from === "" ? undefined : from}
            onChange={(event) => change({ dueTo: event.target.value }, { wait: false })}
          />
        )}
      </Field>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {canClear ? (
          <Button variant="ghost" asChild>
            <Link href={buildHref(INVOICES_PATH, preserve, {})}>
              <X aria-hidden="true" />
              Clear filters
            </Link>
          </Button>
        ) : null}
        <span role="status" className="flex items-center gap-1.5 text-sm text-ink-secondary">
          {pending ? (
            <>
              <Spinner />
              Updating…
            </>
          ) : null}
        </span>
      </div>
    </form>
  );
}
