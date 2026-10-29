"use client";

import { useEffect } from "react";

import { apiFetch } from "@/lib/api";

const STORAGE_KEY = "fixflow:session-checked-at";
/** Matches the API's renewal interval (D-10): asking more often cannot extend the session further. */
export const KEEP_ALIVE_INTERVAL_MS = 30 * 60 * 1000;

function lastCheck(): number {
  try {
    return Number(window.localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function remember(time: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(time));
  } catch {
    // Storage can be blocked (private windows); the check then simply runs on every visit.
  }
}

/**
 * Keeps the session cookie as fresh as the session. The API renews a session after an hour of
 * use (D-10) and sends a new `Set-Cookie` with the response, but pages that only read data are
 * rendered on the web server, which cannot pass that header on. So, at most every 30 minutes,
 * and only while the tab is visible, this asks the API who is signed in through the browser,
 * which lets the renewed cookie reach the browser. It renders nothing. A failure is ignored: the
 * next real request tells the person if they have been signed out.
 */
export function SessionKeepAlive() {
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck() < KEEP_ALIVE_INTERVAL_MS) return;
      remember(now);
      void apiFetch("/auth/me").catch(() => undefined);
    };

    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return null;
}
