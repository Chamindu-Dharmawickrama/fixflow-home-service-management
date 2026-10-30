"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { navigateWithFullReload } from "@/lib/auth/navigate";

/** A plain "Sign out" button for pages that have no user menu. */
export function SignOutButton({ variant = "outline" }: { variant?: "outline" | "primary" }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        variant={variant}
        loading={pending}
        loadingText="Signing out…"
        onClick={() => {
          setPending(true);
          setFailed(false);
          apiFetch("/auth/logout", { method: "POST" })
            .then(() => {
              navigateWithFullReload("/");
            })
            .catch(() => {
              setPending(false);
              setFailed(true);
            });
        }}
      >
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
      {failed ? (
        <FormAlert tone="error">
          Couldn&apos;t sign you out. Check your connection and try again.
        </FormAlert>
      ) : null}
    </div>
  );
}
