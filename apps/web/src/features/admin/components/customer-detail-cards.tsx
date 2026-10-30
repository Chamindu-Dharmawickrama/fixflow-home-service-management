import type { AdminCustomerSummaryDto, ServiceAddressDto } from "@fixflow/shared";
import { Briefcase, Inbox, Mail, MapPin, Phone, Receipt, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyText } from "@/components/ui/money-text";
import { StatCard } from "@/components/ui/stat-card";

import { adminCustomerTabPath, isZeroAmount } from "../lib/customers";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The ways to reach the customer, as links the device knows what to do with (FR-030). */
export function CustomerContactLinks({ email, phone }: { email: string; phone: string | null }) {
  return (
    <>
      <a
        href={`mailto:${email}`}
        className="inline-flex min-h-6 items-center gap-2 break-all font-medium text-brand underline-offset-4 hover:underline"
      >
        <Mail aria-hidden="true" className="size-4 shrink-0" />
        <span>
          <span className="sr-only">Email</span> {email}
        </span>
      </a>
      {phone ? (
        <a
          href={`tel:${phone}`}
          className="inline-flex min-h-6 items-center gap-2 font-medium text-brand underline-offset-4 hover:underline"
        >
          <Phone aria-hidden="true" className="size-4 shrink-0" />
          <span>
            <span className="sr-only">Call</span> {phone}
          </span>
        </a>
      ) : (
        <span>No phone number given</span>
      )}
    </>
  );
}

/**
 * The three figures a glance at a customer is for: how many requests they have made, how many jobs
 * are still open, and what they still owe. Each leads to the records behind it (UX-03).
 */
export function CustomerSummary({
  customerId,
  summary,
}: {
  customerId: string;
  summary: AdminCustomerSummaryDto;
}) {
  const owes = !isZeroAmount(summary.outstandingBalance);

  return (
    <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        label="Requests"
        icon={Inbox}
        value={summary.requestCount}
        context={plural(summary.quotationCount, "quotation", "quotations")}
        href={adminCustomerTabPath(customerId, "requests")}
      />
      <StatCard
        label="Open jobs"
        icon={Briefcase}
        value={summary.openJobCount}
        context={`${summary.jobCount} in total`}
        href={adminCustomerTabPath(customerId, "jobs")}
      />
      <StatCard
        label="Outstanding balance"
        icon={Receipt}
        tone={owes ? "attention" : "default"}
        value={
          <MoneyText amount={summary.outstandingBalance} currencyCode={summary.currencyCode} />
        }
        context={
          owes
            ? `Still to be paid, across ${plural(summary.invoiceCount, "invoice", "invoices")}`
            : plural(summary.invoiceCount, "invoice", "invoices")
        }
        href={adminCustomerTabPath(customerId, "invoices")}
      />
    </section>
  );
}

/** Every address the customer saved, the default first, with the access notes the team needs on site. */
export function CustomerAddressesCard({ addresses }: { addresses: readonly ServiceAddressDto[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Service addresses</CardTitle>
        <CardDescription>
          Where the team goes for this customer. Access notes are for the visit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {addresses.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            No address saved yet. Each request still carries the address it was sent for.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {addresses.map((address) => (
              <li
                key={address.id}
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <MapPin aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
                  <h3 className="text-sm font-semibold text-ink">{address.label}</h3>
                  {address.isDefault ? (
                    <Badge tone="brand">
                      <Star aria-hidden="true" />
                      Default
                    </Badge>
                  ) : null}
                </div>
                <address className="break-words text-sm not-italic text-ink">
                  {address.line1}
                  {address.line2 ? <>, {address.line2}</> : null}
                  <br />
                  {address.city}
                  {address.region ? `, ${address.region}` : ""} {address.postalCode}
                </address>
                {address.accessNotes ? (
                  <p className="whitespace-pre-line break-words text-sm text-ink-secondary">
                    <span className="font-medium text-ink">Access notes: </span>
                    {address.accessNotes}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
