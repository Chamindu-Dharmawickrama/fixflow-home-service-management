"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export interface UnsavedChangesGuard {
  /** The in-app address the person tried to open while the form had unsaved changes, or `null`. */
  pendingHref: string | null;
  /** Dismiss the warning and stay on the form. */
  stay: () => void;
  /** Go where the person was heading, discarding the unsaved changes. */
  leave: () => void;
}

/** True for a plain left-click that the browser would treat as "open this link here". */
function isPlainClick(event: MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * Warns before unsaved form changes are lost (UX-INT-03).
 *
 * - Closing the tab, reloading or typing another address asks the browser's own "leave site?"
 *   question (`beforeunload`; browsers show their own wording).
 * - Clicking a link to another page of the app is intercepted, and `pendingHref` is set so the form
 *   can show a confirmation. The App Router has no navigation-blocking API, so this listens for
 *   clicks in the capture phase, before Next.js's `Link` handles them. The browser's Back button is
 *   not intercepted: there is no reliable way to do that.
 *
 * Pass `false` while nothing needs protecting (the form is clean, or a save is in flight).
 */
export function useUnsavedChangesGuard(active: boolean): UnsavedChangesGuard {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Some browsers still need a return value to show the prompt.
      event.returnValue = "";
    };

    const interceptLinks = (event: MouseEvent) => {
      if (!isPlainClick(event) || !(event.target instanceof Element)) {
        return;
      }
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      if ((anchor.target !== "" && anchor.target !== "_self") || anchor.hasAttribute("download")) {
        return;
      }
      const destination = new URL(anchor.href, window.location.href);
      const here = window.location;
      if (destination.origin !== here.origin) {
        return; // Another site: `beforeunload` asks.
      }
      if (destination.pathname === here.pathname && destination.search === here.search) {
        return; // Same page (a skip link, an in-page anchor): nothing is lost.
      }
      event.preventDefault();
      event.stopPropagation();
      setPendingHref(`${destination.pathname}${destination.search}${destination.hash}`);
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", interceptLinks, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", interceptLinks, true);
    };
  }, [active]);

  const stay = useCallback(() => {
    setPendingHref(null);
  }, []);

  const leave = useCallback(() => {
    if (pendingHref !== null) {
      router.push(pendingHref);
    }
    setPendingHref(null);
  }, [pendingHref, router]);

  return { pendingHref, stay, leave };
}
