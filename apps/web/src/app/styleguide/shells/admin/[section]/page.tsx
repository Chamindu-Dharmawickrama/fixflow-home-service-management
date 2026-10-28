import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DetailSkeleton } from "@/components/ui/skeleton";

import { ExampleSectionPage, sectionTitle } from "../../../_lib/example-section-page";
import { requireStyleguide } from "../../../_lib/guard";
import { ADMIN_EXAMPLE_HOME, ADMIN_EXAMPLE_SECTIONS } from "../../../_lib/shell-nav";

type Params = Promise<{ section: string }>;

export function generateStaticParams() {
  return ADMIN_EXAMPLE_SECTIONS.map((section) => ({ section }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { section } = await params;
  return { title: sectionTitle(section) };
}

async function Section({ params }: { params: Params }) {
  const { section } = await params;
  if (!(ADMIN_EXAMPLE_SECTIONS as readonly string[]).includes(section)) {
    notFound();
  }
  return (
    <ExampleSectionPage
      title={sectionTitle(section)}
      backHref={ADMIN_EXAMPLE_HOME}
      backLabel="Back to the dashboard"
    />
  );
}

export default function AdminSectionExample({ params }: { params: Params }) {
  requireStyleguide();

  return (
    <Suspense fallback={<DetailSkeleton label="Loading page" />}>
      <Section params={params} />
    </Suspense>
  );
}
