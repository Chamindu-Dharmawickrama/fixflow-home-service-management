"use client";

import {
  type CustomerQuotationDto,
  type DeclineQuotationBody,
  LIMITS,
  QuotationStatus,
} from "@fixflow/shared";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MoneyText } from "@/components/ui/money-text";
import { toast } from "@/components/ui/sonner";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import { requestPath } from "../lib/requests-list";

type Answer = typeof QuotationStatus.ACCEPTED | typeof QuotationStatus.DECLINED;

export interface QuotationDecisionProps {
  quotation: Pick<
    CustomerQuotationDto,
    "id" | "reference" | "status" | "serviceName" | "totalAmount" | "currencyCode" | "requestId"
  >;
  businessName: string;
}

/**
 * The customer's answer (FR-044, FR-045, workflow 7.3): **Accept quotation** and **Decline**, each
 * behind a confirmation that says what will happen and, for acceptance, that it records a decision
 * and is not a contract signature. The bar sticks to the foot of a phone's screen; from `lg` it is
 * an ordinary card after the document.
 *
 * Nothing is announced as done until the server has said so. A second click cannot send a second
 * answer (the dialog blocks while pending, and the server accepts one answer only). When the server
 * refuses because the quotation changed (it expired, was withdrawn, or was answered in another tab)
 * the page is reloaded so it shows the truth, and the reason is spelled out. The bar leaves when the
 * quotation is no longer open to an answer, whatever the page last said.
 */
export function QuotationDecision({ quotation, businessName }: QuotationDecisionProps) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [answered, setAnswered] = useState<Answer | null>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);

  // The bar is gone once the answer is recorded; keyboard and screen-reader users land on what replaced it.
  useEffect(() => {
    if (answered !== null) {
      confirmationRef.current?.focus();
    }
  }, [answered]);

  if (quotation.status !== QuotationStatus.SENT && answered === null) {
    return null;
  }

  const answer = async (action: "accept" | "decline", body: DeclineQuotationBody | undefined) => {
    try {
      await apiFetch<CustomerQuotationDto>(
        `/quotations/${encodeURIComponent(quotation.id)}/${action}`,
        { method: "POST", body: body ?? {} },
      );
    } catch (caught) {
      const message = describeApiError(caught);
      if (isApiError(caught) && (caught.status === 404 || caught.status === 409)) {
        // It changed under the page: say why, in words that stay, and show it as it is now.
        toast.error(message);
        router.refresh();
      }
      throw new Error(message, { cause: caught });
    }
    setAnswered(action === "accept" ? QuotationStatus.ACCEPTED : QuotationStatus.DECLINED);
    router.refresh();
  };

  return (
    <>
      {answered === null ? (
        <section
          aria-labelledby="quotation-decision-heading"
          data-testid="quotation-decision"
          className="sticky bottom-0 z-20 -mx-4 flex flex-col gap-3 border-t border-border bg-surface px-4 py-3 shadow-lg sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:gap-4 lg:rounded-xl lg:border lg:p-6 lg:shadow-sm print:hidden"
        >
          <div className="flex flex-col gap-0.5">
            <h2
              id="quotation-decision-heading"
              className="text-base font-semibold text-ink lg:text-lg"
            >
              Your decision
            </h2>
            <p className="text-sm text-ink-secondary">
              Total{" "}
              <MoneyText
                amount={quotation.totalAmount}
                currencyCode={quotation.currencyCode}
                className="font-semibold text-ink"
              />
              . Nothing is scheduled until you accept.
            </p>
          </div>
          <div className="flex gap-3">
            <Button size="lg" className="flex-1 sm:flex-none" onClick={() => setAccepting(true)}>
              Accept quotation
            </Button>
            <Button size="lg" variant="outline" onClick={() => setDeclining(true)}>
              Decline
            </Button>
          </div>
        </section>
      ) : (
        <div
          ref={confirmationRef}
          tabIndex={-1}
          role="status"
          data-testid="quotation-confirmation"
          className="flex items-start gap-3 rounded-xl border border-success-edge bg-success-soft p-5 outline-none focus-visible:ring-2 focus-visible:ring-focus print:hidden"
        >
          <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-ink">
                {answered === QuotationStatus.ACCEPTED
                  ? "Thank you — your acceptance is recorded"
                  : "Your answer is recorded"}
              </h2>
              <p className="text-sm text-ink-secondary">
                {answered === QuotationStatus.ACCEPTED
                  ? `We've let ${businessName} know. We'll contact you to schedule the work.`
                  : `We've let ${businessName} know. No work will be scheduled from this quotation. You can send a new request any time.`}
              </p>
            </div>
            <div>
              <Link
                href={requestPath(quotation.requestId)}
                className={buttonVariants({ variant: "outline" })}
              >
                Back to your request
              </Link>
            </div>
          </div>
        </div>
      )}

      {/*
        The dialogs leave in the same render that replaces the bar. While one is open, its focus
        trap would pull focus back inside it and then drop it on the page as it unmounted; leaving
        with the bar lets the focus set on the confirmation stand.
      */}
      {answered === null ? (
        <>
          <ConfirmDialog
            open={accepting}
            onOpenChange={setAccepting}
            title={`Accept ${quotation.reference}?`}
            consequence={
              <div className="flex flex-col gap-2">
                <p>
                  You are accepting the quotation for {quotation.serviceName}, with a total of{" "}
                  <strong className="text-ink">
                    <MoneyText
                      amount={quotation.totalAmount}
                      currencyCode={quotation.currencyCode}
                    />
                  </strong>
                  .
                </p>
                <p>What happens next: we&apos;ll contact you to schedule the work.</p>
                <p>
                  This records your acceptance; it is not a contract signature. You can&apos;t
                  change your answer afterwards.
                </p>
              </div>
            }
            confirmLabel="Accept quotation"
            cancelLabel="Go back"
            onConfirm={() => answer("accept", undefined)}
          />
          <ConfirmDialog
            open={declining}
            onOpenChange={setDeclining}
            title={`Decline ${quotation.reference}?`}
            consequence={
              <div className="flex flex-col gap-2">
                <p>
                  No work will be scheduled from this quotation. You can send a new request any
                  time.
                </p>
                <p>You can&apos;t change your answer afterwards.</p>
              </div>
            }
            confirmLabel="Decline quotation"
            cancelLabel="Go back"
            destructive
            secondary={{
              label: "Help us improve — why are you declining?",
              maxLength: LIMITS.reason.maxLength,
              description: `Optional. ${businessName} reads this.`,
            }}
            onConfirm={(_reason, why) =>
              answer("decline", why === undefined ? undefined : { reason: why })
            }
          />
        </>
      ) : null}
    </>
  );
}
