"use client";

import {
  type AdminQuotationDto,
  dateOnlyInTimeZone,
  ErrorCode,
  isPositiveAmount,
  LIMITS,
  QuotationStatus,
} from "@fixflow/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Eye, Send, Trash2 } from "lucide-react";
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
  quotationFieldLabels,
  quotationFormSchema,
  type QuotationFormValues,
  quotationToFormValues,
  splitApiProblems,
  toUpdateBody,
} from "../lib/quotations";
import { adminRequestPath } from "../lib/requests-queue";
import { QuotationPageHeader } from "./quotation-page-header";
import { QuotationPreviewDialog } from "./quotation-preview-dialog";
import { QuotationTotalsCard } from "./quotation-totals-card";
import { QuotationVoidDialog } from "./quotation-void-dialog";

const STALE_MESSAGE =
  "This draft was changed somewhere else since you opened it (in another tab, or by a colleague). Your edits are still here, but they were not saved.";
const SAVE_FIRST_HINT = "Save your changes to preview or send.";
const NEEDS_TOTAL_HINT = "Add a price: a quotation needs a total above zero before it is sent.";

/**
 * The draft quotation editor (FR-040 to FR-043, UX-QB-QUO). It holds everything the admin can change
 * on a draft and keeps three things clearly apart:
 *
 * - **Save draft** (the bar at the foot) stores what is typed. The server works every total out again
 *   from the lines; the totals beside the form are only a preview of that, from the same shared
 *   calculation.
 * - **Preview** shows the customer's view of what is *saved*, so it is available when nothing is unsaved.
 * - **Send to customer** publishes it, after a confirmation that says it cannot be edited afterwards.
 *   It too waits for a saved draft, so the customer can only ever be sent exactly what the admin saw.
 *
 * Field errors from the API land beside their row and field (`lines.2.quantity`); what was typed is
 * kept after any failure; leaving with unsaved changes asks first; and a draft that someone else
 * changed meanwhile is never silently overwritten (`expectedUpdatedAt`, D-46).
 */
export function QuotationEditor({
  quotation,
  timeZone,
}: {
  quotation: AdminQuotationDto;
  timeZone: string;
}) {
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState(quotation.updatedAt);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [dialog, setDialog] = useState<"preview" | "send" | "void" | null>(null);

  const form = useForm<QuotationFormValues>({
    resolver: zodResolver(quotationFormSchema),
    defaultValues: quotationToFormValues(quotation),
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
  const taxRate = watched.taxRate ?? quotation.taxRate;
  const lineCount = watched.lines?.length ?? quotation.lines.length;
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
    if (isApiError(caught) && caught.code === ErrorCode.QUOTATION_NOT_EDITABLE) {
      setFormError("This quotation can no longer be edited. The page is being reloaded.");
      router.refresh();
      return;
    }
    if (isApiError(caught) && caught.fieldErrors !== undefined) {
      const { fields, banner } = splitApiProblems(caught.fieldErrors);
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
      const saved = await apiFetch<AdminQuotationDto>(
        `/admin/quotations/${encodeURIComponent(quotation.id)}`,
        { method: "PATCH", body: toUpdateBody(values, updatedAt) },
      );
      setUpdatedAt(saved.updatedAt);
      form.reset(quotationToFormValues(saved));
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
      const latest = await apiFetch<AdminQuotationDto>(
        `/admin/quotations/${encodeURIComponent(quotation.id)}`,
      );
      if (latest.status !== QuotationStatus.DRAFT) {
        router.refresh();
        return;
      }
      setUpdatedAt(latest.updatedAt);
      setConflict(false);
      form.reset(quotationToFormValues(latest));
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

  const send = async () => {
    try {
      await apiFetch<AdminQuotationDto>(
        `/admin/quotations/${encodeURIComponent(quotation.id)}/send`,
        { method: "POST", body: { expectedStatus: QuotationStatus.DRAFT } },
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
          ? "Someone else changed this quotation, so the page has been reloaded. Check it and try again."
          : describeApiError(caught),
        { cause: caught },
      );
    }
    toast.success(`${quotation.reference} was sent`, {
      description: `${quotation.customer.name} was notified in their portal.`,
    });
    router.refresh();
  };

  const headerActions = (
    <>
      <Button
        variant="outline"
        disabled={!savedClean}
        aria-describedby={savedClean ? undefined : "quotation-save-first"}
        onClick={() => setDialog("preview")}
      >
        <Eye aria-hidden="true" />
        Preview
      </Button>
      <Button
        disabled={!savedClean || !hasTotal}
        aria-describedby={
          savedClean ? (hasTotal ? undefined : "quotation-needs-total") : "quotation-save-first"
        }
        onClick={() => setDialog("send")}
      >
        <Send aria-hidden="true" />
        Send to customer…
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
            Void quotation
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
      <QuotationPageHeader quotation={quotation} timeZone={timeZone} actions={headerActions} />

      {!savedClean ? (
        <p id="quotation-save-first" className="text-sm font-medium text-attention">
          {SAVE_FIRST_HINT}
        </p>
      ) : !hasTotal ? (
        <p id="quotation-needs-total" className="text-sm text-ink-secondary">
          {NEEDS_TOTAL_HINT}
        </p>
      ) : null}

      <form
        noValidate
        aria-label="Quotation draft"
        className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <div className="flex min-w-0 flex-col gap-6 xl:col-start-1">
          <FormErrorSummary
            errors={errors}
            labels={quotationFieldLabels(lineCount)}
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
            </CardHeader>
            <CardContent>
              <LineItemsEditor
                control={form.control}
                currencyCode={quotation.currencyCode}
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
                One discount for the whole quotation, spread over the lines in proportion. Tax
                applies to the taxable lines.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="discountAmount"
                label={`Discount (${quotation.currencyCode})`}
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
                description="Filled in from your business settings when the draft was started. Changing it here changes only this quotation."
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
              <CardTitle as="h2">Validity, terms and note</CardTitle>
              <CardDescription>What the customer reads below the lines.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <FormField
                control={form.control}
                name="validUntil"
                label="Valid until"
                required
                description={`The customer can answer until the end of this day, in the ${timeZone} time zone.`}
                className="sm:max-w-xs"
              >
                {(field) => <DateInput {...field} min={today} disabled={isSubmitting} />}
              </FormField>
              <FormField
                control={form.control}
                name="terms"
                label="Terms"
                description="Shown to the customer. Filled in from your default terms; change them for this quotation if needed."
              >
                {(field) => (
                  <Textarea
                    {...field}
                    rows={5}
                    maxLength={LIMITS.businessSettings.quotationTerms.maxLength}
                    showCount
                    disabled={isSubmitting}
                  />
                )}
              </FormField>
              <FormField
                control={form.control}
                name="customerNote"
                label="Note for the customer"
                description="Optional. A personal line shown with the quotation, such as what the price assumes."
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
            currencyCode={quotation.currencyCode}
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

      <QuotationPreviewDialog
        open={dialog === "preview"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        quotationId={quotation.id}
        timeZone={timeZone}
      />

      <ConfirmDialog
        open={dialog === "send"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={`Send ${quotation.reference} to ${quotation.customer.name}?`}
        consequence={
          <div className="flex flex-col gap-2">
            <p>
              After sending, this quotation can&apos;t be edited. The customer will be able to
              accept or decline it until {formatDate(quotation.validUntil, timeZone)}.
            </p>
            <p>
              They are notified in their portal and by email. If something needs changing later, you
              can replace the quotation with a new draft or void it.
            </p>
          </div>
        }
        confirmLabel="Send to customer"
        cancelLabel="Not yet"
        onConfirm={send}
      />

      <QuotationVoidDialog
        open={dialog === "void"}
        onOpenChange={closeDialog}
        quotationId={quotation.id}
        reference={quotation.reference}
        status={QuotationStatus.DRAFT}
        customerName={quotation.customer.name}
        onVoided={() => {
          // The draft is gone from the working list; go back to the request so a new one can start.
          form.reset(form.getValues());
          router.push(adminRequestPath(quotation.requestId));
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
