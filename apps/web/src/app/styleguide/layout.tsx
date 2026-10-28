import type { Metadata } from "next";
import type { ReactNode } from "react";

import { requireStyleguide } from "./_lib/guard";

export const metadata: Metadata = {
  title: "Styleguide",
  robots: { index: false, follow: false },
};

export default function StyleguideLayout({ children }: { children: ReactNode }) {
  requireStyleguide();
  return children;
}
