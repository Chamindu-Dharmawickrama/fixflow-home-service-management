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

import { QUEUE_PATH } from "../lib/requests-queue";
import { SEARCH_DEBOUNCE_MS, useDraft } from "../lib/use-draft";

export { SEARCH_DEBOUNCE_MS };

export interface RequestQueueFiltersProps {
  /** The committed filters, from the URL. */
  q: string | undefined;
  serviceId: string | undefined;
  submittedFrom: string | undefined;
  submittedTo: string | undefined;
  /** The services to choose from, by name. */
  services: readonly { id: string; name: string }[];
  /** What a change keeps: the status filter and the sort, exactly as they are in the URL. */
  preserve: Readonly<Record<string, string>>;
  /** Any of this form's own filters is set, so "Clear filters" has something to clear. */
  canClear: boolean;
}

interface Fields {
  q: string;
  serviceId: string;
  submittedFrom: string;
  submittedTo: string;
}

/**
 * The queue's search and filters (FR-023). Typing in the search box reloads the list shortly after
 * the last key; the service and the dates reload it at once. Every change lands in the URL (D-40),
 * on page 1, with the status and sort kept, so the result can be bookmarked and the back button
 * works. It is also a plain `GET` form, so it still works without JavaScript: the button submits it.
 */
export function RequestQueueFilters({
  q,
  serviceId,
  submittedFrom,
  submittedTo,
  services,
  preserve,
  canClear,
}: RequestQueueFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [text, setText] = useDraft(q ?? "");
  const [service, setService] = useDraft(serviceId ?? "");
  const [from, setFrom] = useDraft(submittedFrom ?? "");
  const [to, setTo] = useDraft(submittedTo ?? "");

  // The timer fires later than the render that started it, so it reads the fields from here, which
  // always holds the latest.
  const latest = useRef<Fields>({
    q: text,
    serviceId: service,
    submittedFrom: from,
    submittedTo: to,
  });
  useEffect(() => {
    latest.current = { q: text, serviceId: service, submittedFrom: from, submittedTo: to };
  }, [text, service, from, to]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const rangeError = from !== "" && to !== "" && from > to;

  const apply = (fields: Fields) => {
    clearTimeout(timer.current);
    if (fields.submittedFrom !== "" && fields.submittedTo !== "") {
      if (fields.submittedFrom > fields.submittedTo) return;
    }
    const href = buildHref(QUEUE_PATH, preserve, {
      q: fields.q.trim(),
      serviceId: fields.serviceId,
      submittedFrom: fields.submittedFrom,
      submittedTo: fields.submittedTo,
    });
    startTransition(() => router.replace(href, { scroll: false }));
  };

  const change = (patch: Partial<Fields>, { wait }: { wait: boolean }) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    if (patch.q !== undefined) setText(patch.q);
    if (patch.serviceId !== undefined) setService(patch.serviceId);
    if (patch.submittedFrom !== undefined) setFrom(patch.submittedFrom);
    if (patch.submittedTo !== undefined) setTo(patch.submittedTo);

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
      action={QUEUE_PATH}
      role="search"
      aria-label="Search and filter requests"
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      {Object.entries(preserve).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <Field id="request-search" label="Search" className="min-w-0 sm:min-w-64 sm:flex-1">
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

      <Field id="request-service" label="Service" className="min-w-0 sm:w-48">
        {(control) => (
          <Select
            {...control}
            name="serviceId"
            value={service}
            onChange={(event) => change({ serviceId: event.target.value }, { wait: false })}
          >
            <option value="">All services</option>
            {services.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="request-from" label="Submitted from" className="min-w-0 sm:w-40">
        {(control) => (
          <DateInput
            {...control}
            name="submittedFrom"
            value={from}
            max={to === "" ? undefined : to}
            onChange={(event) => change({ submittedFrom: event.target.value }, { wait: false })}
          />
        )}
      </Field>

      <Field
        id="request-to"
        label="Submitted to"
        className="min-w-0 sm:w-40"
        error={rangeError ? "Choose a date on or after the start date." : undefined}
      >
        {(control) => (
          <DateInput
            {...control}
            name="submittedTo"
            value={to}
            min={from === "" ? undefined : from}
            onChange={(event) => change({ submittedTo: event.target.value }, { wait: false })}
          />
        )}
      </Field>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {canClear ? (
          <Button variant="ghost" asChild>
            <Link href={buildHref(QUEUE_PATH, preserve, {})}>
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
