"use client";

import { Menu, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

import { NavList } from "@/components/layout/nav-list";
import { IconButton } from "@/components/ui/icon-button";
import type { NavItem } from "@/lib/navigation";

export interface PublicNavProps {
  items: readonly NavItem[];
  /** The primary call to action, repeated inside the mobile menu where the header has no room. */
  cta?: ReactNode;
}

/**
 * The public site's navigation. From `md` it is a row of links in the header. Below that, a menu
 * button toggles a panel under the header: a disclosure, not a modal, so the page behind stays
 * readable. The button reports `aria-expanded`, Escape closes the panel and returns focus to the
 * button, and choosing a link closes it.
 */
export function PublicNav({ items, cta }: PublicNavProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonWrapperRef = useRef<HTMLDivElement>(null);
  const groups = [{ items }];

  const close = () => setOpen(false);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      close();
      buttonWrapperRef.current?.querySelector("button")?.focus();
    }
  };

  const hasItems = items.length > 0;

  return (
    <div onKeyDown={handleKeyDown} className="contents">
      {hasItems ? (
        <nav aria-label="Main" className="hidden md:block">
          <NavList groups={groups} variant="top" />
        </nav>
      ) : null}

      {hasItems ? (
        <div ref={buttonWrapperRef} className="md:hidden">
          <IconButton
            label="Menu"
            icon={open ? X : Menu}
            variant="ghost"
            tooltip={false}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          />
        </div>
      ) : null}

      {hasItems && open ? (
        <nav
          id={panelId}
          aria-label="Main"
          className="absolute inset-x-0 top-full border-b border-border bg-surface px-4 pb-4 pt-2 shadow-md md:hidden"
        >
          <NavList groups={groups} variant="stacked" onNavigate={close} />
          {cta ? <div className="mt-3 flex flex-col *:w-full">{cta}</div> : null}
        </nav>
      ) : null}
    </div>
  );
}
