"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { ReferenceText } from "@/components/ui/reference-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { REQUEST_SERVICE_PATH } from "@/features/marketing/lib/request-service";

import { REQUESTS_PATH } from "../lib/requests-list";

/** What happens after a request is sent, in the order it happens (spec §7.1 to §7.4). */
const NEXT_STEPS = [
  "We review your request and may contact you if we need more detail.",
  "We send you a written quotation. You choose whether to accept or decline it.",
  "If you accept, we agree a time with you and carry out the work.",
] as const;

/**
 * The confirmation shown after a request is sent (spec §7.1 step 6): the reference, the status and
 * what happens next. It takes focus when it appears, so a screen-reader user hears that the request
 * went through instead of finding a page that looks like any other. It says nothing about email: the
 * server cannot promise that one arrives.
 */
export function RequestConfirmation({ reference }: { reference: string }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="request-sent-heading"
      className="flex flex-col gap-5 rounded-xl border border-success-edge bg-success-soft p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-success" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id="request-sent-heading"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Your request has been sent
          </h2>
          <p className="text-sm text-ink-secondary">
            Thank you. Your reference is{" "}
            <ReferenceText reference={reference} className="text-ink" />. Keep it handy if you
            contact us about this request.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
        <span className="font-medium">Status</span>
        <StatusBadge kind="request" status="SUBMITTED" />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink">What happens next</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-secondary">
          {NEXT_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href={REQUESTS_PATH} className={buttonVariants({ variant: "outline" })}>
          View all my requests
        </Link>
        <Link href={REQUEST_SERVICE_PATH} className={buttonVariants({ variant: "ghost" })}>
          Request another service
        </Link>
      </div>
    </section>
  );
}
