"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useTransition } from "react";

import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { buildHref } from "@/lib/url";

import { JOBS_PATH } from "../lib/jobs";
import { SEARCH_DEBOUNCE_MS, useDraft } from "../lib/use-draft";

export interface JobsFiltersProps {
  /** The committed filters, from the URL. */
  q: string | undefined;
  technicianId: string | undefined;
  scheduledFrom: string | undefined;
  scheduledTo: string | undefined;
  /** The technicians to choose from, by name (inactive ones too: a job can still be theirs). */
  technicians: readonly { id: string; name: string; isActive: boolean }[];
  /** What a change keeps: the tab and the sort, exactly as they are in the URL. */
  preserve: Readonly<Record<string, string>>;
  /** Any of this form's own filters is set, so "Clear filters" has something to clear. */
  canClear: boolean;
}

interface Fields {
  q: string;
  technicianId: string;
  scheduledFrom: string;
  scheduledTo: string;
}

/**
 * The jobs list's search and filters (FR-052). Typing in the search box reloads the list shortly
 * after the last key; the technician and the dates reload it at once. Every change lands in the URL
 * (D-40), on page 1, with the tab and sort kept, so the result can be bookmarked and the back button
 * works. It is also a plain `GET` form, so it still works without JavaScript: the button submits it.
 * The dates are days on the business's calendar, matched against the day a visit starts.
 */
export function JobsFilters({
  q,
  technicianId,
  scheduledFrom,
  scheduledTo,
  technicians,
  preserve,
  canClear,
}: JobsFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [text, setText] = useDraft(q ?? "");
  const [technician, setTechnician] = useDraft(technicianId ?? "");
  const [from, setFrom] = useDraft(scheduledFrom ?? "");
  const [to, setTo] = useDraft(scheduledTo ?? "");

  // The timer fires later than the render that started it, so it reads the fields from here, which
  // always holds the latest.
  const latest = useRef<Fields>({
    q: text,
    technicianId: technician,
    scheduledFrom: from,
    scheduledTo: to,
  });
  useEffect(() => {
    latest.current = { q: text, technicianId: technician, scheduledFrom: from, scheduledTo: to };
  }, [text, technician, from, to]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const rangeError = from !== "" && to !== "" && from > to;

  const apply = (fields: Fields) => {
    clearTimeout(timer.current);
    if (fields.scheduledFrom !== "" && fields.scheduledTo !== "") {
      if (fields.scheduledFrom > fields.scheduledTo) return;
    }
    const href = buildHref(JOBS_PATH, preserve, {
      q: fields.q.trim(),
      technicianId: fields.technicianId,
      scheduledFrom: fields.scheduledFrom,
      scheduledTo: fields.scheduledTo,
    });
    startTransition(() => router.replace(href, { scroll: false }));
  };

  const change = (patch: Partial<Fields>, { wait }: { wait: boolean }) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    if (patch.q !== undefined) setText(patch.q);
    if (patch.technicianId !== undefined) setTechnician(patch.technicianId);
    if (patch.scheduledFrom !== undefined) setFrom(patch.scheduledFrom);
    if (patch.scheduledTo !== undefined) setTo(patch.scheduledTo);

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
      action={JOBS_PATH}
      role="search"
      aria-label="Search and filter jobs"
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      {Object.entries(preserve).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <Field id="job-search" label="Search" className="min-w-0 sm:min-w-64 sm:flex-1">
        {(control) => (
          <Input
            {...control}
            name="q"
            type="search"
            value={text}
            onChange={(event) => change({ q: event.target.value }, { wait: true })}
            placeholder="Reference, customer name or email"
            autoComplete="off"
            maxLength={100}
          />
        )}
      </Field>

      <Field id="job-technician" label="Technician" className="min-w-0 sm:w-48">
        {(control) => (
          <Select
            {...control}
            name="technicianId"
            value={technician}
            onChange={(event) => change({ technicianId: event.target.value }, { wait: false })}
          >
            <option value="">All technicians</option>
            {technicians.map((option) => (
              <option key={option.id} value={option.id}>
                {option.isActive ? option.name : `${option.name} (inactive)`}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="job-from" label="Scheduled from" className="min-w-0 sm:w-40">
        {(control) => (
          <DateInput
            {...control}
            name="scheduledFrom"
            value={from}
            max={to === "" ? undefined : to}
            onChange={(event) => change({ scheduledFrom: event.target.value }, { wait: false })}
          />
        )}
      </Field>

      <Field
        id="job-to"
        label="Scheduled to"
        className="min-w-0 sm:w-40"
        error={rangeError ? "Choose a date on or after the start date." : undefined}
      >
        {(control) => (
          <DateInput
            {...control}
            name="scheduledTo"
            value={to}
            min={from === "" ? undefined : from}
            onChange={(event) => change({ scheduledTo: event.target.value }, { wait: false })}
          />
        )}
      </Field>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {canClear ? (
          <Button variant="ghost" asChild>
            <Link href={buildHref(JOBS_PATH, preserve, {})}>
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
