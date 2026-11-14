import {
  ActivityEntityType,
  type AdminSettingsDto,
  ErrorCode,
  type PublicSettingsDto,
} from "@fixflow/shared";

import type { AppDeps } from "../../deps.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { BUSINESS_SETTINGS_ID, type DbClient } from "../../lib/db.js";
import { AppError, notFound, serviceUnavailable } from "../../lib/errors.js";
import { buildActivitySummaries } from "../activity/activity.domain.js";
import { recordActivity } from "../activity/activity.service.js";
import type { AuthContext } from "../auth/auth.types.js";
import {
  changedIdentityFields,
  changedSettingsFields,
  IDENTITY_LOCKED_MESSAGE,
  identityLockedFor,
  logoConflict,
  type SettingsPatch,
} from "./settings.domain.js";
import { toAdminSettingsDto, toPublicSettingsDto, toSettingsValues } from "./settings.dto.js";

type SettingsDeps = Pick<AppDeps, "prisma">;
type AdminSettingsDeps = Pick<AppDeps, "prisma" | "config">;

const NOT_SET_UP = "The business settings have not been set up yet.";

async function loadSettings(db: Pick<DbClient, "businessSettings">) {
  const row = await db.businessSettings.findUnique({ where: { id: BUSINESS_SETTINGS_ID } });
  if (row === null) {
    // The seed creates the row; its absence is a deployment problem, not something to hide as a 404.
    throw serviceUnavailable(NOT_SET_UP);
  }
  return row;
}

/** What a visitor to the website may read (FR-002). */
export async function getPublicSettings(deps: SettingsDeps): Promise<PublicSettingsDto> {
  return toPublicSettingsDto(await loadSettings(deps.prisma));
}

export async function getAdminSettings(
  deps: AdminSettingsDeps,
  auth: AuthContext,
): Promise<AdminSettingsDto> {
  const identityLocked = identityLockedFor(deps.config, auth.email);
  return toAdminSettingsDto(await loadSettings(deps.prisma), { identityLocked });
}

/**
 * Applies a settings change (FR-100). Only fields whose value really differs are written, so
 * saving an untouched form changes nothing and leaves no history. The change and its `SETTINGS`
 * activity event (field *names* only, never the values) are one transaction.
 */
export async function updateSettings(
  deps: AdminSettingsDeps,
  auth: AuthContext,
  patch: SettingsPatch,
): Promise<AdminSettingsDto> {
  const identityLocked = identityLockedFor(deps.config, auth.email);
  return deps.prisma.$transaction(async (tx) => {
    const current = await loadSettings(tx);
    const currentValues = toSettingsValues(current);

    // The public demo's shared admin may not rewrite what the website says about the business (Q-11).
    // The whole change is refused, so nothing is half saved; the form never sends these fields.
    const lockedChanges = identityLocked ? changedIdentityFields(currentValues, patch) : [];
    if (lockedChanges.length > 0) {
      throw new AppError(403, ErrorCode.DEMO_ACCOUNT_LOCKED, IDENTITY_LOCKED_MESSAGE, {
        fieldErrors: Object.fromEntries(
          lockedChanges.map((field) => [field, "Locked in the public demo."]),
        ),
      });
    }

    // The logo is one choice spread over two columns: check what would be stored, not what was sent.
    const conflict = logoConflict({
      logoKey: patch.logoKey !== undefined ? patch.logoKey : currentValues.logoKey,
      logoUrl: patch.logoUrl !== undefined ? patch.logoUrl : currentValues.logoUrl,
    });
    if (conflict !== null) {
      throw new AppError(422, ErrorCode.VALIDATION_ERROR, "The request contains invalid values.", {
        fieldErrors: { logoUrl: conflict },
      });
    }

    const changedFields = changedSettingsFields(currentValues, patch);
    if (changedFields.length === 0) {
      return toAdminSettingsDto(current, { identityLocked });
    }

    const actor = await tx.user.findUnique({ where: { id: auth.userId }, select: { name: true } });
    if (actor === null) {
      throw notFound();
    }

    // Only the changed fields, named from the closed `SETTINGS_FIELDS` list and already validated.
    const data = Object.fromEntries(
      changedFields.map((field) => [field, patch[field]]),
    ) as Prisma.BusinessSettingsUncheckedUpdateInput;
    const updated = await tx.businessSettings.update({
      where: { id: BUSINESS_SETTINGS_ID },
      data: { ...data, updatedByUserId: auth.userId },
    });

    await recordActivity(tx, {
      actorUserId: auth.userId,
      entityType: ActivityEntityType.SETTINGS,
      entityId: BUSINESS_SETTINGS_ID,
      action: "settings.updated",
      ...buildActivitySummaries({
        actor: { kind: "staff", name: actor.name },
        staff: `updated the business settings (${changedFields.join(", ")})`,
      }),
      metadata: { changedFields },
    });

    return toAdminSettingsDto(updated, { identityLocked });
  });
}
