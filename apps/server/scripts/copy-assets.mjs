// Copies the files the compiled server reads at run time next to their compiled modules. `tsc` emits
// JavaScript only, so the invoice PDF's bundled fonts and logos (src/modules/invoices/pdf/assets)
// would otherwise be missing from `dist` and the first download would fail.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ASSET_DIRECTORIES = ["modules/invoices/pdf/assets"];

for (const directory of ASSET_DIRECTORIES) {
  const from = join(root, "src", directory);
  const to = join(root, "dist", directory);
  if (!existsSync(from)) {
    throw new Error(`Missing asset directory: ${from}`);
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
