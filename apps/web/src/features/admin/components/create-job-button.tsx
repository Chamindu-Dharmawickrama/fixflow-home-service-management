"use client";

import type { AdminWorkOrderDto } from "@fixflow/shared";
import { Briefcase } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormAlert } from "@/components/forms/form-alert";
import { Button } from "@/components/ui/button";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";

import { adminJobSchedulePath } from "../lib/jobs";

/**
 * "Create job" (FR-050, workflow 7.4): turns the customer's accepted quotation into a job and goes
 * straight to it with the scheduling dialog open, because giving it a time is the next thing to do.
 * Nothing is typed again: the server copies the customer, service, address and scope. It is safe to
 * press twice: the server answers an existing job with that job, so the second press lands on the
 * same page. The button stays blocked from the press until the page has moved on.
 */
export function CreateJobButton({ quotationId }: { quotationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setPending(true);
    setError(null);
    try {
      const job = await apiFetch<Pick<AdminWorkOrderDto, "id">>(
        `/admin/quotations/${encodeURIComponent(quotationId)}/work-order`,
        { method: "POST" },
      );
      router.push(adminJobSchedulePath(job.id));
      return;
    } catch (caught) {
      // The request or the quotation is not as the page showed it: reload, so the page tells the truth.
      if (isApiError(caught) && (caught.status === 404 || caught.status === 409)) {
        router.refresh();
      }
      setError(describeApiError(caught));
    }
    setPending(false);
  };

  return (
    <>
      <Button onClick={() => void create()} loading={pending} loadingText="Creating the job…">
        <Briefcase aria-hidden="true" />
        Create job
      </Button>
      {error === null ? null : (
        <FormAlert tone="error" className="w-full sm:max-w-md">
          {error}
        </FormAlert>
      )}
    </>
  );
}
