import { API_PREFIX } from "@fixflow/shared";
import type { NextConfig } from "next";

// Server-only (never NEXT_PUBLIC_*): where the Next.js server reaches the Express API.
// The browser only ever calls `/api/v1/*` on the web origin, so the session cookie stays
// first-party (D-06). Deployments must set API_INTERNAL_URL; the default is for local development.
// The destination is baked into the build, so a Vercel build without it would proxy every API call to
// localhost and fail only at runtime: refuse to build instead (F-03).
if (process.env.VERCEL && !process.env.API_INTERNAL_URL) {
  throw new Error(
    "API_INTERNAL_URL is not set. Add it to the Vercel project's environment variables (the API's https URL) and redeploy.",
  );
}

const apiInternalUrl = (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(
  /\/+$/,
  "",
);

const nextConfig: NextConfig = {
  // Only the E2E suite sets this: its second dev server (an API that cannot be reached, T08) must not
  // share a build folder with the first.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Defaults from create-next-app 16.4.3; the next Next.js major enables both everywhere (see D-55).
  cacheComponents: true,
  partialPrefetching: true,
  // Project instructions live in CLAUDE.md; do not let `next dev` generate competing AGENTS.md files.
  agentRules: false,
  transpilePackages: ["@fixflow/shared"],
  rewrites: () =>
    Promise.resolve([
      {
        source: `${API_PREFIX}/:path*`,
        destination: `${apiInternalUrl}${API_PREFIX}/:path*`,
      },
    ]),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
