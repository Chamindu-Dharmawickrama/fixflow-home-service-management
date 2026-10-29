"use client";

import { Building2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { logoAsset } from "../lib/bundled-assets";
import { BundledTile } from "./bundled-tile";

export interface BusinessLogoProps {
  businessName: string;
  logoKey: string | null;
  logoUrl: string | null;
  className?: string | undefined;
}

/**
 * The business's mark beside its name: a bundled logo, or the web address it chose, or a neutral
 * building when there is none (or the address does not load). The name is always written out, so the
 * mark itself is decorative.
 */
export function BusinessLogo({ businessName, logoKey, logoUrl, className }: BusinessLogoProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const bundled = logoAsset(logoKey);
  const mark = "size-10 shrink-0 rounded-lg";

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-3", className)}>
      {bundled ? (
        <BundledTile asset={bundled} className={mark} />
      ) : logoUrl !== null && failedUrl !== logoUrl ? (
        // A plain <img>: any https address chosen by the business, never fetched by the server (D-30).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => {
            setFailedUrl(logoUrl);
          }}
          className={cn(mark, "object-contain")}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            mark,
            "flex items-center justify-center bg-surface-muted text-ink-secondary",
          )}
        >
          <Building2 className="size-5" />
        </span>
      )}
      <span className="min-w-0 truncate font-display text-base font-semibold text-ink">
        {businessName}
      </span>
    </span>
  );
}
