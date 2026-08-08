#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);

function log(message) {
  console.log(`[port-audit] ${message}`);
}

function fail(message, details) {
  console.error(`[port-audit][FAIL] ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getElectronBinaryPath() {
  try {
    return require("electron");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail("Unable to resolve electron binary path", detail);
  }
}

function listListeningSockets(pid) {
  try {
    const output = execFileSync("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return output
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/TCP\s+([^:\s]+):(\d+)\s+\(LISTEN\)/);
        if (!match) return null;
        return {
          host: match[1],
          port: Number(match[2]),
          raw: line,
        };
      })
      .filter((item) => item && Number.isFinite(item.port));
  } catch {
    return [];
  }
}

async function fetchTextWithTimeout(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return {
      status: response.status,
      body: await response.text(),
    };
  } catch (error) {
    return {
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function classifyPort(port) {
  const health = await fetchTextWithTimeout(`http://127.0.0.1:${port}/api/health`);
  if (health.status === 200 && /"status"\s*:\s*"ok"/.test(health.body)) {
    return { kind: "next", health, version: null };
  }

  const version = await fetchTextWithTimeout(`http://127.0.0.1:${port}/json/version`);
  if (version.status === 200 && /Protocol-Version|Browser/.test(version.body)) {
    return { kind: "devtools", health, version };
  }

  return { kind: "other", health, version };
}

async function main() {
  const electronBinary = getElectronBinaryPath();
  const entry = "./dist-electron/main.js";
  const child = spawn(electronBinary, [entry], {
    env: {
      ...process.env,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderrBuffer = "";
  child.stderr?.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  const shutdown = () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };

  process.on("exit", shutdown);
  process.on("SIGINT", () => {
    shutdown();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(143);
  });

  const pid = child.pid;
  if (!pid) {
    fail("Electron process failed to start (no pid)");
  }

  log(`started electron pid=${pid}`);

  const bootDeadline = Date.now() + 30_000;
  let sockets = [];
  let ready = false;

  while (Date.now() < bootDeadline) {
    if (child.exitCode !== null) {
      fail("Electron exited before readiness", stderrBuffer.trim());
    }

    sockets = listListeningSockets(pid);
    for (const socket of sockets) {
      const health = await fetchTextWithTimeout(`http://127.0.0.1:${socket.port}/api/health`, 1000);
      if (health.status === 200 && /"status"\s*:\s*"ok"/.test(health.body)) {
        ready = true;
        break;
      }
    }
    if (ready) break;
    await sleep(400);
  }

  if (!ready) {
    fail("Timed out waiting for embedded Next.js server", stderrBuffer.trim());
  }

  sockets = listListeningSockets(pid);
  if (!sockets.length) {
    fail("No listening sockets found after startup");
  }

  log("listening sockets:");
  for (const socket of sockets) {
    log(`  - ${socket.raw}`);
  }

  const byPort = Array.from(new Map(sockets.map((socket) => [socket.port, socket])).values());
  const classifications = [];
  for (const socket of byPort) {
    const result = await classifyPort(socket.port);
    classifications.push({ socket, result });
  }

  const nextPorts = classifications.filter((item) => item.result.kind === "next");
  const devtoolsPorts = classifications.filter((item) => item.result.kind === "devtools");
  const otherPorts = classifications.filter((item) => item.result.kind === "other");

  for (const item of classifications) {
    log(
      `port ${item.socket.port} -> ${item.result.kind} (health=${item.result.health.status}, json/version=${item.result.version?.status ?? "n/a"})`,
    );
  }

  const nonLoopback = sockets.filter((socket) => socket.host !== "127.0.0.1" && socket.host !== "localhost");
  if (nonLoopback.length > 0) {
    fail("Found non-loopback listening sockets", nonLoopback.map((item) => item.raw).join("\n"));
  }

  if (nextPorts.length !== 1) {
    fail("Expected exactly one embedded Next.js listening port", JSON.stringify(classifications, null, 2));
  }

  if (devtoolsPorts.length > 0) {
    fail("Unexpected DevTools/Inspector ports detected in cold start", JSON.stringify(classifications, null, 2));
  }

  if (otherPorts.length > 0) {
    fail("Unexpected unclassified listening ports detected", JSON.stringify(classifications, null, 2));
  }

  log("PASS: cold start port audit succeeded");
  shutdown();
  await sleep(600);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  fail("Port audit crashed", detail);
});
