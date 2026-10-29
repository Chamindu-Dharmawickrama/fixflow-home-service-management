"use client";

import { ChevronDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { navigateWithFullReload } from "@/lib/auth/navigate";

export interface UserMenuProps {
  name: string;
  avatarUrl: string | null;
  roleLabel: string;
  /** Where the "Account" item goes. Leave out when the role has no account page yet (no dead links). */
  accountHref?: string | undefined;
}

/**
 * The signed-in person's menu in the shell's top bar: name, avatar (or initials), role, an
 * "Account" link where the role has one, and "Sign out". Signing out asks the API to delete the
 * session, then loads the home page afresh, so no signed-in page lingers in the browser's cache.
 */
export function UserMenu({ name, avatarUrl, roleLabel, accountHref }: UserMenuProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    setFailed(false);
    try {
      await apiFetch("/auth/logout", { method: "POST" });
      navigateWithFullReload("/");
    } catch {
      // The cookie may still be valid: say so instead of pretending the person is signed out.
      setSigningOut(false);
      setFailed(true);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-11 items-center gap-2 rounded-lg px-1.5 hover:bg-surface-muted sm:h-10"
        >
          <Avatar name={name} src={avatarUrl ?? undefined} size="sm" decorative />
          <span className="sr-only">Account menu for </span>
          <span className="text-left text-sm max-sm:sr-only">
            <span className="block font-medium leading-4 text-ink">{name}</span>
            <span className="block text-xs text-ink-muted">{roleLabel}</span>
          </span>
          <ChevronDown aria-hidden="true" className="hidden size-4 text-ink-muted sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          {name} · {roleLabel}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accountHref !== undefined ? (
          <DropdownMenuItem asChild>
            <Link href={accountHref}>
              <UserRound aria-hidden="true" />
              Account
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
        >
          <LogOut aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
        {failed ? (
          <p role="alert" className="px-2 py-1.5 text-xs text-danger">
            Couldn&apos;t sign you out. Check your connection and try again.
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
