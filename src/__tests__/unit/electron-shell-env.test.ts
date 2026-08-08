import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sanitizeDesktopChildEnv } from "../../../electron/lib/shell-env";

describe("sanitizeDesktopChildEnv", () => {
  it("removes app runtime env that should not leak into terminal children", () => {
    const sanitized = sanitizeDesktopChildEnv({
      PATH: "/usr/bin:/bin",
      HOME: "/Users/test",
      NODE_ENV: "production",
      NEXT_DEV_SERVER_URL: "http://127.0.0.1:3000",
      MONOLITH_INSTALL_DRY_RUN: "1",
      NEXT_PUBLIC_MONOLITH_CODEX_BACKEND: "sdk-bundled",
      ELECTRON_RUN_AS_NODE: "1",
      npm_config_runtime: "electron",
    });

    assert.equal(sanitized.PATH, "/usr/bin:/bin");
    assert.equal(sanitized.HOME, "/Users/test");
    assert.equal("NODE_ENV" in sanitized, false);
    assert.equal("NEXT_DEV_SERVER_URL" in sanitized, false);
    assert.equal("MONOLITH_INSTALL_DRY_RUN" in sanitized, false);
    assert.equal("NEXT_PUBLIC_MONOLITH_CODEX_BACKEND" in sanitized, false);
    assert.equal("ELECTRON_RUN_AS_NODE" in sanitized, false);
    assert.equal("npm_config_runtime" in sanitized, false);
  });
});
