"use client";

import type { AssignableTechnicianDto, SchedulingConflictDto } from "@fixflow/shared";
import { useEffect, useState } from "react";

import { apiFetch, describeApiError } from "@/lib/api";

import { type ConflictsRequest, conflictsRoute } from "./schedule-form";

/**
 * The scheduling dialog's three look-ups. Each keeps its answer together with the key it was asked
 * for, and says it is still loading whenever the key it holds is not the one wanted now. So an
 * answer that arrives late for an earlier choice can never be shown as the answer to the current one,
 * and no state is set while an effect is only starting (the answer is set when it arrives).
 */

/** How long the exact-time check waits after the last change before it asks the server. */
export const CONFLICT_CHECK_DEBOUNCE_MS = 350;

type Loaded<T> = { key: string; value: T } | { key: string; error: string };

export type Lookup<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "error"; message: string };

function resolveLookup<T>(wantedKey: string | null, held: Loaded<T> | null): Lookup<T> {
  if (wantedKey === null) return { status: "idle" };
  if (held === null || held.key !== wantedKey) return { status: "loading" };
  return "error" in held
    ? { status: "error", message: held.error }
    : { status: "ready", value: held.value };
}

/**
 * The technicians who can be given a job (FR-061): active ones only, A to Z. Loaded each time the
 * dialog opens, so a technician deactivated a moment ago is not offered. `retry` asks again.
 */
export function useAssignableTechnicians(): {
  lookup: Lookup<AssignableTechnicianDto[]>;
  retry: () => void;
} {
  const [attempt, setAttempt] = useState(0);
  const [held, setHeld] = useState<Loaded<AssignableTechnicianDto[]> | null>(null);
  const key = String(attempt);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<AssignableTechnicianDto[]>("/admin/technicians/assignable", {
      signal: controller.signal,
    }).then(
      (value) => {
        // A late answer (this look-up was replaced meanwhile) must not replace a newer one.
        if (!controller.signal.aborted) setHeld({ key, value });
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return;
        setHeld({ key, error: describeApiError(caught, "We couldn't load the technicians.") });
      },
    );
    return () => controller.abort();
  }, [key]);

  return { lookup: resolveLookup(key, held), retry: () => setAttempt((count) => count + 1) };
}

/** What one look at a technician's time asks: whose, between which instants, leaving out which job. */
export interface WindowQuery {
  technicianId: string;
  startMs: number;
  endMs: number;
  /** The job being scheduled, so it never clashes with its own old appointment. */
  excludeId: string;
}

/** The query for a window given as dates, or `null` while there is nothing to ask. */
export function windowQuery(request: ConflictsRequest | null): WindowQuery | null {
  return request === null
    ? null
    : {
        technicianId: request.technicianId,
        startMs: request.start.getTime(),
        endMs: request.end.getTime(),
        excludeId: request.excludeId,
      };
}

/**
 * The jobs one technician has inside a window, from the read-only pre-check (FR-054). With
 * `debounceMs` the question is asked only once the window has stopped changing; without it, at once.
 * It is a convenience: the schedule endpoint checks again, and that check is the one that counts.
 */
export function useJobsInWindow(
  query: WindowQuery | null,
  debounceMs: number,
): Lookup<SchedulingConflictDto[]> {
  const [held, setHeld] = useState<Loaded<SchedulingConflictDto[]> | null>(null);
  const technicianId = query?.technicianId ?? null;
  const startMs = query?.startMs ?? 0;
  const endMs = query?.endMs ?? 0;
  const excludeId = query?.excludeId ?? "";
  const key = technicianId === null ? null : `${technicianId}|${startMs}|${endMs}|${excludeId}`;

  useEffect(() => {
    if (technicianId === null || key === null) return;
    const controller = new AbortController();
    const route = conflictsRoute({
      technicianId,
      start: new Date(startMs),
      end: new Date(endMs),
      excludeId,
    });
    const ask = () => {
      apiFetch<SchedulingConflictDto[]>(route, { signal: controller.signal }).then(
        (value) => {
          // A late answer (the window changed meanwhile) must not replace a newer one.
          if (!controller.signal.aborted) setHeld({ key, value });
        },
        (caught: unknown) => {
          if (controller.signal.aborted) return;
          setHeld({ key, error: describeApiError(caught, "We couldn't check the schedule.") });
        },
      );
    };
    const timer = debounceMs > 0 ? setTimeout(ask, debounceMs) : undefined;
    if (timer === undefined) ask();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    };
  }, [key, technicianId, startMs, endMs, excludeId, debounceMs]);

  return resolveLookup(key, held);
}
