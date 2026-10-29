import type { PublicSettingsDto } from "@fixflow/shared";

/** `tel:` address for a phone number as people write it: "(212) 555-0142" → "tel:2125550142"; a leading + is kept. */
export function telHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

export function mailtoHref(email: string): string {
  return `mailto:${email.trim()}`;
}

/** The address as lines for display: street (and unit), then "City, REGION 12345". */
export function addressLines(address: PublicSettingsDto["address"]): string[] {
  const cityLine = [
    address.city,
    [address.region, address.postalCode].filter((part) => part && part.trim() !== "").join(" "),
  ]
    .filter((part) => part && part.trim() !== "")
    .join(", ");
  return [address.line1, address.line2, cityLine].filter(
    (line): line is string => typeof line === "string" && line.trim() !== "",
  );
}
