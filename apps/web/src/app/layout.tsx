import "./globals.css";

import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { SkipLink } from "@/components/layout/skip-link";
import { Toaster } from "@/components/ui/sonner";

// Self-hosted variable fonts (SIL Open Font License, see ./fonts): no request to a font CDN at
// build time or in the browser. Inter carries the interface and every number; Bricolage Grotesque
// is the display face for page titles and marketing headings.
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  adjustFontFallback: "Arial",
});

const bricolage = localFont({
  src: "./fonts/bricolage-grotesque-latin-wght-normal.woff2",
  variable: "--font-bricolage",
  weight: "200 800",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  // Product pages read "Requests · FixFlow"; public business pages set an absolute title (D-31).
  title: { default: "FixFlow", template: "%s · FixFlow" },
  description:
    "Home-service requests, quotations, scheduling and invoicing for a small service business.",
  applicationName: "FixFlow",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${bricolage.variable}`}>
      <body className="min-h-dvh bg-page font-sans text-base text-ink">
        <SkipLink />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
