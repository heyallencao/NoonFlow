#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { _electron as electron } from "playwright";

function fail(message, details) {
  console.error(`[FAIL] ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function info(message) {
  console.log(`[INFO] ${message}`);
}

function assert(condition, message, details) {
  if (!condition) {
    fail(message, details);
  }
  pass(message);
}

async function fetchTextWithTimeout(url, timeoutMs = 1_500) {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: abortController.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const dialogMockPath = process.cwd();
  const electronExecutablePath = path.join(process.cwd(), "node_modules", ".bin", "electron");

  const app = await electron.launch({
    executablePath: electronExecutablePath,
    args: [process.cwd()],
    env: {
      ...process.env,
      NODE_ENV: "production",
      NOONFLOW_INSTALL_DRY_RUN: "1",
      NOONFLOW_DIALOG_MOCK_PATH: dialogMockPath,
    },
    timeout: 120_000,
  });

  try {
    const window = await app.firstWindow({ timeout: 120_000 });

    const hasApi = await window.evaluate(() => Boolean(globalThis.electronAPI));
    assert(hasApi, "window.electronAPI is available");

    const versions = await window.evaluate(() => globalThis.electronAPI?.versions);
    assert(Boolean(versions?.electron), "electron version exposed");
    assert(Boolean(versions?.node), "node version exposed");
    assert(Boolean(versions?.chrome), "chrome version exposed");

    const prerequisites = await window.evaluate(() => globalThis.electronAPI.install.checkPrerequisites());
    assert(typeof prerequisites === "object" && prerequisites !== null, "install.checkPrerequisites returns object");
    assert(typeof prerequisites.hasNode === "boolean", "install.checkPrerequisites.hasNode is boolean");
    assert(typeof prerequisites.hasClaude === "boolean", "install.checkPrerequisites.hasClaude is boolean");
    assert(typeof prerequisites.hasCodex === "boolean", "install.checkPrerequisites.hasCodex is boolean");
    assert(typeof prerequisites.hasPi === "boolean", "install.checkPrerequisites.hasPi is boolean");
    assert(typeof prerequisites.piInitialized === "boolean", "install.checkPrerequisites.piInitialized is boolean");
    assert(typeof prerequisites.nodeSupportsPi === "boolean", "install.checkPrerequisites.nodeSupportsPi is boolean");
    assert(typeof prerequisites.hasHomebrew === "boolean", "install.checkPrerequisites.hasHomebrew is boolean");
    assert(typeof prerequisites.platform === "string", "install.checkPrerequisites.platform is string");

    const logs = await window.evaluate(() => globalThis.electronAPI.install.getLogs());
    assert(Array.isArray(logs), "install.getLogs returns array");

    const folderResult = await window.evaluate(() => globalThis.electronAPI.dialog.openFolder({ title: "Smoke Test" }));
    assert(folderResult && folderResult.canceled === false, "dialog.openFolder returns non-cancel result in mock mode", folderResult);
    assert(Array.isArray(folderResult.filePaths) && folderResult.filePaths.length === 1, "dialog.openFolder returns one path");
    assert(folderResult.filePaths[0] === dialogMockPath, "dialog.openFolder path matches mock path", folderResult);

    const installSuccessResult = await window.evaluate(async () => {
      const api = globalThis.electronAPI;
      const snapshots = [];
      const off = api.install.onProgress((state) => snapshots.push(state));

      try {
        await api.install.start({
          includeNode: false,
          installClaude: true,
          installCodex: true,
          installPi: true,
          initializeClaude: true,
          initializeCodex: true,
          initializePi: true,
        });
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const current = snapshots[snapshots.length - 1];
          if (current && (current.status === "success" || current.status === "failed" || current.status === "cancelled")) {
            return {
              final: current,
              snapshots: snapshots.length,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return {
          final: null,
          snapshots: snapshots.length,
        };
      } finally {
        off();
      }
    });
    assert(installSuccessResult?.final?.status === "success", "install.start reaches success in dry-run mode", installSuccessResult);
    assert(installSuccessResult?.final?.steps?.some((step) => step.id === "install-pi" && step.status === "success"), "install.start includes successful Pi install step", installSuccessResult);
    assert(installSuccessResult?.final?.steps?.some((step) => step.id === "init-pi" && step.status === "success"), "install.start includes successful Pi init step", installSuccessResult);

    const installCancelResult = await window.evaluate(async () => {
      const api = globalThis.electronAPI;
      const snapshots = [];
      const off = api.install.onProgress((state) => snapshots.push(state));

      try {
        await api.install.start({ includeNode: true });
        await new Promise((resolve) => setTimeout(resolve, 180));
        await api.install.cancel();

        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const current = snapshots[snapshots.length - 1];
          if (current && (current.status === "cancelled" || current.status === "failed" || current.status === "success")) {
            return {
              final: current,
              snapshots: snapshots.length,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return {
          final: null,
          snapshots: snapshots.length,
        };
      } finally {
        off();
      }
    });
    assert(installCancelResult?.final?.status === "cancelled", "install.cancel reaches cancelled in dry-run mode", installCancelResult);

    await window.evaluate(() => globalThis.electronAPI.window.startDragging());
    pass("window.startDragging callable");

    const terminalSessionId = `smoke-${Date.now()}`;
    const terminalResult = await window.evaluate(async (sessionId) => {
      const api = globalThis.electronAPI;
      const marker = "__ELECTRON_SMOKE_OK__";

      await api.terminal.open({
        sessionId,
        cols: 80,
        rows: 24,
      });

      await api.terminal.resize({
        sessionId,
        cols: 100,
        rows: 30,
      });

      const snapshotBefore = await api.terminal.snapshot({ sessionId });

      return await new Promise((resolve) => {
        let finished = false;
        let combined = "";
        const timeout = setTimeout(async () => {
          if (finished) return;
          finished = true;
          offData();
          offError();
          try {
            await api.terminal.close({ sessionId });
          } catch {}
          resolve({
            ok: false,
            reason: "terminal output timeout",
            snapshotBefore,
            combined,
          });
        }, 10_000);

        const done = async (result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          offData();
          offError();
          try {
            await api.terminal.close({ sessionId });
          } catch {}
          resolve(result);
        };

        const offData = api.terminal.onData((event) => {
          if (event.sessionId !== sessionId) return;
          combined += event.data;
          if (combined.includes(marker)) {
            done({
              ok: true,
              snapshotBefore,
            });
          }
        });

        const offError = api.terminal.onError((event) => {
          if (event.sessionId !== sessionId) return;
          done({
            ok: false,
            reason: event.error || "terminal error",
            snapshotBefore,
            combined,
          });
        });

        api.terminal
          .write({
            sessionId,
            data: `echo ${marker}\r`,
          })
          .catch((error) =>
            done({
              ok: false,
              reason: String(error),
              snapshotBefore,
              combined,
            }),
          );
      });
    }, terminalSessionId);

    assert(terminalResult && terminalResult.ok === true, "terminal open/write/resize/close roundtrip", terminalResult);
    assert(
      typeof terminalResult.snapshotBefore === "object" && terminalResult.snapshotBefore !== null,
      "terminal.snapshot returns object",
      terminalResult,
    );
    assert(
      terminalResult.snapshotBefore.snapshot === undefined || typeof terminalResult.snapshotBefore.snapshot === "string",
      "terminal.snapshot payload is string or undefined",
      terminalResult,
    );

    const electronProcess = app.process();
    const pid = electronProcess?.pid;
    if (pid) {
      try {
        const output = execFileSync("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
        if (output) {
          info(`listening sockets for pid ${pid}:\n${output}`);
          const ports = Array.from(
            new Set(
              output
                .split("\n")
                .slice(1)
                .map((line) => {
                  const match = line.match(/TCP\s+\S+:(\d+)\s+\(LISTEN\)/);
                  return match ? Number(match[1]) : null;
                })
                .filter((port) => typeof port === "number"),
            ),
          );

          for (const port of ports) {
            const health = await fetchTextWithTimeout(`http://127.0.0.1:${port}/api/health`);
            info(`[port ${port}] /api/health -> ${health.status} ${health.text.slice(0, 120)}`);

            const devtools = await fetchTextWithTimeout(`http://127.0.0.1:${port}/json/version`);
            info(`[port ${port}] /json/version -> ${devtools.status} ${devtools.text.slice(0, 120)}`);
          }
        } else {
          info(`no listening sockets for pid ${pid}`);
        }
      } catch (error) {
        const stderr = error instanceof Error && "stderr" in error ? String(error.stderr || "").trim() : "";
        if (stderr) {
          info(`lsof check returned no matches (pid ${pid}): ${stderr}`);
        } else {
          info(`lsof check returned no matches (pid ${pid})`);
        }
      }
    } else {
      info("unable to determine Electron pid for lsof check");
    }

    pass("electron smoke checks complete");
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  fail("electron smoke check crashed", details);
});
