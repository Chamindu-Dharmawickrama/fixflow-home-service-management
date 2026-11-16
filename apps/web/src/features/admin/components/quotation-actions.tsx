"use client";

import {
  type AdminQuotationDto,
  ErrorCode,
  QuotationAction,
  QuotationStatus,
} from "@fixflow/shared";
import { ChevronDown, FilePen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PrintButton } from "@/components/ui/print-button";
import { toast } from "@/components/ui/sonner";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import { adminQuotationPath } from "../lib/quotations";
import { CreateJobButton } from "./create-job-button";
import { QuotationVoidDialog } from "./quotation-void-dialog";

/**
 * What the admin can do to a quotation that is no longer a draft (FR-046, D-43): print it, replace a
 * sent one with a new draft, or void it. Only what the server lists in `availableActions` is offered.
 * Replacing is the one way to change a sent offer, and it is safe to start: the new draft is only
 * sent when the admin says so, and until then the old quotation stays the live one.
 */
export function QuotationActions({
  quotation,
}: {
  quotation: Pick<
    AdminQuotationDto,
    "id" | "reference" | "status" | "requestId" | "customer" | "availableActions"
  >;
}) {
  const router = useRouter();
  const [replacing, setReplacing] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const openingDialogFromMenu = useRef(false);

  const canReplace = quotation.availableActions.includes(QuotationAction.REPLACE);
  const canCreateJob = quotation.availableActions.includes(QuotationAction.CREATE_WORK_ORDER);
  const canVoid =
    quotation.availableActions.includes(QuotationAction.VOID) &&
    (quotation.status === QuotationStatus.DRAFT || quotation.status === QuotationStatus.SENT);

  const replace = async () => {
    setReplacing(true);
    setError(null);
    try {
      const draft = await apiFetch<AdminQuotationDto>(
        `/admin/requests/${encodeURIComponent(quotation.requestId)}/quotations`,
        { method: "POST", body: { replacesQuotationId: quotation.id } },
      );
      router.push(adminQuotationPath(draft.id));
      return;
    } catch (caught) {
      if (isApiError(caught) && caught.code === ErrorCode.DRAFT_EXISTS) {
        const existing = caught.details?.quotationId;
        if (typeof existing === "string") {
          toast.info("This request already has a draft", {
            description: "Opening it so you can carry on.",
          });
          router.push(adminQuotationPath(existing));
          return;
        }
      }
      if (isApiError(caught) && (caught.status === 404 || caught.status === 409)) {
        router.refresh();
      }
      setError(describeApiError(caught));
    }
    setReplacing(false);
  };

  return (
    <>
      {canCreateJob ? <CreateJobButton quotationId={quotation.id} /> : null}

      <PrintButton />

      {canReplace ? (
        <Button
          onClick={() => void replace()}
          loading={replacing}
          loadingText="Starting the replacement…"
        >
          <FilePen aria-hidden="true" />
          Replace with a new draft
        </Button>
      ) : null}

      {canVoid ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={menuTriggerRef} variant="outline" disabled={replacing}>
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
                setVoidOpen(true);
              }}
            >
              <Trash2 aria-hidden="true" />
              Void quotation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {error === null ? null : (
        <FormAlert tone="error" className="w-full sm:max-w-md">
          {error}
        </FormAlert>
      )}

      {canVoid &&
      (quotation.status === QuotationStatus.SENT || quotation.status === QuotationStatus.DRAFT) ? (
        <QuotationVoidDialog
          open={voidOpen}
          onOpenChange={(open) => {
            setVoidOpen(open);
            if (!open) {
              setTimeout(() => menuTriggerRef.current?.focus(), 0);
            }
          }}
          quotationId={quotation.id}
          reference={quotation.reference}
          status={quotation.status}
          customerName={quotation.customer.name}
          onVoided={() => {
            router.refresh();
          }}
          onConflict={() => {
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
