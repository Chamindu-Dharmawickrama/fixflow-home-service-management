"use client";

import type { GoogleAuthDto } from "@fixflow/shared";
import { useCallback, useState } from "react";

import { apiFetch } from "@/lib/api";
import { navigateWithFullReload } from "@/lib/auth/navigate";
import { destinationAfterSignIn } from "@/lib/auth/paths";

import { describeAuthError } from "../lib/errors";

/**
 * Sends the Google ID token to the API and, when it is accepted, goes to the page the person was
 * headed for. The browser never decides anything from the token: the API verifies it, creates or
 * finds the account and sets the session cookie. A full navigation (not a client-side one) makes
 * every layout read the new session.
 */
export function useGoogleSignIn(returnTo: string | undefined) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const signIn = useCallback(
    async (credential: string) => {
      setError(null);
      setPending(true);
      try {
        const { user } = await apiFetch<GoogleAuthDto>("/auth/google", {
          method: "POST",
          body: { credential },
        });
        navigateWithFullReload(destinationAfterSignIn(returnTo, user.role));
      } catch (caught) {
        setError(describeAuthError(caught));
        setPending(false);
      }
    },
    [returnTo],
  );

  return { signIn, error, pending };
}
