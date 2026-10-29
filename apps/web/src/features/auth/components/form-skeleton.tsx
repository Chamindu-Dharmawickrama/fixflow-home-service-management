import { Skeleton } from "@/components/ui/skeleton";

/** The placeholder inside the auth card while the page reads the URL and the session. */
export function AuthFormSkeleton({ label, fields = 2 }: { label: string; fields?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-5">
      <span className="sr-only">{label}</span>
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-11 w-full sm:h-10" />
        </div>
      ))}
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
