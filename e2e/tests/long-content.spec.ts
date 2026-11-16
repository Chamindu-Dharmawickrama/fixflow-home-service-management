import { expect, test } from "@playwright/test";

import { createCustomerAccount, withDatabase } from "../fixtures/accounts.js";
import { createSentQuotationFor } from "../fixtures/quotations.js";
import { createInactiveService } from "../fixtures/requests.js";
import { loginAs } from "../support/auth.js";
import {
  expectNoHorizontalOverflow,
  NAVIGATION_TIMEOUT,
  useViewport,
  WIDTHS,
} from "./helpers/layout.js";

/**
 * Long unbroken words (T25, F-54, F-75, F-79): a 100-character name with no space, in the places a
 * caller's text reaches a header, a meta row or a two-column layout, at all four widths. Found
 * before: such a name widened whole pages (T12, T16, T17); the shared fix is `min-w-0` with
 * `[overflow-wrap:anywhere]` on flex items and `grid-cols-1` below `lg`.
 */

test.describe.configure({ timeout: 180_000 });

const LONG = "W".repeat(100);

test("a 100-character customer name does not widen the request or quotation pages", async ({
  browser,
}) => {
  const customer = await createCustomerAccount({ name: LONG });
  const { request, quotation } = await createSentQuotationFor(customer.id);

  const admin = await (await browser.newContext()).newPage();
  await loginAs(admin, "admin");
  const owner = await (await browser.newContext()).newPage();
  await loginAs(owner, { email: customer.email, password: customer.password });

  for (const width of WIDTHS) {
    for (const [page, path] of [
      [admin, `/app/requests/${request.id}`],
      [admin, `/app/quotations/${quotation.id}`],
      [owner, `/portal/requests/${request.id}`],
      [owner, `/portal/quotations/${quotation.id}`],
    ] as const) {
      await useViewport(page, width);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: NAVIGATION_TIMEOUT,
      });
      await expectNoHorizontalOverflow(page);
    }
  }
});

test("the service editor keeps a long unbroken description inside the screen below the wide layout", async ({
  page,
}) => {
  const service = await createInactiveService("unpublished");
  await withDatabase((prisma) =>
    prisma.service.update({
      where: { id: service.id },
      data: { shortDescription: `Short ${LONG}`, fullDescription: `Full ${LONG}` },
    }),
  );
  await loginAs(page, "admin");
  for (const width of [360, 768, 1024] as const) {
    await useViewport(page, width);
    await page.goto(`/app/settings/services/${service.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: NAVIGATION_TIMEOUT,
    });
    await expectNoHorizontalOverflow(page);
  }
});
