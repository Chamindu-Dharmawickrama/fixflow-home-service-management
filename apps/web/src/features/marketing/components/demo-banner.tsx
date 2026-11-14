"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { DEMO_NOTICE } from "../content/site-content";

const STORAGE_KEY = "fixflow.demoBannerDismissed";
const CHANGE_EVENT = "fixflow:demo-banner-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Dismissal is remembered for the browser session only (a tab), so the notice returns next visit. */
function isDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The server (and the first client render) always show the banner, so dismissing never shifts hydration. */
function isDismissedOnServer(): boolean {
  return false;
}

export function bannerText(businessName: string | undefined): string {
  return businessName
    ? DEMO_NOTICE.banner.replace("{business}", businessName)
    : DEMO_NOTICE.bannerWithoutName;
}

export interface DemoBannerProps {
  businessName?: string | undefined;
}

/**
 * The slim portfolio-demo notice above the header (D-31): "FixFlow portfolio demo — CoolBreeze Home
 * Services is a fictional business. Data resets daily." with a link to the privacy notice. It
 * can be dismissed for the rest of the session. It is only mounted in demo mode.
 */
export function DemoBanner({ businessName }: DemoBannerProps) {
  const dismissed = useSyncExternalStore(subscribe, isDismissed, isDismissedOnServer);

  if (dismissed) {
    return null;
  }

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Private mode or blocked storage: the banner still closes for this page view below.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <div
      role="region"
      aria-label="Demo notice"
      className="border-b border-border bg-brand-soft text-ink"
    >
      <div className="mx-auto flex w-full max-w-7xl items-start gap-3 px-4 py-2 text-sm sm:px-6 lg:px-8">
        <p className="min-w-0 flex-1 text-pretty py-0.5">
          {bannerText(businessName)}{" "}
          <Link
            href="/privacy"
            className="whitespace-nowrap rounded-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            {DEMO_NOTICE.linkLabel}
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss demo notice"
          className="-my-0.5 -mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors duration-150 ease-standard hover:bg-surface hover:text-ink"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
