import type { ServiceAddressDto } from "@fixflow/shared";

type AddressParts = Pick<ServiceAddressDto, "line1" | "line2" | "city" | "region" | "postalCode">;

/**
 * An address as the lines it is written on: the street, the optional second line, then
 * "City, Region 12345". Empty parts are left out, so there is never a stray comma or a blank line.
 */
export function formatAddressLines(address: AddressParts): string[] {
  const cityLine = [
    [address.city, address.region].filter((part) => part !== null && part !== "").join(", "),
    address.postalCode,
  ]
    .filter((part) => part !== "")
    .join(" ");

  return [address.line1, address.line2 ?? "", cityLine].filter((line) => line !== "");
}

/** The same address on one line, for places that have no room for several. */
export function formatAddressOneLine(address: AddressParts): string {
  return formatAddressLines(address).join(", ");
}
