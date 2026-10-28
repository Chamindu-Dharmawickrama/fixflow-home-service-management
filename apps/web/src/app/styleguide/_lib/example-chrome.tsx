"use client";

import { Bell, ChevronDown, Palette } from "lucide-react";
import Link from "next/link";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DateTimeText } from "@/components/ui/date-time-text";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { BUSINESS_TIME_ZONE } from "./fixtures";

/** The slim demo banner that T24 will mount in every shell (D-31). */
export function ExampleBanner() {
  return (
    <p className="bg-attention-soft px-4 py-2 text-center text-sm text-attention">
      <span className="font-medium">FixFlow portfolio demo</span> — fictional business and data.
    </p>
  );
}

/** A stand-in for the notification bell (T06): shows the slot's size and the popover pattern. */
export function ExampleNotifications() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          label="Notifications, 2 unread"
          icon={Bell}
          tooltip={false}
          className="relative"
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="font-medium text-ink">Notifications</p>
        <ul className="mt-3 flex flex-col gap-3">
          <li className="flex flex-col gap-0.5">
            <p className="flex items-center gap-2 font-medium text-ink">
              <Badge tone="info">New</Badge>
              Quotation accepted
            </p>
            <p className="text-ink-secondary">Priya Shah accepted QT-2026-00039.</p>
            <p className="text-xs text-ink-muted">
              <DateTimeText value="2026-10-28T14:40:00Z" timeZone={BUSINESS_TIME_ZONE} />
            </p>
          </li>
          <li className="flex flex-col gap-0.5">
            <p className="flex items-center gap-2 font-medium text-ink">
              <Badge tone="info">New</Badge>
              Request received
            </p>
            <p className="text-ink-secondary">FF-2026-00125 from Morgan Reyes.</p>
            <p className="text-xs text-ink-muted">
              <DateTimeText value="2026-10-28T13:42:00Z" timeZone={BUSINESS_TIME_ZONE} />
            </p>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** A stand-in for the signed-in user's menu (T05). */
export function ExampleUserMenu({ name, role }: { name: string; role: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-11 items-center gap-2 rounded-lg px-1.5 hover:bg-surface-muted sm:h-10"
        >
          <Avatar name={name} size="sm" decorative />
          <span className="sr-only">Account menu for </span>
          <span className="text-left text-sm max-sm:sr-only">
            <span className="block font-medium leading-4 text-ink">{name}</span>
            <span className="block text-xs text-ink-muted">{role}</span>
          </span>
          <ChevronDown aria-hidden="true" className="hidden size-4 text-ink-muted sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          {name} · {role}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/styleguide">
            <Palette aria-hidden="true" />
            Back to the styleguide
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
