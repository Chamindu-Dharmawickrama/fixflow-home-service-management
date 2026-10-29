import { cn } from "@/lib/utils";

import { ASSET_TONE_CLASSES, type BundledAsset } from "../lib/bundled-assets";

/** A bundled logo or picture drawn as a tinted tile with its icon. Decorative: the name is elsewhere. */
export function BundledTile({
  asset,
  className,
  iconClassName,
}: {
  asset: BundledAsset;
  className?: string | undefined;
  iconClassName?: string | undefined;
}) {
  const Icon = asset.icon;
  return (
    <span
      aria-hidden="true"
      className={cn("flex items-center justify-center", ASSET_TONE_CLASSES[asset.tone], className)}
    >
      <Icon className={cn("size-1/2", iconClassName)} strokeWidth={1.75} />
    </span>
  );
}
