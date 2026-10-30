"use client";

import type { PublicServiceDto } from "@fixflow/shared";
import { useId } from "react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatServicePrice } from "@/features/catalogue/lib/format";
import { cn } from "@/lib/utils";

export interface ServicePickerProps {
  services: readonly PublicServiceDto[];
  /** The chosen service's id, or an empty string when none is chosen yet. */
  value: string;
  onChange: (serviceId: string) => void;
  disabled?: boolean | undefined;
  /** The group's DOM id, as `FormFieldGroup` passes it (the error summary links to it). */
  id?: string | undefined;
  "aria-invalid"?: true | undefined;
  "aria-describedby"?: string | undefined;
  "aria-required"?: true | undefined;
  className?: string | undefined;
}

/**
 * Chooses one of the active services (step 1 of the request form). Each choice shows the name, a
 * line about what it covers and what it costs, so the customer can tell them apart without leaving
 * the form. Wrap it in a `FormFieldGroup` for the legend and the error.
 */
export function ServicePicker({
  services,
  value,
  onChange,
  disabled = false,
  id,
  className,
  ...aria
}: ServicePickerProps) {
  const baseId = useId();

  return (
    <RadioGroup
      id={id}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      className={cn("gap-3", className)}
      {...aria}
    >
      {services.map((service) => {
        const itemId = `${baseId}-${service.id}`;
        const checked = service.id === value;
        return (
          <div
            key={service.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-4 transition-colors duration-150",
              checked ? "border-brand bg-brand-soft" : "border-border hover:border-ink-muted",
            )}
          >
            <RadioGroupItem value={service.id} id={itemId} className="mt-0.5" />
            <Label
              htmlFor={itemId}
              className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 font-normal"
            >
              <span className="text-base font-semibold text-ink">{service.name}</span>
              <span className="text-pretty text-sm text-ink-secondary">
                {service.shortDescription}
              </span>
              <span className="text-sm font-medium text-ink">{formatServicePrice(service)}</span>
            </Label>
          </div>
        );
      })}
    </RadioGroup>
  );
}
