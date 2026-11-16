import { type Express, Router } from "express";

/** One registered route: the HTTP method (upper case) and the full path, as Express matches it. */
export interface RegisteredRoute {
  method: string;
  path: string;
}

interface RouteLike {
  path: string;
  methods: Record<string, boolean | undefined>;
}

interface LayerLike {
  route?: RouteLike;
  handle: unknown;
}

interface RouterLike {
  stack: LayerLike[];
}

type UseFunction = (this: RouterLike, ...args: unknown[]) => unknown;

function isRouter(value: unknown): value is RouterLike {
  return (
    typeof value === "function" && Array.isArray((value as unknown as { stack?: unknown }).stack)
  );
}

function joinPath(prefix: string, path: string): string {
  const joined = `${prefix.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`.replace(/\/+$/, "");
  return joined === "" ? "/" : joined;
}

/**
 * Every route registered on the app that `build` creates, found by walking Express's own router
 * stacks (T25). Express 5 does not keep the path a router was mounted on (`app.use("/x", router)`),
 * so while `build` runs, `Router.prototype.use` is wrapped to remember each new layer's mount path;
 * it is put back before this returns. Routes registered twice (a guard, then the validated handler)
 * appear once. Middleware that is not a route (`router.use(requireAdmin)`) is not a route.
 *
 * Test-only: the authorization matrix uses it so that a route added without a matrix entry fails.
 */
export function listRegisteredRoutes(build: () => Express): RegisteredRoute[] {
  // `Router()` returns a function whose prototype is a fresh per-router object; the shared methods
  // live further up the chain, on the object that owns `use`.
  let prototype = Object.getPrototypeOf(Router()) as { use: UseFunction } | null;
  while (prototype !== null && !Object.prototype.hasOwnProperty.call(prototype, "use")) {
    prototype = Object.getPrototypeOf(prototype) as { use: UseFunction } | null;
  }
  if (prototype === null) {
    throw new Error("Express's Router.prototype.use was not found; the route inventory needs it.");
  }
  const originalUse = prototype.use;
  const mountPaths = new WeakMap<LayerLike, string>();

  prototype.use = function rememberMountPath(this: RouterLike, ...args: unknown[]) {
    const before = this.stack.length;
    const result = originalUse.apply(this, args);
    const path = typeof args[0] === "string" ? args[0] : "/";
    for (const layer of this.stack.slice(before)) {
      mountPaths.set(layer, path);
    }
    return result;
  };

  let app: Express;
  try {
    app = build();
  } finally {
    prototype.use = originalUse;
  }

  const seen = new Set<string>();
  const routes: RegisteredRoute[] = [];
  const walk = (router: RouterLike, prefix: string): void => {
    for (const layer of router.stack) {
      if (layer.route !== undefined) {
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled !== true) continue;
          const route = { method: method.toUpperCase(), path: joinPath(prefix, layer.route.path) };
          const key = `${route.method} ${route.path}`;
          if (!seen.has(key)) {
            seen.add(key);
            routes.push(route);
          }
        }
      } else if (isRouter(layer.handle)) {
        walk(layer.handle, joinPath(prefix, mountPaths.get(layer) ?? "/"));
      }
    }
  };
  walk(app.router as unknown as RouterLike, "/");
  return routes;
}
