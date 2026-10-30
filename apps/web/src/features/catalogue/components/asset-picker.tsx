"use client";

import Image from "next/image";

import { cn } from "@/lib/utils";

import type { BundledAsset } from "../lib/bundled-assets";
import { BundledTile } from "./bundled-tile";

export interface AssetPickerOption {
  key: string;
  label: string;
  asset: BundledAsset;
}

export interface AssetPickerProps {
  /** Radios with the same name form one group; the arrow keys move between them. */
  name: string;
  options: readonly AssetPickerOption[];
  /** The chosen key, or `""` for none. */
  value: string;
  onChange: (key: string) => void;
  /** Goes on the first radio, so an error summary can move focus into the group. */
  id?: string | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  "aria-describedby"?: string | undefined;
}

/**
 * Choose one bundled logo or picture (D-30). Each option is a native radio button with a visible
 * tile, so it works with the keyboard and with screen readers without extra code, and the choice
 * is shown by a heavier border and a ring, not by colour alone. Put it inside a `FormFieldGroup`
 * (a fieldset with a legend), which names the group.
 */
export function AssetPicker({
  name,
  options,
  value,
  onChange,
  id,
  invalid,
  disabled,
  "aria-describedby": describedBy,
}: AssetPickerProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {options.map((option, index) => (
        <label
          key={option.key}
          className="relative block cursor-pointer has-[:disabled]:cursor-not-allowed"
        >
          <input
            type="radio"
            id={index === 0 ? id : undefined}
            name={name}
            value={option.key}
            checked={value === option.key}
            onChange={() => {
              onChange(option.key);
            }}
            disabled={disabled}
            aria-describedby={describedBy}
            className="peer sr-only"
          />
          <span
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl border bg-surface p-3 text-center text-sm text-ink",
              "transition-colors duration-150 ease-standard hover:bg-surface-muted",
              invalid ? "border-danger" : "border-border-strong",
              "peer-checked:border-brand peer-checked:ring-2 peer-checked:ring-brand",
              "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
              "peer-disabled:opacity-50",
            )}
          >
            {option.asset.photo ? (
              // A service picture is shown as the photograph itself, so the chooser looks like the website.
              <span
                aria-hidden="true"
                className="relative block h-14 w-full overflow-hidden rounded-lg bg-surface-muted"
              >
                <Image
                  src={option.asset.photo.src}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 160px, 45vw"
                  className="object-cover"
                />
              </span>
            ) : (
              <BundledTile asset={option.asset} className="size-14 rounded-lg" />
            )}
            <span className="font-medium">{option.label}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
