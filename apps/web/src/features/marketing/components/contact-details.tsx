import type { PublicSettingsDto } from "@fixflow/shared";

import { cn } from "@/lib/utils";

import { addressLines, mailtoHref, telHref } from "../lib/contact";
import { CONTENT_ICONS } from "./content-icons";

export interface ContactDetailsProps {
  settings: Pick<PublicSettingsDto, "phone" | "contactEmail" | "address">;
  /** The details sit on the deep-navy footer rather than on a light surface. */
  onDark?: boolean;
  className?: string | undefined;
}

/** Phone, email and address as a list, each with a real `tel:` / `mailto:` link where one applies. */
export function ContactDetails({ settings, onDark, className }: ContactDetailsProps) {
  const Phone = CONTENT_ICONS.phone;
  const Mail = CONTENT_ICONS.mail;
  const MapPin = CONTENT_ICONS["map-pin"];
  const iconClass = cn("mt-0.5 size-5 shrink-0", onDark ? "text-accent-fill" : "text-accent");
  const linkClass = cn(
    "rounded-sm underline-offset-4 hover:underline",
    onDark ? "text-surface" : "text-brand",
  );

  return (
    <ul className={cn("flex flex-col gap-3 text-base", className)}>
      <li className="flex gap-3">
        <Phone aria-hidden="true" className={iconClass} />
        <span>
          <span className="sr-only">Phone: </span>
          <a href={telHref(settings.phone)} className={cn(linkClass, "font-medium")}>
            {settings.phone}
          </a>
        </span>
      </li>
      <li className="flex gap-3">
        <Mail aria-hidden="true" className={iconClass} />
        <span className="min-w-0">
          <span className="sr-only">Email: </span>
          <a
            href={mailtoHref(settings.contactEmail)}
            className={cn(linkClass, "break-all font-medium")}
          >
            {settings.contactEmail}
          </a>
        </span>
      </li>
      <li className="flex gap-3">
        <MapPin aria-hidden="true" className={iconClass} />
        <address className="not-italic">
          <span className="sr-only">Address: </span>
          {addressLines(settings.address).map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </address>
      </li>
    </ul>
  );
}
