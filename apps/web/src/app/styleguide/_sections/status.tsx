import { Badge } from "@/components/ui/badge";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge } from "@/components/ui/status-badge";
import { STATUS_META, STATUS_TONES, type StatusKind } from "@/lib/formatting/status";

import { Section, Specimen } from "../_lib/section";

const KIND_TITLES: Record<StatusKind, string> = {
  request: "Service request",
  quotation: "Quotation",
  workOrder: "Work order (job)",
  invoice: "Invoice",
  payment: "Payment record",
  notification: "Notification",
  emailDelivery: "Email delivery (staff only)",
  service: "Service in the catalogue (staff only)",
};

const TONE_MEANING = {
  info: "New, queued or waiting on someone",
  attention: "Someone needs to act, or a decision is pending",
  success: "A positive outcome",
  danger: "A problem, or an overdue balance",
  neutral: "Closed, terminal, draft or void",
} as const;

const KINDS = Object.keys(KIND_TITLES) as StatusKind[];

export function StatusSection() {
  return (
    <Section
      id="status"
      title="Status badges"
      description="Every status is a label, an icon and a tone, taken from one mapping, so the same status looks the same on every screen. The same word can mean different things on different records (Accepted on a request or on a quotation), which is why a badge is always told which kind of record it describes."
    >
      <Specimen title="Tones">
        <ul className="flex flex-col gap-3">
          {STATUS_TONES.map((tone) => (
            <li key={tone} className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone={tone} className="w-24 justify-center capitalize">
                {tone}
              </Badge>
              <span className="text-ink-secondary">{TONE_MEANING[tone]}</span>
            </li>
          ))}
        </ul>
      </Specimen>

      {KINDS.map((kind) => (
        <Specimen key={kind} title={`${KIND_TITLES[kind]} (kind="${kind}")`}>
          <ScrollRegion label={`Status mapping for ${KIND_TITLES[kind]}`}>
            <table className="w-full min-w-160 border-collapse text-left text-sm">
              <caption className="sr-only">Status mapping for {KIND_TITLES[kind]}</caption>
              <thead className="text-xs text-ink-secondary">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Badge
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Value
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Tone
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    What it means
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(STATUS_META[kind]).map(([value, meta]) => (
                  <tr key={value}>
                    <td className="py-2.5 pr-4">
                      <StatusBadge kind={kind} status={value as never} />
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-ink-secondary">{value}</td>
                    <td className="py-2.5 pr-4 text-xs text-ink-secondary">{meta.tone}</td>
                    <td className="py-2.5 text-ink-secondary">{meta.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </Specimen>
      ))}

      <Specimen title="Without the icon (dense tables) and the generic Badge">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge kind="invoice" status="OVERDUE" showIcon={false} />
          <StatusBadge kind="workOrder" status="IN_PROGRESS" showIcon={false} />
          <Badge tone="brand">Air conditioning</Badge>
          <Badge tone="neutral">3 technicians</Badge>
        </div>
      </Specimen>
    </Section>
  );
}
