"use client";

import { type AdminServiceDto, ServiceAction } from "@fixflow/shared";
import { Archive, ArchiveRestore } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { FormAlert } from "@/features/auth/components/form-alert";
import { apiFetch, describeApiError, isApiError } from "@/lib/api";
import { getStatusMeta } from "@/lib/formatting/status";

export interface ServiceVisibilityCardProps {
  service: Pick<AdminServiceDto, "id" | "name" | "status" | "availableActions">;
  /**
   * Stops the controls, for example while the form beside them has unsaved changes: publishing
   * would otherwise go live without them. `reason` says why, in words.
   */
  disabled?: boolean | undefined;
  reason?: string | undefined;
}

type Pending = "publish" | "archive" | "restore" | null;

/**
 * Where a service stands, and what the admin can do about it (FR-101, D-43): publish or unpublish
 * with a switch, archive or restore with a confirmation. It shows only the actions the server
 * lists in `availableActions` and sends the status it was shown as `expectedStatus`, so a service
 * that someone else changed meanwhile is refused with a message (D-46) instead of being overwritten.
 * Nothing is announced as done until the server has said so.
 */
export function ServiceVisibilityCard({
  service,
  disabled = false,
  reason,
}: ServiceVisibilityCardProps) {
  const router = useRouter();
  const switchId = useId();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"archive" | "restore" | null>(null);

  const can = (action: ServiceAction) => service.availableActions.includes(action);
  const canToggle = can(ServiceAction.PUBLISH) || can(ServiceAction.UNPUBLISH);
  const published = service.status === "PUBLISHED";
  const blocked = disabled || pending !== null;

  /** After a failure the page is reloaded when the service had moved on, so it shows the truth. */
  const failed = (caught: unknown) => {
    setError(describeApiError(caught));
    if (isApiError(caught) && caught.status === 409) {
      router.refresh();
    }
  };

  const setPublished = async (next: boolean) => {
    setPending("publish");
    setError(null);
    try {
      await apiFetch(`/admin/services/${service.id}`, {
        method: "PATCH",
        body: { isPublished: next, expectedStatus: service.status },
      });
      toast.success(next ? `“${service.name}” is published` : `“${service.name}” is unpublished`, {
        description: next
          ? "It now appears on the website and can be requested."
          : "It is hidden from the website. Existing requests are unaffected.",
      });
      router.refresh();
    } catch (caught) {
      failed(caught);
    } finally {
      setPending(null);
    }
  };

  const transition = async (action: "archive" | "restore") => {
    try {
      await apiFetch(`/admin/services/${service.id}/${action}`, {
        method: "POST",
        body: { expectedStatus: service.status },
      });
    } catch (caught) {
      // Shown inside the dialog, which stays open; the page is reloaded if the service moved on.
      if (isApiError(caught) && caught.status === 409) {
        router.refresh();
      }
      throw new Error(describeApiError(caught));
    }
    toast.success(
      action === "archive" ? `“${service.name}” is archived` : `“${service.name}” is restored`,
      {
        description:
          action === "archive"
            ? "It is hidden from the website. You can restore it at any time."
            : "It is back as unpublished. Publish it when it is ready for the website.",
      },
    );
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h2">Visibility</CardTitle>
          <StatusBadge kind="service" status={service.status} />
        </div>
        <CardDescription>{getStatusMeta("service", service.status).description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error !== null ? <FormAlert tone="error">{error}</FormAlert> : null}

        {canToggle ? (
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={switchId}>Published on the website</Label>
            <Switch
              id={switchId}
              checked={published}
              disabled={blocked}
              onCheckedChange={(next) => {
                void setPublished(next);
              }}
            />
          </div>
        ) : null}

        {disabled && reason ? <p className="text-sm text-ink-secondary">{reason}</p> : null}

        {can(ServiceAction.ARCHIVE) ? (
          <Button
            variant="outline"
            disabled={blocked}
            onClick={() => {
              setConfirming("archive");
            }}
          >
            <Archive aria-hidden="true" />
            Archive service
          </Button>
        ) : null}
        {can(ServiceAction.RESTORE) ? (
          <Button
            variant="outline"
            disabled={blocked}
            onClick={() => {
              setConfirming("restore");
            }}
          >
            <ArchiveRestore aria-hidden="true" />
            Restore service
          </Button>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={confirming === "archive"}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={`Archive “${service.name}”?`}
        consequence="Archived services are hidden from the website and can't be requested. Existing requests are unaffected. You can restore it later."
        confirmLabel="Archive service"
        destructive
        onConfirm={() => transition("archive")}
      />
      <ConfirmDialog
        open={confirming === "restore"}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={`Restore “${service.name}”?`}
        consequence="The service comes back as unpublished. It stays off the website until you publish it."
        confirmLabel="Restore service"
        onConfirm={() => transition("restore")}
      />
    </Card>
  );
}
