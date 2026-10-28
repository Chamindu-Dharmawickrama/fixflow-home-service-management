import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { Section } from "../_lib/section";

const SHELLS = [
  {
    href: "/styleguide/shells/public",
    title: "Public layout",
    description:
      "Business identity, navigation, mobile disclosure menu, call to action and the “Powered by FixFlow” footer. Home and services list.",
  },
  {
    href: "/styleguide/shells/auth",
    title: "Auth layout",
    description: "Sign-in and registration frames with the brand panel from 1024 px.",
  },
  {
    href: "/styleguide/shells/admin",
    title: "Admin shell",
    description: "Sidebar from 1024 px, drawer below. Dashboard, request queue and request detail.",
  },
  {
    href: "/styleguide/shells/portal",
    title: "Portal shell",
    description: "Top navigation and drawer. Overview, quotation review and invoice.",
  },
] as const;

export function ShellLinksSection() {
  return (
    <Section
      id="shells"
      title="Application shells"
      description="Each shell is shown full-page with realistic example content. Resize the window to see the sidebar become a drawer and the table become cards."
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {SHELLS.map((shell) => (
          <li key={shell.href}>
            <Card className="relative h-full transition-colors duration-150 ease-standard hover:border-border-strong">
              <CardHeader>
                <CardTitle>
                  <Link
                    href={shell.href}
                    className="inline-flex items-center gap-1.5 rounded-sm after:absolute after:inset-0 after:rounded-xl"
                  >
                    {shell.title}
                    <ArrowUpRight aria-hidden="true" className="size-4 text-ink-muted" />
                  </Link>
                </CardTitle>
                <CardDescription>{shell.description}</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}
