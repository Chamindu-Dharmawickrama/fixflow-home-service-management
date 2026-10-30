"use client";

import type { ServiceAddressDto } from "@fixflow/shared";
import { Plus, Star } from "lucide-react";
import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

import { formatAddressOneLine } from "../lib/format-address";

export interface AddressSelectorProps {
  addresses: readonly ServiceAddressDto[];
  /** The chosen address id, or `null` when none is chosen yet. */
  value: string | null;
  onChange: (addressId: string) => void;
  /** Starts adding an address, for the empty state and the "Add a new address" button. */
  onAddNew?: (() => void) | undefined;
  disabled?: boolean | undefined;
  /** The group's DOM id, as `FormFieldGroup` passes it (the error summary links to it). */
  id?: string | undefined;
  "aria-invalid"?: true | undefined;
  "aria-describedby"?: string | undefined;
  "aria-required"?: true | undefined;
  className?: string | undefined;
}

/**
 * Chooses one of the customer's saved addresses (T11 puts it in the request form). Each choice shows
 * the label, a "Default" badge and the address on one line; the address notes stay out of the
 * choice. Wrap it in a `FormFieldGroup` for the legend, description and error. With no saved
 * address it says so and offers `onAddNew`, if given, instead of an empty list.
 */
export function AddressSelector({
  addresses,
  value,
  onChange,
  onAddNew,
  disabled = false,
  id,
  className,
  ...aria
}: AddressSelectorProps) {
  const baseId = useId();

  if (addresses.length === 0) {
    return (
      <div
        id={id}
        className={cn(
          "flex flex-col items-start gap-3 rounded-lg border border-dashed border-border-strong p-4",
          className,
        )}
      >
        <p className="text-sm text-ink-secondary">
          You have no saved addresses yet. Add the address where you want the work done.
        </p>
        {onAddNew !== undefined ? (
          <Button variant="outline" disabled={disabled} onClick={onAddNew}>
            <Plus aria-hidden="true" />
            Add an address
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <RadioGroup
        id={id}
        value={value ?? ""}
        onValueChange={onChange}
        disabled={disabled}
        {...aria}
      >
        {addresses.map((address) => {
          const itemId = `${baseId}-${address.id}`;
          const checked = address.id === value;
          return (
            <div
              key={address.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-4 transition-colors duration-150",
                checked ? "border-brand bg-brand-soft" : "border-border hover:border-ink-muted",
              )}
            >
              <RadioGroupItem value={address.id} id={itemId} className="mt-0.5" />
              <Label
                htmlFor={itemId}
                className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 font-normal"
              >
                <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
                  {address.label}
                  {address.isDefault ? (
                    <Badge tone="brand">
                      <Star aria-hidden="true" />
                      Default
                    </Badge>
                  ) : null}
                </span>
                <span className="break-words text-sm text-ink-secondary">
                  {formatAddressOneLine(address)}
                </span>
              </Label>
            </div>
          );
        })}
      </RadioGroup>
      {onAddNew !== undefined ? (
        <div>
          <Button variant="outline" size="sm" disabled={disabled} onClick={onAddNew}>
            <Plus aria-hidden="true" />
            Add a new address
          </Button>
        </div>
      ) : null}
    </div>
  );
}
