"use client";

import {
  type AdminInvoiceDto,
  dateOnlyInTimeZone,
  ErrorCode,
  InvoiceStatus,
  isPositiveAmount,
  LIMITS,
} from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Eye, FileCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormAlert } from "@/components/forms/form-alert";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { applyApiFieldErrors } from "@/components/forms/form-errors";
import { FormField } from "@/components/forms/form-field";
import { FormSaveBar } from "@/components/forms/form-save-bar";
import { previewDocument } from "@/components/forms/line-items";
import { LineItemsEditor } from "@/components/forms/line-items-editor";
import { useUnsavedChangesGuard } from "@/components/forms/use-unsaved-changes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/formatting/datetime";
import { formatMoney } from "@/lib/formatting/money";

import {
  invoiceFieldLabels,
  invoiceFormSchema,
  type InvoiceFormValues,
  invoiceToFormValues,
  splitInvoiceApiProblems,
  toInvoiceUpdateBody,
} from "../lib/invoices";
import { adminJobPath } from "../lib/jobs";
import { InvoicePageHeader } from "./invoice-page-header";
import { InvoicePreviewDialog } from "./invoice-preview-dialog";
import { InvoiceVoidDialog } from "./invoice-void-dialog";
import { QuotationTotalsCard } from "./quotation-totals-card";

const STALE_MESSAGE =
  "This draft was changed somewhere else since you opened it (in another tab, or by a colleague). Your edits are still here, but they were not saved.";
const SAVE_FIRST_HINT = "Save your changes to preview or issue.";
const NEEDS_TOTAL_HINT = "Add a price: an invoice needs a total above zero before it is issued.";

/**
 * The draft invoice editor (FR-070, FR-071, UX-QB-INV). It holds everything the admin can change on a
 * draft, pre-filled from the quotation the customer accepted, and keeps three things clearly apart:
 *
 * - **Save draft** (the bar at the foot) stores what is typed. The server works every total out again
 *   from the lines; the totals beside the form are only a preview of that, from the same shared
 *   calculation. Extra parts or labour are added here as lines (C-11).
 * - **Preview** shows the saved draft as a document, so it is available when nothing is unsaved.
 * - **Issue invoice** gives it its number and locks it, after a confirmation that says corrections
 *   then need a void. It too waits for a saved draft, so the customer can only ever be sent exactly
 *   what the admin saw.
 *
 * Field errors from the API land beside their row and field (`lines.2.quantity`); what was typed is
 * kept after any failure; leaving with unsaved changes asks first; and a draft that someone else
 * changed meanwhile is never silently overwritten (`expectedUpdatedAt`, D-46).
 */
export function InvoiceEditor({
  invoice,
  timeZone,
}: {
  invoice: AdminInvoiceDto;
  timeZone: string;
}) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState(invoice.updatedAt);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [dialog, setDialog] = useState<"preview" | "issue" | "void" | null>(null);

  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: invoiceToFormValues(invoice),
    mode: "onTouched",
    shouldFocusError: false,
  });
  const { isDirty, isSubmitting, submitCount, errors } = form.formState;
  const guard = useUnsavedChangesGuard(isDirty && !isSubmitting);

  // The live preview: the shared calculation over what is typed right now.
  const watched = useWatch({ control: form.control });
  const preview = useMemo(
    () =>
      previewDocument({
        lines: (watched.lines ?? []).map((line) => ({
          description: line?.description ?? "",
          quantity: line?.quantity ?? "",
          unitPrice: line?.unitPrice ?? "",
          taxable: line?.taxable ?? true,
        })),
        discountAmount: watched.discountAmount ?? "",
        taxRate: watched.taxRate ?? "",
      }),
    [watched.lines, watched.discountAmount, watched.taxRate],
  );
  const taxRate = watched.taxRate ?? invoice.taxRate;
  const lineCount = watched.lines?.length ?? invoice.lines.length;
  const hasTotal = preview.totals !== null && isPositiveAmount(preview.totals.totalAmount);
  const today = dateOnlyInTimeZone(new Date(), timeZone);
  const savedClean = !isDirty && !isSubmitting;

  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const openingDialogFromMenu = useRef(false);

  /** One place for every way a request to the API can fail, so the form keeps what was typed. */
  const failWith = (caught: unknown) => {
    if (isApiError(caught) && caught.code === ErrorCode.STALE_STATE) {
      setConflict(true);
      setFormError(STALE_MESSAGE);
      return;
    }
    if (isApiError(caught) && caught.code === ErrorCode.INVOICE_NOT_EDITABLE) {
      setFormError("This invoice can no longer be edited. The page is being reloaded.");
      router.refresh();
      return;
    }
    if (isApiError(caught) && caught.fieldErrors !== undefined) {
      const { fields, banner } = splitInvoiceApiProblems(caught.fieldErrors);
      applyApiFieldErrors(form.setError, fields);
      setFormError(banner);
      return;
    }
    setFormError(describeApiError(caught));
  };

  const save = form.handleSubmit(async (values) => {
    setFormError(null);
    setConflict(false);
    try {
      const saved = await apiFetch<AdminInvoiceDto>(
        `/admin/invoices/${encodeURIComponent(invoice.id)}`,
        { method: "PATCH", body: toInvoiceUpdateBody(values, updatedAt) },
      );
      setUpdatedAt(saved.updatedAt);
      form.reset(invoiceToFormValues(saved));
      toast.success("Draft saved", {
        description: `The total is ${formatMoney(saved.totalAmount, saved.currencyCode)}, worked out from the saved lines.`,
      });
      router.refresh();
    } catch (caught) {
      failWith(caught);
    }
  });

  /** Throws away what was typed and loads the draft as it is stored now (after a conflict). */
  const loadLatest = async () => {
    setFormError(null);
    try {
      const latest = await apiFetch<AdminInvoiceDto>(
        `/admin/invoices/${encodeURIComponent(invoice.id)}`,
      );
      if (latest.status !== InvoiceStatus.DRAFT) {
        router.refresh();
        return;
      }
      setUpdatedAt(latest.updatedAt);
      setConflict(false);
      form.reset(invoiceToFormValues(latest));
      toast.info("Loaded the latest draft", { description: "Your unsaved edits were discarded." });
    } catch (caught) {
      setFormError(describeApiError(caught));
    }
  };

  const discard = () => {
    form.reset();
    setFormError(null);
    setConflict(false);
  };

  const issue = async () => {
    let issued: AdminInvoiceDto;
    try {
      issued = await apiFetch<AdminInvoiceDto>(
        `/admin/invoices/${encodeURIComponent(invoice.id)}/issue`,
        { method: "POST", body: { expectedStatus: InvoiceStatus.DRAFT } },
      );
    } catch (caught) {
      if (isApiError(caught) && caught.status === 422) {
        // The reasons belong beside the fields: close the dialog and show them there.
        failWith(caught);
        return;
      }
      if (isApiError(caught) && (caught.status === 404 || caught.status === 409)) {
        router.refresh();
      }
      throw new Error(
        isApiError(caught) && caught.code === ErrorCode.STALE_STATE
          ? "Someone else changed this invoice, so the page has been reloaded. Check it and try again."
          : describeApiError(caught),
        { cause: caught },
      );
    }
    toast.success(`Invoice ${issued.invoiceNumber ?? ""} was issued`.trim(), {
      description: `${invoice.customer.name} was notified in their portal and by email.`,
    });
    // The draft is gone: what was saved is now the issued invoice, so nothing is left to lose.
    form.reset(form.getValues());
    router.refresh();
  };

  const headerActions = (
    <>
      <Button
        variant="outline"
        disabled={!savedClean}
        aria-describedby={savedClean ? undefined : "invoice-save-first"}
        onClick={() => setDialog("preview")}
      >
        <Eye aria-hidden="true" />
        Preview
      </Button>
      <Button
        disabled={!savedClean || !hasTotal}
        aria-describedby={
          savedClean ? (hasTotal ? undefined : "invoice-needs-total") : "invoice-save-first"
        }
        onClick={() => setDialog("issue")}
      >
        <FileCheck aria-hidden="true" />
        Issue invoice…
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={menuTriggerRef} variant="outline" disabled={isSubmitting}>
            More actions
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          onCloseAutoFocus={(event) => {
            if (openingDialogFromMenu.current) {
              openingDialogFromMenu.current = false;
              event.preventDefault();
            }
          }}
        >
          <DropdownMenuItem
            destructive
            onSelect={() => {
              openingDialogFromMenu.current = true;
              setDialog("void");
            }}
          >
            <Trash2 aria-hidden="true" />
            Void invoice
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const closeDialog = (open: boolean) => {
    if (open) return;
    setDialog(null);
    // The menu item that opened the void dialog is gone; the menu's own button is the next best place.
    setTimeout(() => menuTriggerRef.current?.focus(), 0);
  };

  return (
    <>
      <InvoicePageHeader
        invoice={invoice}
        customerName={invoice.customer.name}
        timeZone={timeZone}
        actions={headerActions}
      />

      {!savedClean ? (
        <p id="invoice-save-first" className="text-sm font-medium text-attention">
          {SAVE_FIRST_HINT}
        </p>
      ) : !hasTotal ? (
        <p id="invoice-needs-total" className="text-sm text-ink-secondary">
          {NEEDS_TOTAL_HINT}
        </p>
      ) : null}

      <form
        noValidate
        aria-label="Invoice draft"
        className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <div className="flex min-w-0 flex-col gap-6 xl:col-start-1">
          <FormErrorSummary
            errors={errors}
            labels={invoiceFieldLabels(lineCount)}
            submitCount={submitCount}
          />
          {formError !== null ? (
            <FormAlert tone="error">
              {formError}
              {conflict ? (
                <>
                  {" "}
                  <Button variant="outline" size="sm" onClick={() => void loadLatest()}>
                    Load the latest version
                  </Button>
                </>
              ) : null}
            </FormAlert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle as="h2">Lines</CardTitle>
              <CardDescription>
                Filled in from the accepted quotation
                {invoice.quotation === null ? "" : ` ${invoice.quotation.reference}`}. Add the parts
                or extra labour used on{" "}
                <a
                  href={adminJobPath(invoice.job.id)}
                  className="font-medium text-brand underline-offset-4 hover:underline"
                >
                  {invoice.job.reference}
                </a>{" "}
                as more lines.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LineItemsEditor
                control={form.control}
                currencyCode={invoice.currencyCode}
                lineTotals={preview.lineTotals}
                legend={<span className="sr-only">Line items</span>}
                disabled={isSubmitting}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Discount and tax</CardTitle>
              <CardDescription>
                One discount for the whole invoice, spread over the lines in proportion. Tax applies
                to the taxable lines.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="discountAmount"
                label={`Discount (${invoice.currencyCode})`}
                description="A fixed amount, up to the subtotal. Enter 0 for none."
              >
                {(field) => (
                  <Input
                    {...field}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={isSubmitting}
                    className="tabular-nums"
                  />
                )}
              </FormField>
              <FormField
                control={form.control}
                name="taxRate"
                label="Tax rate (%)"
                description="Copied from the accepted quotation. Changing it here changes only this invoice."
              >
                {(field) => (
                  <Input
                    {...field}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={isSubmitting}
                    className="tabular-nums"
                  />
                )}
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Dates and note</CardTitle>
              <CardDescription>What the customer reads below the lines.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="issueDate"
                  label="Issue date"
                  description={`Leave empty to use the day you issue it (${formatDate(today, timeZone)} today, in the ${timeZone} time zone).`}
                >
                  {(field) => <DateInput {...field} disabled={isSubmitting} />}
                </FormField>
                <FormField
                  control={form.control}
                  name="dueDate"
                  label="Due date"
                  required
                  description="The invoice becomes overdue after the end of this day, in the business time zone."
                >
                  {(field) => <DateInput {...field} disabled={isSubmitting} />}
                </FormField>
              </div>
              <FormField
                control={form.control}
                name="customerNote"
                label="Note for the customer"
                description="Optional. A personal line shown on the invoice, such as a thank-you or a reference."
              >
                {(field) => (
                  <Textarea
                    {...field}
                    rows={3}
                    maxLength={LIMITS.notes.maxLength}
                    showCount
                    disabled={isSubmitting}
                  />
                )}
              </FormField>
            </CardContent>
          </Card>
        </div>

        <div className="xl:sticky xl:top-24 xl:col-start-2 xl:row-start-1">
          <QuotationTotalsCard
            totals={preview.totals}
            taxRate={taxRate}
            currencyCode={invoice.currencyCode}
          />
        </div>

        <FormSaveBar
          dirty={isDirty}
          saving={isSubmitting}
          onDiscard={discard}
          saveLabel="Save draft"
          savingText="Saving draft…"
          note={
            <>
              Last saved <time dateTime={updatedAt}>{formatDateTime(updatedAt, timeZone)}</time>.
            </>
          }
          className="xl:col-span-2"
        />
      </form>

      <InvoicePreviewDialog
        open={dialog === "preview"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        invoiceId={invoice.id}
        timeZone={timeZone}
      />

      <ConfirmDialog
        open={dialog === "issue"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={`Issue the invoice to ${invoice.customer.name}?`}
        consequence={
          <div className="flex flex-col gap-2">
            <p>
              This assigns invoice number INV-… and locks its contents. Corrections after issuing
              require voiding.
            </p>
            <p>
              {invoice.customer.name} is notified in their portal and by email. The business
              details, payment instructions and footer shown are frozen as they are now.
            </p>
          </div>
        }
        confirmLabel="Issue invoice"
        cancelLabel="Not yet"
        onConfirm={issue}
      />

      <InvoiceVoidDialog
        open={dialog === "void"}
        onOpenChange={closeDialog}
        invoiceId={invoice.id}
        label="the draft invoice"
        status={InvoiceStatus.DRAFT}
        wasIssued={false}
        customerName={invoice.customer.name}
        onVoided={() => {
          // The draft is gone from the working list; go back to the job so a new one can start.
          form.reset(form.getValues());
          router.push(adminJobPath(invoice.job.id));
        }}
        onConflict={() => {
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={guard.pendingHref !== null}
        onOpenChange={(open) => {
          if (!open) guard.stay();
        }}
        title="Leave without saving?"
        consequence="You have changes to this draft that haven't been saved. If you leave now, they will be lost."
        confirmLabel="Leave without saving"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          guard.leave();
        }}
      />
    </>
  );
}
