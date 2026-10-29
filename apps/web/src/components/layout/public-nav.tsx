"use client";

import { Menu, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

import { NavList } from "@/components/layout/nav-list";
import { IconButton } from "@/components/ui/icon-button";
import type { NavItem } from "@/lib/navigation";

/** Full class names per breakpoint, so Tailwind can see them. */
const BREAKPOINT_CLASSES = {
  md: { row: "hidden md:block", button: "md:hidden", panel: "md:hidden" },
  lg: { row: "hidden lg:block", button: "lg:hidden", panel: "lg:hidden" },
} as const;

export interface PublicNavProps {
  items: readonly NavItem[];
  /** The primary call to action, repeated inside the mobile menu where the header has no room. */
  cta?: ReactNode;
  /**
   * The width from which the links are a row in the header instead of a menu. `md` (768 px) suits a
   * short list; the public website, with four links beside the account link and the call to action,
   * needs `lg` (D-91).
   */
  inlineFrom?: keyof typeof BREAKPOINT_CLASSES;
}

/**
 * The public site's navigation. From `inlineFrom` (`md` by default) it is a row of links in the
 * header. Below that, a menu button toggles a panel under the header: a disclosure, not a modal, so
 * the page behind stays readable. The button reports `aria-expanded`, Escape closes the panel and
 * returns focus to the button, and choosing a link closes it.
 *
 * Its parts are direct flex items of the header (`contents`) and carry an explicit `order`, which
 * `PublicLayout` shares with the identity, the account link and the call to action.
 */
export function PublicNav({ items, cta, inlineFrom = "md" }: PublicNavProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonWrapperRef = useRef<HTMLDivElement>(null);
  const groups = [{ items }];
  const classes = BREAKPOINT_CLASSES[inlineFrom];

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
        <nav aria-label="Main" className={`order-2 ${classes.row}`}>
          <NavList groups={groups} variant="top" />
        </nav>
      ) : null}

      {hasItems ? (
        <div ref={buttonWrapperRef} className={`order-3 ${classes.button}`}>
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
          className={`absolute inset-x-0 top-full border-b border-border bg-surface px-4 pb-4 pt-2 shadow-md ${classes.panel}`}
        >
          <NavList groups={groups} variant="stacked" onNavigate={close} />
          {cta ? <div className="mt-3 flex flex-col *:w-full">{cta}</div> : null}
        </nav>
      ) : null}
    </div>
  );
}
