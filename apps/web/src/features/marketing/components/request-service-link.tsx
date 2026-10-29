import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

import { requestServiceHref } from "../lib/request-service";

export interface RequestServiceLinkProps {
  /** Opens the request form with this service chosen. Leave out for the general call to action. */
  serviceSlug?: string | undefined;
  variant?: "primary" | "outline" | "secondary";
  size?: "md" | "lg";
  children?: string;
  className?: string | undefined;
}

/** The primary call to action: a link styled as a button, so it is a real link for keyboards and crawlers. */
export function RequestServiceLink({
  serviceSlug,
  variant = "primary",
  size = "md",
  children = "Request a service",
  className,
}: RequestServiceLinkProps) {
  return (
    <Link
      href={requestServiceHref(serviceSlug)}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {children}
    </Link>
  );
}
