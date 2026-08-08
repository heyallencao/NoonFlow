import { app, net, protocol } from "electron";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const APP_SCHEME = "noonflow";
const APP_HOST = "noonflow";
const DEV_SERVER_URL = process.env.NEXT_DEV_SERVER_URL || "http://127.0.0.1:3000";

let serverPort: number | null = null;
let serverReady = false;
let protocolHandled = false;

function isDevelopment() {
  return process.env.NODE_ENV === "development";
}

export function registerAppProtocol() {
  if (isDevelopment()) return;
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function handleAppProtocol() {
  if (isDevelopment() || protocolHandled) return;

  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const targetUrl = `${getServerBaseUrl()}${requestUrl.pathname || "/"}${requestUrl.search}`;
      const sanitizedHeaders = new Headers(request.headers);
      sanitizedHeaders.delete("host");
      sanitizedHeaders.delete("origin");
      sanitizedHeaders.delete("referer");

      const resp = await net.fetch(targetUrl, {
        method: request.method,
        headers: sanitizedHeaders,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : (request.body ?? undefined),
        // electron types lag behind undici's duplex extension.
        // @ts-expect-error duplex is required for streaming POST bodies.
        duplex: "half",
        // Prevent recursive triggering of this protocol handler.
        bypassCustomProtocolHandlers: true,
      });

      // Fonts and binary resources must be read as ArrayBuffer to avoid
      // stream transfer issues in the renderer process.
      const ct = resp.headers.get("content-type") ?? "";
      if (ct.includes("font") || ct.includes("octet-stream") || ct.includes("woff")) {
        const buf = await resp.arrayBuffer();
        const respHeaders: Record<string, string> = {};
        resp.headers.forEach((v, k) => { respHeaders[k] = v; });
        return new Response(buf, { status: resp.status, headers: respHeaders });
      }

      return resp;
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "protocol_forward_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        },
      );
    }
  });

  protocolHandled = true;
}

export function isServerReady() {
  return serverReady;
}

export function getServerBaseUrl(): string {
  if (isDevelopment()) return DEV_SERVER_URL;
  if (!serverPort) {
    throw new Error("Next.js server not started");
  }
  return `http://127.0.0.1:${serverPort}`;
}

export async function startServer(): Promise<void> {
  if (isDevelopment()) {
    serverReady = true;
    return;
  }
  if (serverReady) return;

  console.log("[NoonFlow] Starting Next.js server...");
  serverPort = await pickFreePort();
  process.env.PORT = String(serverPort);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.CLAUDE_GUI_DATA_DIR = app.getPath("userData");

  const serverJsPath = resolveServerPath();
  console.log("[NoonFlow] Server path:", serverJsPath);
  console.log("[NoonFlow] Exists:", existsSync(serverJsPath));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(serverJsPath);

  console.log("[NoonFlow] Waiting for server...");
  await waitForServer(serverPort, 30_000);
  serverReady = true;
  console.log("[NoonFlow] Server ready on port", serverPort);
}

export async function stopServer(): Promise<void> {
  serverReady = false;
}

function resolveServerPath(): string {
  const packagedCandidates = [
    path.join(process.resourcesPath, "standalone", "server.js"),
    path.join(process.resourcesPath, "app", "standalone", "server.js"),
  ];
  const unpackagedCandidates = [
    path.join(process.cwd(), "resources", "standalone", "server.js"),
    path.join(__dirname, "..", "resources", "standalone", "server.js"),
    path.join(process.cwd(), ".next", "standalone", "server.js"),
    path.join(__dirname, "..", ".next", "standalone", "server.js"),
  ];
  const candidates = app.isPackaged ? packagedCandidates : unpackagedCandidates;

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(`Next.js standalone server not found. Tried:\n${candidates.join("\n")}`);
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Failed to allocate a free port")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

async function waitForServer(port: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // Ignore: Next.js is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Next.js server startup timeout after ${timeoutMs}ms`);
}

export function getAppProtocolEntry() {
  return `${APP_SCHEME}://${APP_HOST}/`;
}
