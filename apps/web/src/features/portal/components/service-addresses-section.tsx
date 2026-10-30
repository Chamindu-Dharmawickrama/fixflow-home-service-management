"use client";

import { LIMITS, type ServiceAddressDto } from "@fixflow/shared";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/sonner";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import {
  type AddressBody,
  addressToFormValues,
  changedAddressFields,
  toAddressBody,
} from "../lib/address-form";
import { formatAddressLines } from "../lib/format-address";
import { AddressForm } from "./address-form";

const MAX_ADDRESSES = LIMITS.address.maxPerCustomer;

type DialogState = { kind: "add" } | { kind: "edit"; address: ServiceAddressDto } | null;

export interface ServiceAddressesSectionProps {
  /** Default first, as the API returns them. */
  addresses: readonly ServiceAddressDto[];
}

/**
 * "Service addresses" on the customer's profile (FR-013): add, edit, choose the default and delete.
 * The list is whatever the server last said; after each change the page is refreshed, so what is
 * shown is never a guess. Nothing is announced as done until the server has confirmed it, a failed
 * action says why and keeps the form's input, and a second click is blocked while one is pending.
 * Deleting explains that past requests keep the address they were made with (D-36).
 */
export function ServiceAddressesSection({ addresses }: ServiceAddressesSectionProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleting, setDeleting] = useState<ServiceAddressDto | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Managed focus. A controlled dialog has no Radix trigger to give focus back to, so the section
  // remembers the button that opened it. A button can also disappear with the change it caused (the
  // empty state's "Add your first address", a deleted card, "Set as default" on the new default);
  // then focus would drop to the page, so once the refreshed list arrives it moves to the heading.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const checkFocusOnUpdate = useRef(false);

  useEffect(() => {
    if (!checkFocusOnUpdate.current) return;
    checkFocusOnUpdate.current = false;
    const focused = document.activeElement;
    if (focused === null || focused === document.body || !focused.isConnected) {
      headingRef.current?.focus();
    }
  }, [addresses]);

  const openDialog = (next: NonNullable<DialogState>, event: MouseEvent<HTMLElement>) => {
    openerRef.current = event.currentTarget;
    setDialog(next);
  };

  const atLimit = addresses.length >= MAX_ADDRESSES;
  const busy = settingDefaultId !== null;

  /** An address that is gone (deleted in another tab) is a 404: reload, so the list tells the truth. */
  const reloadIfGone = (caught: unknown) => {
    if (isApiError(caught) && (caught.status === 404 || caught.status === 409)) {
      router.refresh();
    }
  };

  const saveNew = async (body: AddressBody) => {
    const saved = await apiFetch<ServiceAddressDto>("/customers/me/addresses", {
      method: "POST",
      body,
    });
    setDialog(null);
    toast.success(`“${saved.label}” saved`, {
      description: saved.isDefault
        ? "It is your default address."
        : "You can choose it when you request a service.",
    });
    checkFocusOnUpdate.current = true;
    router.refresh();
  };

  const saveEdit = async (address: ServiceAddressDto, body: AddressBody) => {
    const changes = changedAddressFields(toAddressBody(addressToFormValues(address)), body);
    if (Object.keys(changes).length === 0) {
      // Only spacing differed: there is nothing to save, and the API refuses an empty change.
      setDialog(null);
      return;
    }
    try {
      const saved = await apiFetch<ServiceAddressDto>(`/customers/me/addresses/${address.id}`, {
        method: "PATCH",
        body: changes,
      });
      setDialog(null);
      toast.success(`“${saved.label}” updated`, {
        description: "Requests you already made keep the address they were made with.",
      });
      checkFocusOnUpdate.current = true;
      router.refresh();
    } catch (caught) {
      reloadIfGone(caught);
      throw caught;
    }
  };

  const makeDefault = async (address: ServiceAddressDto) => {
    setSettingDefaultId(address.id);
    setActionError(null);
    try {
      await apiFetch(`/customers/me/addresses/${address.id}/default`, { method: "POST" });
      toast.success(`“${address.label}” is now your default address`);
      checkFocusOnUpdate.current = true;
      router.refresh();
    } catch (caught) {
      setActionError(describeApiError(caught));
      reloadIfGone(caught);
    } finally {
      setSettingDefaultId(null);
    }
  };

  const remove = async (address: ServiceAddressDto) => {
    try {
      await apiFetch(`/customers/me/addresses/${address.id}`, { method: "DELETE" });
    } catch (caught) {
      // Shown inside the dialog, which stays open.
      reloadIfGone(caught);
      throw new Error(describeApiError(caught));
    }
    toast.success(`“${address.label}” deleted`);
    checkFocusOnUpdate.current = true;
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle as="h2" ref={headingRef} tabIndex={-1} className="outline-offset-4">
              Service addresses
            </CardTitle>
            <CardDescription>
              Where we do the work. Choose one of these when you request a service.
            </CardDescription>
          </div>
          {addresses.length > 0 ? (
            <Button
              variant="outline"
              disabled={atLimit}
              onClick={(event) => {
                openDialog({ kind: "add" }, event);
              }}
            >
              <Plus aria-hidden="true" />
              Add address
            </Button>
          ) : null}
        </div>
        {atLimit ? (
          <p className="text-sm text-ink-secondary">
            You have saved the maximum of {MAX_ADDRESSES} addresses. Delete one you no longer use to
            add another.
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {actionError !== null ? <FormAlert tone="error">{actionError}</FormAlert> : null}

        {addresses.length === 0 ? (
          <EmptyState
            icon={MapPin}
            titleAs="h3"
            title="No saved addresses yet"
            description="Add the address where you want work done. You can save up to 10, give each a name like Home or Rental unit, and pick one whenever you request a service."
            action={
              <Button
                onClick={(event) => {
                  openDialog({ kind: "add" }, event);
                }}
              >
                <Plus aria-hidden="true" />
                Add your first address
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {addresses.map((address) => (
              <li
                key={address.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-ink">{address.label}</h3>
                    {address.isDefault ? (
                      <Badge tone="brand">
                        <Star aria-hidden="true" />
                        Default
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-ink">
                    {formatAddressLines(address).map((line) => (
                      <span key={line} className="block break-words">
                        {line}
                      </span>
                    ))}
                  </p>
                  {address.accessNotes !== null ? (
                    <p className="line-clamp-2 break-words text-sm text-ink-secondary">
                      <span className="font-medium">Access notes: </span>
                      {address.accessNotes}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={(event) => {
                      openDialog({ kind: "edit", address }, event);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    Edit <span className="sr-only">{address.label}</span>
                  </Button>
                  {!address.isDefault ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      loading={settingDefaultId === address.id}
                      loadingText={`Setting ${address.label} as default…`}
                      onClick={() => {
                        void makeDefault(address);
                      }}
                    >
                      <Star aria-hidden="true" />
                      Set as default <span className="sr-only">{address.label}</span>
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                    disabled={busy}
                    onClick={() => {
                      setDeleting(address);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete <span className="sr-only">{address.label}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = openerRef.current;
            if (opener?.isConnected) {
              opener.focus({ preventScroll: true });
            } else {
              headingRef.current?.focus();
            }
          }}
        >
          {dialog?.kind === "edit" ? (
            <>
              <DialogHeader>
                <DialogTitle>Edit “{dialog.address.label}”</DialogTitle>
                <DialogDescription>
                  Requests you already made keep the address they were made with.
                </DialogDescription>
              </DialogHeader>
              <AddressForm
                label={`Edit ${dialog.address.label}`}
                initialValues={addressToFormValues(dialog.address)}
                requireChange
                submitLabel="Save changes"
                savingText="Saving changes…"
                onSubmit={(body) => saveEdit(dialog.address, body)}
                onCancel={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog?.kind === "add" ? (
            <>
              <DialogHeader>
                <DialogTitle>Add an address</DialogTitle>
                <DialogDescription>
                  {addresses.length === 0
                    ? "This will be your default address."
                    : "You can make it your default after you save it."}
                </DialogDescription>
              </DialogHeader>
              <AddressForm
                label="Add address"
                submitLabel="Save address"
                savingText="Saving address…"
                onSubmit={saveNew}
                onCancel={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={deleting === null ? "Delete address?" : `Delete “${deleting.label}”?`}
        consequence={
          <>
            <p>
              Requests you have already made keep the address they were made with, so nothing about
              them changes. You will no longer be able to choose this address for new requests.
            </p>
            {deleting?.isDefault && addresses.length > 1 ? (
              <p className="mt-2">
                This is your default address. The address you changed most recently becomes the
                default instead.
              </p>
            ) : null}
          </>
        }
        confirmLabel="Delete address"
        destructive
        onConfirm={() => (deleting === null ? undefined : remove(deleting))}
      />
    </Card>
  );
}
