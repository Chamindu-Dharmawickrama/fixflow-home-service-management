import { notFound } from "next/navigation";

/** The styleguide exists only outside production builds. */
export function isStyleguideEnabled(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

/**
 * Call from the styleguide layout and from every styleguide page: layouts and pages render
 * independently, so a guard in the layout alone would not protect a page reached by itself.
 */
export function requireStyleguide(): void {
  if (!isStyleguideEnabled()) {
    notFound();
  }
}
