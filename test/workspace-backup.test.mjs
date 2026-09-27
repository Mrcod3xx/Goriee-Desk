import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkspaceBackup, captureWorkspace, restoreWorkspace, backupKeys } from "../src/lib/workspace-backup.ts";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

const validSession = {
  id: "session_1", title: "BTC session", createdAt: 1, updatedAt: 2, symbol: "BTCUSDT",
  messages: [{ id: "m1", role: "user", content: "hello", timestamp: 1 }],
};
const validLog = { id: "log_1", time: 1, symbol: "BTCUSDT", action: "buy", message: "Automated fill" };

test("Backup: allowlist covers rule-runner and copilot session keys", () => {
  for (const key of ["goriee.auto-rule-runner.v1", "goriee.rule-runner-logs.v1", "goriee_copilot_sessions_v1"]) {
    assert.ok(backupKeys.includes(key), `${key} must be included in the backup allowlist`);
  }
});

test("Backup: round-trips rule-runner state and copilot sessions", () => {
  const storage = memoryStorage({
    "goriee.auto-rule-runner.v1": "true",
    "goriee.rule-runner-logs.v1": JSON.stringify([validLog]),
    "goriee_copilot_sessions_v1": JSON.stringify([validSession]),
  });
  const snapshot = captureWorkspace(storage);
  const parsed = parseWorkspaceBackup(JSON.stringify(snapshot));
  assert.equal(parsed.data["goriee.auto-rule-runner.v1"], true);
  assert.deepEqual(parsed.data["goriee.rule-runner-logs.v1"], [validLog]);
  assert.deepEqual(parsed.data["goriee_copilot_sessions_v1"], [validSession]);
});

test("Backup: rejects invalid rule-runner and copilot payloads", () => {
  const base = { format: "goriee-workspace", version: 1, exportedAt: new Date().toISOString() };
  assert.throws(() => parseWorkspaceBackup(JSON.stringify({ ...base, data: { "goriee.auto-rule-runner.v1": "yes" } })), /invalid/i);
  assert.throws(() => parseWorkspaceBackup(JSON.stringify({ ...base, data: { "goriee.rule-runner-logs.v1": [{ id: "x", time: -1, symbol: "BTCUSDT", action: "buy", message: "m" }] } })), /invalid/i);
  assert.throws(() => parseWorkspaceBackup(JSON.stringify({ ...base, data: { "goriee_copilot_sessions_v1": [{ ...validSession, messages: [{ id: "m1", role: "hacker", content: "x", timestamp: 1 }] }] } })), /invalid/i);
  assert.throws(() => parseWorkspaceBackup(JSON.stringify({ ...base, data: { "goriee_copilot_sessions_v1": [validSession, { ...validSession }] } })), /duplicate/i);
});

test("Backup: restore replaces all allowlisted keys and tolerates forward-compatible extra fields", () => {
  const snapshot = {
    format: "goriee-workspace", version: 1, exportedAt: new Date().toISOString(),
    data: {
      "goriee.auto-rule-runner.v1": false,
      "goriee_copilot_sessions_v1": [{ ...validSession, futureField: "ignored", messages: [{ id: "m1", role: "user", content: "hi", timestamp: 1, actions: [] }] }],
    },
  };
  const storage = memoryStorage({ "goriee.watchlist.v1": JSON.stringify(["BTCUSDT"]) });
  restoreWorkspace(storage, snapshot);
  assert.equal(storage.getItem("goriee.auto-rule-runner.v1"), "false");
  assert.equal(storage.getItem("goriee.watchlist.v1"), null, "keys absent from the backup must be cleared on restore");
  assert.ok(storage.getItem("goriee_copilot_sessions_v1").includes("futureField"));
});

test("Backup: supports restoring an empty workspace cleanly", () => {
  const snapshot = {
    format: "goriee-workspace", version: 1, exportedAt: new Date().toISOString(),
    data: {},
  };
  const storage = memoryStorage({ "goriee.watchlist.v1": JSON.stringify(["BTCUSDT"]) });
  restoreWorkspace(storage, snapshot);
  assert.equal(storage.getItem("goriee.watchlist.v1"), null);
});

test("Backup: aborts on pre-flight quota probe failure before modifying existing storage", () => {
  const snapshot = {
    format: "goriee-workspace", version: 1, exportedAt: new Date().toISOString(),
    data: { "goriee.watchlist.v1": ["BTCUSDT"] },
  };
  const storage = memoryStorage({ "goriee.watchlist.v1": JSON.stringify(["ETHUSDT"]) });
  // Simulate storage quota exception on probe key
  const originalSetItem = storage.setItem;
  storage.setItem = (key, val) => {
    if (key === "__goriee_quota_probe__") throw new Error("QuotaExceededError");
    return originalSetItem(key, val);
  };
  assert.throws(
    () => restoreWorkspace(storage, snapshot),
    /storage quota exceeded/i,
  );
  // Verify existing data was untouched
  assert.equal(storage.getItem("goriee.watchlist.v1"), JSON.stringify(["ETHUSDT"]));
});
