import { type CustomerQuotationDto, QuotationStatus } from "@fixflow/shared";
import { CircleCheck, Clock, Info, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DateTimeText } from "@/components/ui/date-time-text";
import { cn } from "@/lib/utils";

import {
  daysUntilValidUntil,
  isRunningOut,
  portalQuotationPath,
  remainingDaysText,
} from "../lib/quotations";
import { requestPath } from "../lib/requests-list";

const TONES = {
  info: { box: "border-info-edge bg-info-soft", icon: "text-info", Icon: Info },
  attention: {
    box: "border-attention-edge bg-attention-soft",
    icon: "text-attention",
    Icon: Clock,
  },
  success: { box: "border-success-edge bg-success-soft", icon: "text-success", Icon: CircleCheck },
  neutral: { box: "border-neutral-edge bg-neutral-soft", icon: "text-neutral", Icon: Info },
} as const satisfies Record<string, { box: string; icon: string; Icon: LucideIcon }>;

function Banner({
  tone,
  headline,
  children,
}: {
  tone: keyof typeof TONES;
  headline: ReactNode;
  children?: ReactNode;
}) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div
      role="status"
      data-testid="quotation-banner"
      data-tone={tone}
      className={cn("flex items-start gap-3 rounded-xl border p-4 print:hidden", box)}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", icon)} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-base font-semibold break-words text-ink">{headline}</p>
        {children === undefined ? null : (
          <div className="text-sm text-ink-secondary">{children}</div>
        )}
      </div>
    </div>
  );
}

const LINK = "font-medium text-brand underline underline-offset-4 hover:text-brand-hover";

/** The business's phone and email as links, for a customer who needs to talk to someone. */
function ContactUs({ business }: { business: CustomerQuotationDto["business"] }) {
  return (
    <>
      Call{" "}
      <a
        href={`tel:${business.phone.replace(/[^\d+]/g, "")}`}
        className={cn(LINK, "whitespace-nowrap")}
      >
        {business.phone}
      </a>{" "}
      or email{" "}
      <a href={`mailto:${business.email}`} className={cn(LINK, "break-words")}>
        {business.email}
      </a>
      .
    </>
  );
}

export interface QuotationBannerProps {
  quotation: CustomerQuotationDto;
  /** The business time zone, from the settings. */
  timeZone: string;
  /** When the page is drawn: how many days are left is measured from it. */
  now: Date;
}

/**
 * Where the quotation stands, in a sentence the customer can act on (UX-INT-04): how long they have
 * to answer, what they did and when, or what to do when it has expired or been withdrawn. The words
 * are the customer's own ("You accepted…"); nothing internal is in the data this reads.
 */
export function QuotationBanner({ quotation, timeZone, now }: QuotationBannerProps) {
  const validUntil = <DateTimeText value={quotation.validUntil} timeZone={timeZone} />;
  const answeredOn =
    quotation.respondedAt === null ? null : (
      <DateTimeText value={quotation.respondedAt} timeZone={timeZone} display="date" />
    );

  switch (quotation.status) {
    case QuotationStatus.SENT: {
      const days = daysUntilValidUntil(quotation.validUntil, now, timeZone);
      return (
        <Banner
          tone={isRunningOut(days) ? "attention" : "info"}
          headline={
            <>
              Valid until {validUntil} — {remainingDaysText(days)}
            </>
          }
        >
          Read the quotation below, then accept or decline it. Nothing is scheduled until you
          accept.
        </Banner>
      );
    }
    case QuotationStatus.ACCEPTED:
      return (
        <Banner
          tone="success"
          headline={<>You accepted this quotation{answeredOn ? <> on {answeredOn}</> : null}</>}
        >
          Thank you. We&apos;ll contact you to schedule the work.
        </Banner>
      );
    case QuotationStatus.DECLINED:
      return (
        <Banner
          tone="neutral"
          headline={<>You declined this quotation{answeredOn ? <> on {answeredOn}</> : null}</>}
        >
          No work will be scheduled. If you change your mind,{" "}
          <ContactUs business={quotation.business} />
        </Banner>
      );
    case QuotationStatus.EXPIRED:
      return (
        <Banner
          tone="attention"
          headline="This quotation has expired — contact us for an updated quote"
        >
          It was valid until {validUntil}. <ContactUs business={quotation.business} />
        </Banner>
      );
    case QuotationStatus.VOID:
      return (
        <Banner tone="neutral" headline="This quotation was withdrawn">
          {quotation.replacedBy === null ? (
            <>
              It can no longer be accepted.{" "}
              <Link href={requestPath(quotation.requestId)} className={LINK}>
                Check your request
              </Link>{" "}
              for an updated quotation, or <ContactUs business={quotation.business} />
            </>
          ) : (
            <>
              We&apos;ve sent you a new quotation to replace it.{" "}
              <Link href={portalQuotationPath(quotation.replacedBy.id)} className={LINK}>
                Review {quotation.replacedBy.reference}
              </Link>
              .
            </>
          )}
        </Banner>
      );
    default:
      return null;
  }
}
