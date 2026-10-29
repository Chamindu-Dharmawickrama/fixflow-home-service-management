"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { FALLBACK_SERVICE_IMAGE, serviceImageAsset } from "../lib/bundled-assets";
import { BundledTile } from "./bundled-tile";

export interface ServiceImageProps {
  /** A bundled picture key (see `BUNDLED_SERVICE_IMAGES`). */
  imageKey: string | null;
  /** An `https://` address, shown on the page only (D-30). Used when there is no bundled picture. */
  imageUrl: string | null;
  className?: string | undefined;
}

/**
 * The picture of a service: its bundled picture, or its web address, or a neutral illustration.
 * It never shows a broken image: an address that fails to load, or a key this build does not know,
 * falls back to the illustration. The picture is decorative (the service name is next to it), so it
 * has an empty `alt`.
 */
export function ServiceImage({ imageKey, imageUrl, className }: ServiceImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const bundled = serviceImageAsset(imageKey);

  if (bundled) {
    return (
      <BundledTile
        asset={bundled}
        className={cn("aspect-video w-full", className)}
        iconClassName="size-1/3"
      />
    );
  }
  if (imageUrl !== null && failedUrl !== imageUrl) {
    return (
      // A plain <img>: the address is any https site chosen by the business, so it cannot be one of
      // next/image's configured remote hosts, and the server never fetches it (D-30).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => {
          setFailedUrl(imageUrl);
        }}
        className={cn("aspect-video w-full object-cover", className)}
      />
    );
  }
  return (
    <BundledTile
      asset={FALLBACK_SERVICE_IMAGE}
      className={cn("aspect-video w-full", className)}
      iconClassName="size-1/3"
    />
  );
}
