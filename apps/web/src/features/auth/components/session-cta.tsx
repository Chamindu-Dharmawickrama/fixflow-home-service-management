import { Role } from "@fixflow/shared";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button-variants";
import { LOGIN_PATH, roleHomePath } from "@/lib/auth/paths";
import { getSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/** On a phone the account link is a little smaller, to leave the business name room beside it. */
const COMPACT_ON_PHONES = "max-sm:h-9 max-sm:px-3";

/**
 * The session-aware call to action in the public header: "Sign in" for a visitor, "Dashboard" for
 * the business admin, "My account" for a customer (spec §9). It reads the session, so it streams
 * in behind a `<Suspense>` boundary and the rest of the public page stays static. If the API is
 * unreachable it shows "Sign in", the safe default, instead of breaking a public page.
 */
export async function SessionCta() {
  let label = "Sign in";
  let href = LOGIN_PATH;

  try {
    const session = await getSession();
    if (session.status === "signed-in") {
      label = session.user.role === Role.BUSINESS_ADMIN ? "Dashboard" : "My account";
      href = roleHomePath(session.user.role);
    }
  } catch {
    // Public pages must render even when the API is down.
  }

  return (
    <Link
      href={href}
      className={cn(buttonVariants({ variant: "outline", size: "md" }), COMPACT_ON_PHONES)}
    >
      {label}
    </Link>
  );
}

/** What the header shows while the session is being read: the same size, no flash of the wrong label. */
export function SessionCtaFallback() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-9 w-20 rounded-lg bg-surface-muted motion-safe:animate-pulse sm:h-10 sm:w-24"
    />
  );
}
