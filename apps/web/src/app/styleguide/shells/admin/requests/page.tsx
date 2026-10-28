import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import type { SearchParamsInput } from "@/lib/url";

import { requireStyleguide } from "../../../_lib/guard";
import { ADMIN_EXAMPLE_HOME } from "../../../_lib/shell-nav";
import { RequestQueue } from "../../../_sections/request-queue";

export const metadata: Metadata = { title: "Requests" };

const BASE_PATH = `${ADMIN_EXAMPLE_HOME}/requests`;

async function Queue({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  return (
    <RequestQueue
      basePath={BASE_PATH}
      searchParams={await searchParams}
      rowHref={`${BASE_PATH}/detail`}
    />
  );
}

export default function RequestsExample({
  searchParams,
}: {
  searchParams: Promise<SearchParamsInput>;
}) {
  requireStyleguide();

  return (
    <>
      <PageHeader
        title="Service requests"
        description="Review new requests, ask for missing detail and send a quotation."
      />
      <Suspense fallback={<TableSkeleton rows={8} columns={6} label="Loading requests" />}>
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}
