/**
 * A pass-through proxy between the E2E web server and the API (T25), started by the Playwright
 * config: `node support/fault-proxy.ts`. It forwards every request unchanged, both the Next.js
 * server's own reads (Server Components) and the browser's calls through the `/api/v1/*` rewrite,
 * and lets a test make **its own** requests fail, which Playwright cannot do for requests made by the
 * web server.
 *
 * A fault is registered with `POST /__faults` and names the test's session cookie value, so a fault
 * only ever touches the browser context that asked for it (the specs run in parallel on one server):
 *
 *     { "session": "<fixflow_session value>", "path": "^/api/v1/admin/requests(\\?|$)",
 *       "method": "GET", "mode": "error" | "drop", "times": 1 }
 *
 * `error` answers `500` in the API's error format; `drop` destroys the connection (an API that is
 * down). `times` limits how often it fires (unlimited when left out). `DELETE /__faults?session=…`
 * removes a session's faults. This is test infrastructure only: nothing of it is in the application.
 */
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  request as forward,
  type ServerResponse,
} from "node:http";

const PORT = Number(process.env.FAULT_PROXY_PORT ?? "4100");
const TARGET = new URL(process.env.FAULT_PROXY_TARGET ?? "http://127.0.0.1:4000");
const SESSION_COOKIES = ["fixflow_session", "__Host-fixflow_session"];

interface Fault {
  id: string;
  session: string;
  path: RegExp;
  method: string | undefined;
  mode: "error" | "drop";
  /** The status of an `error` answer (500 unless the test asks for another). */
  status: number;
  remaining: number | undefined;
}

const faults: Fault[] = [];

function sessionOf(request: IncomingMessage): string | undefined {
  const header = request.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name = "", ...value] = part.trim().split("=");
    if (SESSION_COOKIES.includes(name)) return value.join("=");
  }
  return undefined;
}

function faultFor(request: IncomingMessage): Fault | undefined {
  const session = sessionOf(request);
  if (session === undefined) return undefined;
  const fault = faults.find(
    (candidate) =>
      candidate.session === session &&
      candidate.path.test(request.url ?? "") &&
      (candidate.method === undefined || candidate.method === request.method),
  );
  if (fault?.remaining !== undefined) {
    fault.remaining -= 1;
    if (fault.remaining <= 0) faults.splice(faults.indexOf(fault), 1);
  }
  return fault;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function control(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://proxy.invalid");
  if (request.method === "GET" && url.pathname === "/__faults/health") {
    json(response, 200, { ok: true, faults: faults.length });
    return;
  }
  if (request.method === "POST" && url.pathname === "/__faults") {
    const body = JSON.parse(await readBody(request)) as {
      session?: string;
      path?: string;
      method?: string;
      mode?: "error" | "drop";
      status?: number;
      times?: number;
    };
    if (typeof body.session !== "string" || body.session === "" || typeof body.path !== "string") {
      json(response, 400, { error: "session and path are required" });
      return;
    }
    const fault: Fault = {
      id: randomUUID(),
      session: body.session,
      path: new RegExp(body.path),
      method: body.method?.toUpperCase(),
      mode: body.mode ?? "error",
      status: body.status ?? 500,
      remaining: body.times,
    };
    faults.push(fault);
    json(response, 201, { id: fault.id });
    return;
  }
  if (request.method === "DELETE" && url.pathname === "/__faults") {
    const session = url.searchParams.get("session");
    for (let index = faults.length - 1; index >= 0; index -= 1) {
      if (faults[index]?.session === session) faults.splice(index, 1);
    }
    json(response, 200, { ok: true });
    return;
  }
  json(response, 404, { error: "unknown control route" });
}

function pass(request: IncomingMessage, response: ServerResponse): void {
  const upstream = forward(
    {
      host: TARGET.hostname,
      port: TARGET.port,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (answer) => {
      // Raw headers keep repeated ones (several `Set-Cookie`) exactly as the API sent them.
      response.writeHead(answer.statusCode ?? 502, answer.statusMessage, answer.rawHeaders);
      answer.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
    response.end("The E2E fault proxy could not reach the API.");
  });
  request.pipe(upstream);
}

const server = createServer((request, response) => {
  if ((request.url ?? "").startsWith("/__faults")) {
    control(request, response).catch((error: unknown) => {
      json(response, 500, { error: String(error) });
    });
    return;
  }
  const fault = faultFor(request);
  if (fault === undefined) {
    pass(request, response);
    return;
  }
  // Drain what the client sent, so the connection is in a clean state for either answer.
  request.resume();
  if (fault.mode === "drop") {
    request.socket.destroy();
    return;
  }
  json(response, fault.status, {
    error: {
      code: fault.status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
      message: "Something went wrong on our side. Please try again.",
      requestId: `e2e-fault-${fault.id.slice(0, 8)}`,
    },
  });
});

server.keepAliveTimeout = 5_000;
// All interfaces (dual stack): `localhost` may resolve to ::1 or to 127.0.0.1.
server.listen(PORT, () => {
  console.info(`E2E fault proxy on :${String(PORT)} → ${TARGET.origin}`);
});
