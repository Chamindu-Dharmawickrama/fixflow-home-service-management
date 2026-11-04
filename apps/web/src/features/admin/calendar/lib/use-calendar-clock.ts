"use client";

import { instantToWallClock } from "@fixflow/shared";
import { useMemo, useSyncExternalStore } from "react";

import type { CalendarView } from "./dates";

/**
 * The two things the calendar learns from the browser after it has loaded: what time it is now (for
 * the line across today's column) and how wide the window is (to choose the default view). Both are
 * `null` on the server and during hydration, so the server's HTML and the first client render agree;
 * the real value arrives in the next render.
 */

const MINUTE_MS = 60_000;

function subscribeToMinutes(onChange: () => void): () => void {
  // Twice a minute, so the line is never more than half a minute late; React ignores a repeat.
  const timer = setInterval(onChange, MINUTE_MS / 2);
  return () => clearInterval(timer);
}

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS);
}

function noMinute(): null {
  return null;
}

export interface BusinessNow {
  /** Today on the business's calendar. */
  date: string;
  /** Minutes after midnight on the business's clocks. */
  minutes: number;
}

/** The current moment on the business's clocks, refreshed every minute; `null` before hydration. */
export function useBusinessNow(timeZone: string): BusinessNow | null {
  const minute = useSyncExternalStore(subscribeToMinutes, currentMinute, noMinute);
  return useMemo(() => {
    if (minute === null) return null;
    const { date, time } = instantToWallClock(new Date(minute * MINUTE_MS), timeZone);
    return { date, minutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) };
  }, [minute, timeZone]);
}

const WIDE = "(min-width: 1024px)";
const MEDIUM = "(min-width: 768px)";

function canMatch(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function subscribeToWidth(onChange: () => void): () => void {
  if (!canMatch()) return () => undefined;
  const queries = [window.matchMedia(WIDE), window.matchMedia(MEDIUM)];
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

function widthView(): CalendarView {
  if (!canMatch()) return "week";
  if (window.matchMedia(WIDE).matches) return "week";
  return window.matchMedia(MEDIUM).matches ? "day" : "agenda";
}

function noView(): null {
  return null;
}

/**
 * The view that fits the window when the address names none: the week on a wide screen (1024 px and
 * up), the day on a tablet (768 to 1023 px) and the agenda on a phone. `null` until the browser has
 * been asked.
 */
export function useViewForWidth(): CalendarView | null {
  return useSyncExternalStore(subscribeToWidth, widthView, noView);
}
