import { createApp } from "./app.js";

const DEFAULT_PORT = 4000;

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

const port = readPort();
const server = createApp().listen(port, () => {
  console.info(`FixFlow API listening on port ${port}`);
});

// Stop accepting connections and exit cleanly on Ctrl+C or a platform SIGTERM.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  });
}
