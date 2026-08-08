import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isDangerouslySkipPermissionsEnabled,
  serializeDangerouslySkipPermissions,
} from "../../lib/assistant-permissions";

describe("assistant permissions defaults", () => {
  it("defaults skip permissions to enabled when unset", () => {
    assert.equal(isDangerouslySkipPermissionsEnabled(undefined), true);
    assert.equal(isDangerouslySkipPermissionsEnabled(""), true);
  });

  it("treats explicit false as workspace sandbox mode", () => {
    assert.equal(isDangerouslySkipPermissionsEnabled("false"), false);
    assert.equal(isDangerouslySkipPermissionsEnabled("FALSE"), false);
  });

  it("serializes boolean values explicitly", () => {
    assert.equal(serializeDangerouslySkipPermissions(true), "true");
    assert.equal(serializeDangerouslySkipPermissions(false), "false");
  });
});
