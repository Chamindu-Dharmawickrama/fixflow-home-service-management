import { describe, expect, it } from "vitest";

import { addressLines, mailtoHref, telHref } from "./contact";

describe("telHref", () => {
  it("keeps only the digits of a phone number as people write it", () => {
    expect(telHref("(212) 555-0142")).toBe("tel:2125550142");
    expect(telHref("212.555.0142")).toBe("tel:2125550142");
  });

  it("keeps a leading plus for an international number", () => {
    expect(telHref("+44 20 7946 0958")).toBe("tel:+442079460958");
  });
});

describe("mailtoHref", () => {
  it("builds a mailto link and trims the address", () => {
    expect(mailtoHref(" hello@coolbreeze.test ")).toBe("mailto:hello@coolbreeze.test");
  });
});

describe("addressLines", () => {
  it("lists the street, the unit and the town line", () => {
    expect(
      addressLines({
        line1: "48 Harbor Point Road",
        line2: "Unit 3",
        city: "Harbor City",
        region: "NY",
        postalCode: "10999",
      }),
    ).toEqual(["48 Harbor Point Road", "Unit 3", "Harbor City, NY 10999"]);
  });

  it("leaves out what is not there", () => {
    expect(
      addressLines({
        line1: "1 High Street",
        line2: null,
        city: "Leeds",
        region: null,
        postalCode: "LS1 4AB",
      }),
    ).toEqual(["1 High Street", "Leeds, LS1 4AB"]);
  });
});
