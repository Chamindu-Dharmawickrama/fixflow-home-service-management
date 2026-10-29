import { Skeleton } from "@/components/ui/skeleton";

/**
 * What a signed-in area shows while the session is checked: a quiet page-shaped placeholder, so the
 * URL has already loaded and nothing "pops" into a different layout afterwards.
 */
export function AreaSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-6 py-10"
    >
      <span className="sr-only">Loading your account</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/**
 * The placeholder for a page inside a signed-in area while its data loads: a title, a line of
 * description and two cards. It is the `loading.tsx` of both areas, so every page added beneath
 * them gets a Suspense boundary (and an instant navigation) without doing anything.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
