import { redirect } from "next/navigation";

import { roleHomePath } from "@/lib/auth/paths";
import { getSession } from "@/lib/auth/session";

/**
 * Put at the top of a sign-in or sign-up page: someone who is already signed in goes to their
 * own home instead of seeing a form they do not need. Renders nothing otherwise. If the API is
 * unreachable the form is shown anyway, so a visitor is never locked out of the page.
 */
export async function SignedInRedirect() {
  let destination: string | undefined;
  try {
    const session = await getSession();
    if (session.status === "signed-in") {
      destination = roleHomePath(session.user.role);
    }
  } catch {
    destination = undefined;
  }
  if (destination !== undefined) {
    redirect(destination);
  }
  return null;
}
