"use client";

import {
  type AdminInvoiceDto,
  InvoiceAction,
  type InvoicePaymentDto,
  PaymentRecordState,
} from "@fixflow/shared";
import { Ban, Banknote } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DateTimeText } from "@/components/ui/date-time-text";
import { MoneyText } from "@/components/ui/money-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/formatting/datetime";
import { formatMoney } from "@/lib/formatting/money";
import { cn } from "@/lib/utils";

import { RecordPaymentDialog } from "./record-payment-dialog";
import { VoidPaymentDialog } from "./void-payment-dialog";

interface PanelProps {
  invoice: AdminInvoiceDto;
  timeZone: string;
}

function Figure({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-border px-4 py-3",
        emphasis ? "bg-surface-muted" : "bg-surface",
      )}
    >
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 break-words tabular-nums text-ink",
          emphasis ? "text-xl font-semibold" : "text-base font-medium",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * The money received against an issued invoice, kept clearly apart from the invoice itself (spec
 * §10.3, UX-QB-INV): what is owed, what has been recorded and what is left, then every payment ever
 * recorded, voided ones included with their reason. FixFlow takes no money: staff record what they
 * received elsewhere, and every word here says "recorded". The server decides which buttons exist
 * (`availableActions`); this offers exactly those.
 */
export function InvoicePaymentsPanel({ invoice, timeZone }: PanelProps) {
  const router = useRouter();
  const recordButton = useRef<HTMLButtonElement>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [voiding, setVoiding] = useState<InvoicePaymentDto | null>(null);

  const canRecord = invoice.availableActions.includes(InvoiceAction.RECORD_PAYMENT);
  const canVoidPayment = invoice.availableActions.includes(InvoiceAction.VOID_PAYMENT);
  const payments = invoice.payments;
  const refresh = () => router.refresh();

  const columns: DataTableColumn<InvoicePaymentDto>[] = [
    {
      id: "paymentDate",
      header: "Date received",
      primary: true,
      cell: (payment) => (
        <DateTimeText
          value={payment.paymentDate}
          timeZone={timeZone}
          className={cn(payment.voided !== null && "text-ink-secondary")}
        />
      ),
    },
    {
      id: "method",
      header: "Method",
      cell: (payment) => payment.methodLabel,
    },
    {
      id: "reference",
      header: "Reference",
      cell: (payment) =>
        payment.reference === null && payment.notes === null ? (
          <span className="text-ink-muted">None</span>
        ) : (
          <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
            {payment.reference === null ? null : <span>{payment.reference}</span>}
            {payment.notes === null ? null : (
              <span className="text-xs text-ink-secondary">Note: {payment.notes}</span>
            )}
          </span>
        ),
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cell: (payment) => (
        <MoneyText
          amount={payment.amount}
          currencyCode={invoice.currencyCode}
          className={cn(
            "font-medium",
            payment.voided !== null && "text-ink-secondary line-through",
          )}
        />
      ),
    },
    {
      id: "recordedBy",
      header: "Recorded by",
      cell: (payment) => (
        <span className="[overflow-wrap:anywhere]">
          {payment.recordedBy === null ? "Unknown" : payment.recordedBy.name}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (payment) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge
            kind="payment"
            status={payment.voided === null ? PaymentRecordState.RECORDED : PaymentRecordState.VOID}
          />
          {payment.voided === null ? null : (
            <span className="text-xs text-ink-secondary [overflow-wrap:anywhere]">
              Voided <DateTimeText value={payment.voided.at} timeZone={timeZone} display="date" />
              {payment.voided.by === null ? "" : ` by ${payment.voided.by.name}`}. Reason:{" "}
              {payment.voided.reason}
            </span>
          )}
        </span>
      ),
    },
    ...(canVoidPayment
      ? [
          {
            id: "actions",
            header: "Actions",
            cell: (payment: InvoicePaymentDto) =>
              payment.voided === null ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setVoiding(payment)}
                  aria-label={`Void the ${formatMoney(payment.amount, invoice.currencyCode)} payment received on ${formatDate(payment.paymentDate, timeZone)}`}
                >
                  <Ban aria-hidden="true" />
                  Void…
                </Button>
              ) : null,
          } satisfies DataTableColumn<InvoicePaymentDto>,
        ]
      : []),
  ];

  const settled = invoice.balanceDue === "0.00";

  return (
    <Card className="print:hidden" data-testid="invoice-payments">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle as="h2">Payments received</CardTitle>
          <CardDescription>
            Money you received outside FixFlow and recorded here, separate from the invoice itself.
            FixFlow does not collect or check payments.
          </CardDescription>
        </div>
        {canRecord ? (
          <Button
            ref={recordButton}
            type="button"
            className="shrink-0 self-start"
            onClick={() => setRecordOpen(true)}
          >
            <Banknote aria-hidden="true" />
            Record payment
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl
          aria-label="Payment summary"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          data-testid="payment-summary"
        >
          <Figure label="Total">
            <MoneyText amount={invoice.totalAmount} currencyCode={invoice.currencyCode} />
          </Figure>
          <Figure label="Paid">
            <MoneyText amount={invoice.amountPaid} currencyCode={invoice.currencyCode} />
          </Figure>
          <Figure label="Balance due" emphasis>
            <MoneyText amount={invoice.balanceDue} currencyCode={invoice.currencyCode} />
            {settled ? (
              <span className="mt-0.5 block text-sm font-normal text-success">Paid in full</span>
            ) : null}
          </Figure>
        </dl>

        {payments.length === 0 ? (
          <div
            data-testid="payments-empty"
            className="flex items-start gap-3 rounded-lg border border-dashed border-border-strong px-4 py-5 text-sm text-ink-secondary"
          >
            <Banknote aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ink-muted" />
            <p className="min-w-0 [overflow-wrap:anywhere]">
              {canRecord
                ? `No payments recorded yet. When ${invoice.customer.name} pays you outside FixFlow, record it here so the balance stays right.`
                : "No payments were recorded against this invoice."}
            </p>
          </div>
        ) : (
          <DataTable
            caption="Payments recorded against this invoice"
            columns={columns}
            rows={payments}
            getRowId={(payment) => payment.id}
            breakpoint="lg"
          />
        )}
      </CardContent>

      {canRecord ? (
        <RecordPaymentDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          returnFocusTo={recordButton}
          timeZone={timeZone}
          invoice={{
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber ?? "this invoice",
            customerName: invoice.customer.name,
            currencyCode: invoice.currencyCode,
            balanceDue: invoice.balanceDue,
          }}
          onRecorded={refresh}
          onStale={refresh}
        />
      ) : null}
      {canVoidPayment ? (
        <VoidPaymentDialog
          open={voiding !== null}
          onOpenChange={(next) => {
            if (!next) setVoiding(null);
          }}
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber ?? "this invoice"}
          customerName={invoice.customer.name}
          currencyCode={invoice.currencyCode}
          balanceDue={invoice.balanceDue}
          payment={voiding}
          paymentDateLabel={voiding === null ? "" : formatDate(voiding.paymentDate, timeZone)}
          onVoided={() => {
            setVoiding(null);
            refresh();
          }}
          // The dialog stays open to say what happened; the reload shows the invoice as it is now.
          onConflict={refresh}
        />
      ) : null}
    </Card>
  );
}
