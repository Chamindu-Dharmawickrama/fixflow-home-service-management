"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

/** The slice of Google Identity Services (https://accounts.google.com/gsi/client) this button uses. */
interface GoogleIdentity {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        ux_mode?: "popup" | "redirect";
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type?: "standard" | "icon";
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "large" | "medium" | "small";
          text?: "signin_with" | "signup_with" | "continue_with" | "signin";
          shape?: "rectangular" | "pill";
          logo_alignment?: "left" | "center";
          width?: number;
          locale?: string;
        },
      ): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

// `hl=en` fixes the button's wording to the page's language; without it Google may pick one from the
// visitor's location, which showed "Sign in with Google" in another language on an English page.
const GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client?hl=en";
/** Google's button is between 200 and 400 px wide. */
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

export interface GoogleSignInButtonProps {
  /** The OAuth Web client ID (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`). Without one the button is replaced by an explanation. */
  clientId: string | undefined;
  /** "Sign in with Google" or "Continue with Google": the wording Google's branding guidelines allow. */
  text: "signin_with" | "continue_with";
  /** Called with the ID token Google issued. The caller sends it to the API, which verifies it. */
  onCredential: (credential: string) => void;
}

/**
 * Google's own sign-in button (Google Identity Services), loaded with `next/script` and rendered
 * by Google into the container, as Google's branding guidelines require: the button is not
 * restyled. It hands back an ID token, which only the API may trust and verify. With no client ID
 * configured it says so instead of showing a button that cannot work.
 */
export function GoogleSignInButton({ clientId, text, onCredential }: GoogleSignInButtonProps) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    callback.current = onCredential;
  }, [onCredential]);

  const render = () => {
    const google = window.google;
    const parent = container.current;
    if (google === undefined || parent === null || clientId === undefined) return;

    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (response.credential !== undefined) callback.current(response.credential);
      },
      ux_mode: "popup",
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    parent.replaceChildren();
    google.accounts.id.renderButton(parent, {
      type: "standard",
      theme: "outline",
      size: "large",
      text,
      shape: "rectangular",
      logo_alignment: "left",
      width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(parent.clientWidth))),
      locale: "en",
    });
  };

  if (clientId === undefined) {
    return (
      <p className="rounded-lg border border-border bg-surface-muted p-3 text-sm text-ink-secondary">
        Google sign-in isn&apos;t set up on this site yet. Use your email and password instead.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Script
        src={GSI_SCRIPT_URL}
        strategy="afterInteractive"
        // `onReady` also fires when the script was already on the page (navigating back to this form).
        onReady={render}
        onError={() => {
          setLoadFailed(true);
        }}
      />
      <div
        ref={container}
        data-testid="google-button"
        className="flex min-h-11 w-full justify-center"
      />
      {loadFailed ? (
        <p role="status" className="text-sm text-ink-secondary">
          Google sign-in couldn&apos;t load. Check your connection or use your email and password
          instead.
        </p>
      ) : null}
    </div>
  );
}
