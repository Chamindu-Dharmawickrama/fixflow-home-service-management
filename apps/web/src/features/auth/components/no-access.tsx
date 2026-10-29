import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";
import { Logo } from "@/components/ui/logo";
import { PermissionDenied } from "@/components/ui/permission-denied";

import { SignOutButton } from "./sign-out-button";

/**
 * Shown when the account is signed in but may not use anything: an administrator whose address is
 * no longer on the allowlist. Nothing of the admin area is rendered; the only way forward is to
 * sign out (and ask the business owner to restore access).
 */
export function NoAccessPage() {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-6 px-6 outline-none"
    >
      <Logo />
      <PermissionDenied
        headingLevel="h1"
        className="w-full"
        title="This account has no access"
        message="You're signed in, but this account is not allowed to use the application. If you think that's a mistake, ask the business owner to check your access."
        action={<SignOutButton />}
      />
    </main>
  );
}
