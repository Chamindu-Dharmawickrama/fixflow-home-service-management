"use client";

import { ADMIN_CUSTOMER_SORT_FIELDS, type AdminCustomerSortField } from "@fixflow/shared";
import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useTransition } from "react";

import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { buildHref } from "@/lib/url";

import { CUSTOMERS_PATH, defaultOrder, type SortOrder } from "../lib/customers";
import { SEARCH_DEBOUNCE_MS, useDraft } from "../lib/use-draft";

export { SEARCH_DEBOUNCE_MS };

const SORT_LABELS: Record<AdminCustomerSortField, string> = {
  name: "Name",
  lastActivityAt: "Last activity",
  createdAt: "Customer since",
};

const ORDER_CHOICES: Record<AdminCustomerSortField, { asc: string; desc: string }> = {
  name: { asc: "A to Z", desc: "Z to A" },
  lastActivityAt: { asc: "Oldest first", desc: "Latest first" },
  createdAt: { asc: "Oldest first", desc: "Newest first" },
};

export interface CustomerSearchProps {
  /** The committed search, from the URL. */
  q: string | undefined;
  sort: AdminCustomerSortField;
  order: SortOrder;
  /** A search is applied, so "Clear search" has something to clear. */
  canClear: boolean;
}

interface Fields {
  q: string;
  sort: AdminCustomerSortField;
  order: SortOrder;
}

/**
 * The directory's search and sort (FR-031). Typing in the search box reloads the list shortly after
 * the last key; the sort reloads it at once. Every change lands in the URL (D-40), on page 1, so the
 * result can be bookmarked and the back button works. It is also a plain `GET` form, so it still
 * works without JavaScript: the button submits it. The sort here is what a phone shows, where the
 * list is cards with no column headers to press.
 */
export function CustomerSearch({ q, sort, order, canClear }: CustomerSearchProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [text, setText] = useDraft(q ?? "");

  // The timer fires later than the render that started it, so it reads the fields from here, which
  // always holds the latest.
  const latest = useRef<Fields>({ q: text, sort, order });
  useEffect(() => {
    latest.current = { q: text, sort, order };
  }, [text, sort, order]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const apply = (fields: Fields) => {
    clearTimeout(timer.current);
    const custom = fields.sort !== "name" || fields.order !== "asc";
    const href = buildHref(
      CUSTOMERS_PATH,
      {},
      {
        q: fields.q.trim(),
        // The default sort stays out of the address, so it does not collect values that mean nothing.
        sort: custom ? fields.sort : null,
        order: custom ? fields.order : null,
      },
    );
    startTransition(() => router.replace(href, { scroll: false }));
  };

  const change = (patch: Partial<Fields>, { wait }: { wait: boolean }) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    if (patch.q !== undefined) setText(patch.q);

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
      action={CUSTOMERS_PATH}
      role="search"
      aria-label="Search customers"
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <Field id="customer-search" label="Search" className="min-w-0 sm:min-w-64 sm:flex-1">
        {(control) => (
          <Input
            {...control}
            name="q"
            type="search"
            value={text}
            onChange={(event) => change({ q: event.target.value }, { wait: true })}
            placeholder="Name, email or phone"
            autoComplete="off"
            maxLength={100}
          />
        )}
      </Field>

      <Field id="customer-sort" label="Sort by" className="min-w-0 sm:w-44">
        {(control) => (
          <Select
            {...control}
            name="sort"
            value={sort}
            onChange={(event) => {
              const field = ADMIN_CUSTOMER_SORT_FIELDS.find(
                (candidate) => candidate === event.target.value,
              );
              if (field !== undefined) {
                // A new column starts the way it is read; the order control below changes it.
                change({ sort: field, order: defaultOrder(field) }, { wait: false });
              }
            }}
          >
            {ADMIN_CUSTOMER_SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {SORT_LABELS[field]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="customer-order" label="Order" className="min-w-0 sm:w-40">
        {(control) => (
          <Select
            {...control}
            name="order"
            value={order}
            onChange={(event) =>
              change({ order: event.target.value === "desc" ? "desc" : "asc" }, { wait: false })
            }
          >
            <option value="asc">{ORDER_CHOICES[sort].asc}</option>
            <option value="desc">{ORDER_CHOICES[sort].desc}</option>
          </Select>
        )}
      </Field>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {canClear ? (
          <Button variant="ghost" asChild>
            <Link
              href={buildHref(
                CUSTOMERS_PATH,
                {},
                sort !== "name" || order !== "asc" ? { sort, order } : {},
              )}
            >
              <X aria-hidden="true" />
              Clear search
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
