"use client";

import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";

import { NavList } from "@/components/layout/nav-list";
import { IconButton } from "@/components/ui/icon-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { NavGroup } from "@/lib/navigation";

export interface MobileNavProps {
  groups: readonly NavGroup[];
  /** Brand block at the top of the drawer (usually the dark `Logo`). */
  brand: ReactNode;
  /** Pinned at the bottom of the drawer, for example the signed-in user or a demo note. */
  footer?: ReactNode;
  /** The accessible name of the drawer and its trigger context. */
  title?: string | undefined;
  /** `dark` matches the admin sidebar; `light` is for the portal. */
  tone?: "dark" | "light" | undefined;
}

/**
 * The navigation drawer for narrow screens. A hamburger button opens a modal drawer: focus moves
 * into it, Tab stays inside, Escape closes it and focus returns to the button. Choosing a link
 * closes it.
 */
export function MobileNav({
  groups,
  brand,
  footer,
  title = "Main navigation",
  tone = "dark",
}: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const dark = tone === "dark";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <IconButton label="Open menu" icon={Menu} variant="ghost" tooltip={false} />
      </SheetTrigger>
      <SheetContent side="left" tone={tone}>
        <SheetHeader className="px-4 pt-4">
          {brand}
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <SheetDescription className="sr-only">
            Choose a page. Press Escape to close this menu.
          </SheetDescription>
        </SheetHeader>
        <nav aria-label={title} className="flex-1 overflow-y-auto px-3 pb-4">
          <NavList
            groups={groups}
            variant={dark ? "sidebar" : "stacked"}
            onNavigate={() => setOpen(false)}
          />
        </nav>
        {footer ? (
          <div className={dark ? "border-t border-nav-border p-4" : "border-t border-border p-4"}>
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
