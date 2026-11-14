"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

import { DEMO_NOTICE, type DemoAccountOption } from "../demo-accounts";

/**
 * The "Demo accounts" panel on the sign-in page (D-09). Its buttons only fill in the real form:
 * the visitor still presses "Sign in", and the same endpoint checks the same password as for
 * anyone else. There is no special demo login. It is shown only in demo mode.
 */
export function DemoAccountsPanel({
  accounts,
  onUse,
}: {
  accounts: readonly DemoAccountOption[];
  onUse: (account: DemoAccountOption) => void;
}) {
  if (accounts.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="demo-accounts-heading"
      className="flex flex-col gap-3 rounded-lg border border-attention-edge bg-attention-soft p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="demo-accounts-heading" className="text-base font-semibold text-ink">
          Demo accounts
        </h2>
        <p className="text-sm text-ink-secondary">
          {DEMO_NOTICE}{" "}
          <Link
            href="/privacy"
            className="rounded-sm font-medium text-brand underline underline-offset-4 hover:text-brand-hover"
          >
            Read the demo notice
          </Link>
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {accounts.map((account) => (
          <li
            key={account.id}
            className="flex flex-col items-start gap-3 rounded-md bg-surface p-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5 text-sm">
              <p className="font-medium text-ink">
                {account.name}{" "}
                <span className="font-normal text-ink-secondary">· {account.roleLabel}</span>
              </p>
              <p className="break-all text-ink-secondary">
                <span className="sr-only">Email: </span>
                {account.email}
              </p>
              <p className="break-all text-ink-secondary">
                <span className="sr-only">Password: </span>
                <span className="text-ink-muted" aria-hidden="true">
                  Password:{" "}
                </span>
                <code className="rounded bg-surface-muted px-1 py-0.5 text-ink">
                  {account.password}
                </code>
              </p>
              <p className="mt-1 text-ink-secondary">{account.description}</p>
              <ul className="mt-1 list-disc pl-5 text-ink-secondary">
                {account.abilities.map((ability) => (
                  <li key={ability}>{ability}</li>
                ))}
              </ul>
              <p className="mt-1 text-ink-muted">{account.limits}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onUse(account);
              }}
              aria-label={`Use this account: ${account.name}, ${account.roleLabel}`}
              className="shrink-0"
            >
              Use this account
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
