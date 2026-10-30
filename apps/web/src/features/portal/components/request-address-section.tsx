"use client";

import { LIMITS, type ServiceAddressDto } from "@fixflow/shared";
import { useEffect, useRef } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";

import { FormField, FormFieldGroup } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import type { RequestFormValues } from "../lib/request-form";
import { AddressSelector } from "./address-selector";

export interface RequestAddressSectionProps {
  form: UseFormReturn<RequestFormValues>;
  addresses: readonly ServiceAddressDto[];
  disabled: boolean;
}

const A = LIMITS.address;

/**
 * Step 3 of the request form: where the work is to be done (FR-020). A customer with saved addresses
 * chooses one of them; otherwise, or on request, they type a new one and may keep it on their
 * profile. Switching between the two keeps what was typed, and moves focus to the first thing the
 * new view offers so a keyboard or screen-reader user is not left on a button that has gone.
 */
export function RequestAddressSection({ form, addresses, disabled }: RequestAddressSectionProps) {
  const { control } = form;
  const mode = useWatch({ control, name: "addressMode" });
  const saveToProfile = useWatch({ control, name: "saveAddressToProfile" });
  const container = useRef<HTMLDivElement>(null);
  const focusAfterSwitch = useRef(false);
  const atLimit = addresses.length >= A.maxPerCustomer;

  useEffect(() => {
    if (!focusAfterSwitch.current) {
      return;
    }
    focusAfterSwitch.current = false;
    const target =
      mode === "new"
        ? container.current?.querySelector<HTMLElement>("input")
        : (container.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
          container.current?.querySelector<HTMLElement>('[role="radio"]'));
    target?.focus();
  }, [mode]);

  const switchTo = (next: "saved" | "new") => {
    focusAfterSwitch.current = true;
    form.setValue("addressMode", next, { shouldDirty: true });
    // What the other view said is wrong no longer applies to what is on screen.
    form.clearErrors(next === "new" ? "serviceAddressId" : "newAddress");
  };

  if (mode === "saved") {
    return (
      <div ref={container}>
        <FormFieldGroup
          control={control}
          name="serviceAddressId"
          legend="Choose an address"
          required
          description="Your saved addresses. You can add or change them on your profile."
        >
          {(field) => (
            <AddressSelector
              addresses={addresses}
              value={field.value === "" ? null : field.value}
              onChange={field.onChange}
              onAddNew={() => {
                switchTo("new");
              }}
              disabled={disabled}
              id={field.id}
              aria-invalid={field["aria-invalid"]}
              aria-describedby={field["aria-describedby"]}
              aria-required={field["aria-required"]}
            />
          )}
        </FormFieldGroup>
      </div>
    );
  }

  return (
    <div ref={container} className="flex flex-col gap-5">
      <FormField control={control} name="newAddress.line1" label="Street address" required>
        {(field) => <Input {...field} autoComplete="address-line1" disabled={disabled} />}
      </FormField>

      <FormField
        control={control}
        name="newAddress.line2"
        label="Address line 2"
        description="Apartment, unit or building. Optional."
      >
        {(field) => <Input {...field} autoComplete="address-line2" disabled={disabled} />}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField control={control} name="newAddress.city" label="City" required>
          {(field) => <Input {...field} autoComplete="address-level2" disabled={disabled} />}
        </FormField>
        <FormField control={control} name="newAddress.region" label="State or region">
          {(field) => <Input {...field} autoComplete="address-level1" disabled={disabled} />}
        </FormField>
      </div>

      <FormField
        control={control}
        name="newAddress.postalCode"
        label="Postal code"
        required
        className="sm:max-w-48"
      >
        {(field) => <Input {...field} autoComplete="postal-code" disabled={disabled} />}
      </FormField>

      <FormField
        control={control}
        name="newAddress.accessNotes"
        label="Access notes"
        description="Gate code, parking, pets… Only you and our team can see this."
      >
        {(field) => (
          <Textarea {...field} maxLength={A.accessNotes.maxLength} showCount disabled={disabled} />
        )}
      </FormField>

      {atLimit ? (
        <p className="text-sm text-ink-secondary">
          You have saved the most addresses we can keep ({A.maxPerCustomer}), so this address will
          be used for this request only. You can delete one on your profile to make room.
        </p>
      ) : (
        <>
          <FormField
            control={control}
            name="saveAddressToProfile"
            layout="inline"
            label="Save this address to my profile"
            description="Next time you can choose it from your saved addresses."
          >
            {(field) => (
              <Switch
                id={field.id}
                name={field.name}
                checked={field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked);
                  if (!checked) {
                    form.clearErrors("newAddress.label");
                  }
                }}
                onBlur={field.onBlur}
                aria-describedby={field["aria-describedby"]}
                disabled={disabled}
              />
            )}
          </FormField>

          {saveToProfile ? (
            <FormField
              control={control}
              name="newAddress.label"
              label="Label"
              required
              description="What you call this place, like Home or Rental unit."
            >
              {(field) => (
                <Input
                  {...field}
                  autoComplete="off"
                  maxLength={A.label.maxLength}
                  disabled={disabled}
                />
              )}
            </FormField>
          ) : null}
        </>
      )}

      {addresses.length > 0 ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              switchTo("saved");
            }}
          >
            Use a saved address instead
          </Button>
        </div>
      ) : null}
    </div>
  );
}
