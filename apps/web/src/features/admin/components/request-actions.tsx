"use client";

import {
  type AdminQuotationDto,
  type ChangeRequestStatusBody,
  ErrorCode,
  LIMITS,
  RequestAction,
  type RequestStatusAction,
  type ServiceRequestStatus,
} from "@fixflow/shared";
import { Ban, Briefcase, ChevronDown, ClipboardCheck, FilePlus2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import { adminQuotationPath } from "../lib/quotations";
import { type OfferedAction, REQUEST_ACTION_LABELS, splitActions } from "../lib/request-actions";
import { CreateJobButton } from "./create-job-button";

export interface RequestActionsProps {
  requestId: string;
  reference: string;
  customerName: string;
  /** The status the page shows; the server refuses the change if the request has moved on (D-46). */
  status: ServiceRequestStatus;
  /** What the server allows now, the most likely next step first (D-43). */
  actions: readonly RequestAction[];
  /** The quotation the customer accepted, which "Create job" turns into a job. */
  acceptedQuotationId?: string | null | undefined;
}

type DialogKind = typeof RequestAction.CANCEL | typeof RequestAction.REOPEN | null;

const ACTION_ICONS = {
  [RequestAction.START_REVIEW]: ClipboardCheck,
  [RequestAction.CREATE_QUOTATION]: FilePlus2,
  [RequestAction.CREATE_WORK_ORDER]: Briefcase,
  [RequestAction.REOPEN]: RotateCcw,
  [RequestAction.CANCEL]: Ban,
} as const;

const STALE_MESSAGE =
  "Someone else changed this request, so the page has been reloaded. Check it and try again.";

/** The sentence for a failed change; a request that moved on says so in words the person can act on. */
function describeChangeError(caught: unknown): string {
  return isApiError(caught) && caught.code === ErrorCode.STALE_STATE
    ? STALE_MESSAGE
    : describeApiError(caught);
}

/**
 * The buttons that move a request on (FR-025, D-21): the most likely next step as the main button,
 * and the others (cancel) in a "More actions" menu with a confirmation that says what will happen.
 * Only the actions the server lists are offered. Nothing is announced as done until the server has
 * said so; a failure says why, and a request that someone else changed meanwhile is reloaded so the
 * page shows the truth. While a change is pending every control is blocked, so it is sent once.
 */
export function RequestActions({
  requestId,
  reference,
  customerName,
  status,
  actions,
  acceptedQuotationId = null,
}: RequestActionsProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [pending, setPending] = useState<RequestAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { primary, menu } = splitActions(actions);

  // Managed focus. The menu closes and the dialog opens in the same moment, so the menu must not
  // take focus back; and when a change removes the control that had focus (the last action goes
  // away), focus moves to the page rather than being lost.
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const openingDialogFromMenu = useRef(false);
  const checkFocusOnUpdate = useRef(false);

  useEffect(() => {
    if (!checkFocusOnUpdate.current) return;
    checkFocusOnUpdate.current = false;
    const focused = document.activeElement;
    if (focused === null || focused === document.body || !focused.isConnected) {
      document.getElementById(MAIN_CONTENT_ID)?.focus();
    }
  }, [status, actions]);

  /** Sends the change. A request that has moved on is reloaded, so the page and the buttons catch up. */
  const change = async (
    body: Omit<ChangeRequestStatusBody, "expectedStatus" | "action"> & {
      action: RequestStatusAction;
    },
  ) => {
    try {
      await apiFetch(`/admin/requests/${encodeURIComponent(requestId)}/status`, {
        method: "PATCH",
        body: { ...body, expectedStatus: status },
      });
    } catch (caught) {
      if (isApiError(caught) && (caught.status === 404 || caught.status === 409)) {
        router.refresh();
      }
      throw new Error(describeChangeError(caught), { cause: caught });
    }
    checkFocusOnUpdate.current = true;
    router.refresh();
  };

  const startReview = async () => {
    setPending(RequestAction.START_REVIEW);
    setError(null);
    try {
      await change({ action: RequestAction.START_REVIEW });
      toast.success(`${reference} is under review`, {
        description: `${customerName} sees it as Under review.`,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : describeApiError(caught));
    } finally {
      setPending(null);
    }
  };

  /**
   * Starts the quotation (FR-040) and opens its editor. The server fills the draft in. A request that
   * already has a draft (someone else started it a moment ago) opens that one instead of failing.
   * The button stays blocked until the page has moved on, so it is not pressed twice.
   */
  const createQuotation = async () => {
    setPending(RequestAction.CREATE_QUOTATION);
    setError(null);
    try {
      const draft = await apiFetch<AdminQuotationDto>(
        `/admin/requests/${encodeURIComponent(requestId)}/quotations`,
        { method: "POST", body: {} },
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
    setPending(null);
  };

  const closeDialog = (open: boolean) => {
    if (open) return;
    setDialog(null);
    // The menu item that opened the dialog is gone; the menu's own button is the next best place.
    setTimeout(() => menuTriggerRef.current?.focus(), 0);
  };

  const choose = (action: OfferedAction, fromMenu: boolean) => {
    if (action === RequestAction.START_REVIEW) {
      void startReview();
      return;
    }
    if (action === RequestAction.CREATE_QUOTATION) {
      void createQuotation();
      return;
    }
    if (action === RequestAction.CREATE_WORK_ORDER) {
      // Performed by its own button (`CreateJobButton`), which is always the main one.
      return;
    }
    openingDialogFromMenu.current = fromMenu;
    setDialog(action);
  };

  if (primary === undefined && menu.length === 0) {
    return null;
  }

  const PrimaryIcon = primary === undefined ? null : ACTION_ICONS[primary];

  return (
    <>
      {primary === RequestAction.CREATE_WORK_ORDER ? (
        acceptedQuotationId === null ? null : (
          <CreateJobButton quotationId={acceptedQuotationId} />
        )
      ) : primary === undefined || PrimaryIcon === null ? null : (
        <Button
          onClick={() => choose(primary, false)}
          loading={pending !== null && pending === primary}
          disabled={pending !== null && pending !== primary}
          loadingText={
            primary === RequestAction.CREATE_QUOTATION ? "Creating the draft…" : "Starting review…"
          }
        >
          <PrimaryIcon aria-hidden="true" />
          {REQUEST_ACTION_LABELS[primary]}
        </Button>
      )}

      {menu.length === 0 ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={menuTriggerRef} variant="outline" disabled={pending !== null}>
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
            {menu.map((action) => {
              const Icon = ACTION_ICONS[action];
              return (
                <DropdownMenuItem
                  key={action}
                  destructive={action === RequestAction.CANCEL}
                  onSelect={() => choose(action, true)}
                >
                  <Icon aria-hidden="true" />
                  {REQUEST_ACTION_LABELS[action]}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {error === null ? null : (
        <FormAlert tone="error" className="w-full sm:max-w-md">
          {error}
        </FormAlert>
      )}

      <ConfirmDialog
        open={dialog === RequestAction.CANCEL}
        onOpenChange={closeDialog}
        title={`Cancel ${reference}?`}
        consequence={
          <div className="flex flex-col gap-2">
            <p>
              The request is closed and cannot be reopened. {customerName} is told it was cancelled,
              in their portal and by email.
            </p>
            <p>
              They read only the message you write below, or a short standard line if you leave it
              empty. Your reason stays inside the business.
            </p>
          </div>
        }
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        destructive
        reason={{
          label: "Reason (internal)",
          minLength: LIMITS.reason.minLength,
          maxLength: LIMITS.reason.maxLength,
          description: "Only your team sees this.",
        }}
        secondary={{
          label: "Message to the customer",
          maxLength: LIMITS.reason.maxLength,
          description: "Optional. The customer reads this in their portal and in the email.",
        }}
        onConfirm={async (reason, customerMessage) => {
          await change({
            action: RequestAction.CANCEL,
            ...(reason !== undefined && { reason }),
            ...(customerMessage !== undefined && { customerMessage }),
          });
          toast.success(`${reference} was cancelled`, {
            description: "It stays in the history with your reason.",
          });
        }}
      />

      <ConfirmDialog
        open={dialog === RequestAction.REOPEN}
        onOpenChange={closeDialog}
        title={`Reopen ${reference}?`}
        consequence={
          <p>
            The request goes back under review so you can quote it again. {customerName} sees it as
            Under review. Your reason is saved as an internal note.
          </p>
        }
        confirmLabel="Reopen request"
        reason={{
          label: "Reason (internal)",
          minLength: LIMITS.reason.minLength,
          maxLength: LIMITS.reason.maxLength,
          description: "Only your team sees this.",
        }}
        onConfirm={async (reason) => {
          await change({
            action: RequestAction.REOPEN,
            ...(reason !== undefined && { reason }),
          });
          toast.success(`${reference} was reopened`, {
            description: "It is under review again.",
          });
        }}
      />
    </>
  );
}
