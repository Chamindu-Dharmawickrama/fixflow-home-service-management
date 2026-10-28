"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { NavItems, type NavItemsProps } from "@/components/layout/nav-items";
import { findActiveHref, flattenGroups } from "@/lib/navigation";

function ActiveNavItems(props: Omit<NavItemsProps, "activeHref">) {
  const pathname = usePathname();
  return <NavItems {...props} activeHref={findActiveHref(pathname, flattenGroups(props.groups))} />;
}

/**
 * `NavItems` with the current page highlighted. Reading the URL is request-time data, so with
 * Cache Components (D-55) it sits behind a Suspense boundary whose fallback is the same list
 * without a highlight: the shell around it can be prerendered and the links are never missing.
 */
export function NavList(props: Omit<NavItemsProps, "activeHref">) {
  return (
    <Suspense fallback={<NavItems {...props} />}>
      <ActiveNavItems {...props} />
    </Suspense>
  );
}
