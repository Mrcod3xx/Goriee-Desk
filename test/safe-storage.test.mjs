import test from "node:test";
import assert from "node:assert/strict";
import {
  isQuotaError,
  safeWrite,
  safeWriteJson,
  safeRemove,
  subscribeToStorageFailures,
  registerQuotaRelief,
  resetSafeStorageForTests,
} from "../src/lib/safe-storage.ts";
import { relieveStorageQuota, describeDroppedStores } from "../src/lib/storage-relief.ts";
import { storageKeys } from "../src/components/desk-shared.ts";

/**
 * The whole point of these two modules is that a storage failure can never
 * escape into a React event handler or a setState updater, where it would
 * unmount the tree into a blank page. So the assertions below are less about
 * the happy path and more about "nothing threw, and the user was told".
 */

function quotaError() {
  const error = new Error("The quota has been exceeded.");
  error.name = "QuotaExceededError";
  return error;
}

/** A minimal in-memory Storage that can be told to fail specific operations. */
function fakeStorage(initial = {}, options = {}) {
  const data = new Map(Object.entries(initial));
  const store = {
    _data: data,
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    getItem(key) {
      if (options.throwOnGet?.includes(key)) throw new Error("SecurityError: getItem blocked");
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (options.throwOnSet?.includes(key)) throw quotaError();
      data.set(key, String(value));
    },
    removeItem(key) {
      if (options.throwOnRemove?.includes(key)) throw new Error("SecurityError: removeItem blocked");
      data.delete(key);
    },
    clear() {
      data.clear();
    },
  };
  return store;
}

/** Install `store` as globalThis.localStorage for the duration of `run`. */
async function withStorage(store, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: store,
    configurable: true,
    writable: true,
  });
  try {
    await run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "localStorage", descriptor);
    } else {
      delete globalThis.localStorage;
    }
  }
}

/** Simulate a locked-down browser where reading the property itself throws. */
async function withBrokenStorageAccess(run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: storage access denied");
    },
  });
  try {
    await run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "localStorage", descriptor);
    } else {
      delete globalThis.localStorage;
    }
  }
}

// ---------------------------------------------------------------------------
// isQuotaError
// ---------------------------------------------------------------------------

test("safe-storage: isQuotaError recognises every browser spelling of a full quota", () => {
  const byName = new Error("full");
  byName.name = "QuotaExceededError";
  assert.equal(isQuotaError(byName), true);

  // Older Firefox reports the condition under this name instead.
  const firefox = new Error("full");
  firefox.name = "NS_ERROR_DOM_QUOTA_REACHED";
  assert.equal(isQuotaError(firefox), true);

  // Safari (22) and legacy Firefox (1014) report it as a numeric code.
  assert.equal(isQuotaError({ code: 22 }), true);
  assert.equal(isQuotaError({ code: 1014 }), true);
});

test("safe-storage: isQuotaError rejects things that are not quota failures", () => {
  assert.equal(isQuotaError(new Error("network down")), false);
  assert.equal(isQuotaError(null), false);
  assert.equal(isQuotaError(undefined), false);
  assert.equal(isQuotaError("QuotaExceededError"), false, "a string is not an error object");
  assert.equal(isQuotaError({}), false);
  // A numeric code belonging to a different DOMException must not be mistaken
  // for quota exhaustion.
  assert.equal(isQuotaError({ code: 18 }), false);
});

// ---------------------------------------------------------------------------
// safeWrite
// ---------------------------------------------------------------------------

test("safe-storage: safeWrite persists a value and reports it did not need relief", async () => {
  resetSafeStorageForTests();
  const store = fakeStorage();
  await withStorage(store, () => {
    const result = safeWrite("goriee.test.v1", "hello");
    assert.deepEqual(result, { ok: true, relieved: false });
    assert.equal(store.getItem("goriee.test.v1"), "hello");
  });
});

test("safe-storage: safeWrite survives storage being completely unavailable", async () => {
  resetSafeStorageForTests();
  const reasons = [];
  const unsubscribe = subscribeToStorageFailures((reason, key) => reasons.push([reason, key]));

  await withBrokenStorageAccess(() => {
    // The critical assertion: this call returns instead of throwing.
    const result = safeWrite("goriee.test.v1", "hello");
    assert.deepEqual(result, { ok: false, reason: "unavailable" });
  });

  assert.deepEqual(reasons, [["unavailable", "goriee.test.v1"]]);
  unsubscribe();
});

test("safe-storage: safeWrite retries once after the relief handler frees space", async () => {
  resetSafeStorageForTests();
  const store = fakeStorage({ [storageKeys.drafts]: "throwaway text" });
  let reliefCalls = 0;

  await withStorage(store, () => {
    // The first setItem for this key throws quota; clearing the disposable
    // store makes the retry succeed.
    const guarded = {
      ...store,
      setItem(key, value) {
        if (reliefCalls === 0) throw quotaError();
        store._data.set(key, String(value));
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: guarded,
      configurable: true,
      writable: true,
    });

    registerQuotaRelief(() => {
      reliefCalls += 1;
      return relieveStorageQuota(store).relieved;
    });

    const result = safeWrite("goriee.important.v1", "must be saved");
    assert.deepEqual(result, { ok: true, relieved: true });
    assert.equal(reliefCalls, 1, "relief runs exactly once per failed write");
    assert.equal(store.getItem("goriee.important.v1"), "must be saved");
    assert.equal(store.getItem(storageKeys.drafts), null, "the disposable store was dropped");
  });
});

test("safe-storage: safeWrite reports quota when relief has nothing left to drop", async () => {
  resetSafeStorageForTests();
  const store = fakeStorage();
  const reasons = [];
  const unsubscribe = subscribeToStorageFailures((reason) => reasons.push(reason));

  await withStorage(store, () => {
    const throwing = {
      ...store,
      setItem() {
        throw quotaError();
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: throwing,
      configurable: true,
      writable: true,
    });

    // No disposable data exists, so the honest answer is "I could not help".
    registerQuotaRelief(() => relieveStorageQuota(store).relieved);

    const result = safeWrite("goriee.important.v1", "value");
    assert.deepEqual(result, { ok: false, reason: "quota" });
    assert.deepEqual(reasons, ["quota"]);
  });

  unsubscribe();
});

test("safe-storage: safeWrite never invokes relief for a non-quota failure", async () => {
  resetSafeStorageForTests();
  const store = fakeStorage();
  let reliefCalls = 0;
  registerQuotaRelief(() => {
    reliefCalls += 1;
    return true;
  });

  await withStorage(store, () => {
    const throwing = {
      ...store,
      setItem() {
        throw new Error("SecurityError: storage is disabled by policy");
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: throwing,
      configurable: true,
      writable: true,
    });

    const result = safeWrite("goriee.test.v1", "value");
    assert.deepEqual(result, { ok: false, reason: "error" });
    assert.equal(reliefCalls, 0, "deleting user data cannot fix a policy error");
  });
});

// ---------------------------------------------------------------------------
// safeWriteJson
// ---------------------------------------------------------------------------

test("safe-storage: safeWriteJson round-trips serialisable values", async () => {
  resetSafeStorageForTests();
  const store = fakeStorage();
  const payload = { trades: [{ symbol: "BTCUSDT", side: "buy" }], count: 2 };

  await withStorage(store, () => {
    const result = safeWriteJson("goriee.test.v1", payload);
    assert.deepEqual(result, { ok: true, relieved: false });
    assert.deepEqual(JSON.parse(store.getItem("goriee.test.v1")), payload);
  });
});

test("safe-storage: safeWriteJson refuses a circular value instead of throwing", async () => {
  resetSafeStorageForTests();
  const store = fakeStorage();
  const circular = { name: "loop" };
  circular.self = circular;

  await withStorage(store, () => {
    const result = safeWriteJson("goriee.test.v1", circular);
    assert.deepEqual(result, { ok: false, reason: "error" });
    assert.equal(store.getItem("goriee.test.v1"), null, "nothing was written");
  });
});

test("safe-storage: safeWriteJson treats an undefined serialisation as a failure", async () => {
  resetSafeStorageForTests();
  const store = fakeStorage();

  await withStorage(store, () => {
    // JSON.stringify(undefined) returns undefined rather than the string
    // "undefined"; writing that would poison the key for the next safeRead.
    assert.deepEqual(safeWriteJson("goriee.test.v1", undefined), { ok: false, reason: "error" });
    assert.deepEqual(safeWriteJson("goriee.test.v1", () => {}), { ok: false, reason: "error" });
    assert.equal(store.getItem("goriee.test.v1"), null);
  });
});

// ---------------------------------------------------------------------------
// safeRemove
// ---------------------------------------------------------------------------

test("safe-storage: safeRemove deletes a key and reports success", async () => {
  resetSafeStorageForTests();
  const store = fakeStorage({ "goriee.test.v1": "value" });

  await withStorage(store, () => {
    assert.deepEqual(safeRemove("goriee.test.v1"), { ok: true, relieved: false });
    assert.equal(store.getItem("goriee.test.v1"), null);
  });
});

test("safe-storage: safeRemove never throws when storage is unavailable", async () => {
  resetSafeStorageForTests();
  await withBrokenStorageAccess(() => {
    assert.deepEqual(safeRemove("goriee.test.v1"), { ok: false, reason: "unavailable" });
  });
});

// ---------------------------------------------------------------------------
// Failure notifications
// ---------------------------------------------------------------------------

test("safe-storage: unsubscribing stops notifications", async () => {
  resetSafeStorageForTests();
  const seen = [];
  const unsubscribe = subscribeToStorageFailures((reason) => seen.push(reason));

  await withBrokenStorageAccess(() => {
    safeWrite("goriee.a.v1", "x");
    unsubscribe();
    safeWrite("goriee.b.v1", "y");
  });

  assert.deepEqual(seen, ["unavailable"], "the second failure arrived after unsubscribing");
});

test("safe-storage: a throwing listener cannot break the write path", async () => {
  resetSafeStorageForTests();
  const seen = [];
  subscribeToStorageFailures(() => {
    throw new Error("listener exploded");
  });
  const unsubscribe = subscribeToStorageFailures((reason) => seen.push(reason));

  await withBrokenStorageAccess(() => {
    const result = safeWrite("goriee.a.v1", "x");
    assert.deepEqual(result, { ok: false, reason: "unavailable" }, "the write still returned a result");
  });

  assert.deepEqual(seen, ["unavailable"], "healthy listeners still fire");
  unsubscribe();
});

test("safe-storage: repeated identical failures are throttled to one notification", async () => {
  resetSafeStorageForTests();
  const seen = [];
  const unsubscribe = subscribeToStorageFailures((reason) => seen.push(reason));

  await withBrokenStorageAccess(() => {
    // Dozens of writes can fail in a single tick; without throttling the toast
    // would be re-set constantly and never stay readable.
    for (let i = 0; i < 25; i += 1) safeWrite(`goriee.key${i}.v1`, "x");
  });

  assert.equal(seen.length, 1, "25 failures produced exactly one notification");
  unsubscribe();
});

test("safe-storage: distinct failure reasons are notified separately", async () => {
  resetSafeStorageForTests();
  const seen = [];
  const unsubscribe = subscribeToStorageFailures((reason) => seen.push(reason));
  const store = fakeStorage();

  await withBrokenStorageAccess(() => {
    safeWrite("goriee.a.v1", "x");
  });
  await withStorage(store, () => {
    const throwing = {
      ...store,
      setItem() {
        throw new Error("SecurityError");
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: throwing,
      configurable: true,
      writable: true,
    });
    safeWrite("goriee.b.v1", "y");
  });

  assert.deepEqual(seen, ["unavailable", "error"], "the throttle is per reason, not global");
  unsubscribe();
});

// ---------------------------------------------------------------------------
// Quota relief tiers
// ---------------------------------------------------------------------------

/** Stores that must survive any relief pass, with a recognisable sentinel. */
const PROTECTED_ENTRIES = {
  [storageKeys.paper]: JSON.stringify([{ symbol: "BTCUSDT", side: "buy", quantity: 0.1, price: 100000 }]),
  [storageKeys.paperBrackets]: JSON.stringify({ BTCUSDT: { stopLoss: 95000, takeProfit: 120000 } }),
  [storageKeys.paperAlerts]: JSON.stringify([{ symbol: "ETHUSDT", price: 4000 }]),
  [storageKeys.playbooks]: JSON.stringify([{ id: "pb1", symbol: "BTCUSDT" }]),
  [storageKeys.watchlist]: JSON.stringify(["BTCUSDT", "ETHUSDT"]),
  [storageKeys.paperRisk]: "1.5",
  [storageKeys.paperFee]: "10",
  [storageKeys.autoRuleRunner]: "true",
  [storageKeys.activePlaybook]: "pb1",
};

test("storage-relief: returns a clean no-op when there is no store", () => {
  assert.deepEqual(relieveStorageQuota(null), { relieved: false, dropped: [] });
});

test("storage-relief: drops nothing when there is no disposable data", () => {
  const store = fakeStorage({ ...PROTECTED_ENTRIES });
  assert.deepEqual(relieveStorageQuota(store), { relieved: false, dropped: [] });
});

test("storage-relief: never touches the paper ledger, brackets or user configuration", () => {
  // This is the load-bearing guarantee. paperCash() reduces over every fill in
  // the ledger, so truncating it would silently change the account balance —
  // a worse outcome than failing to save a journal entry. Dropping a bracket
  // would remove a stop the user believes is protecting them.
  const store = fakeStorage({
    ...PROTECTED_ENTRIES,
    [storageKeys.drafts]: "draft text",
    [storageKeys.ruleRunnerLogs]: JSON.stringify([{ id: 1 }]),
    [storageKeys.copilotSessions]: JSON.stringify([{ messages: ["hi"] }]),
    [storageKeys.journal]: JSON.stringify([{ title: "report" }]),
  });

  const outcome = relieveStorageQuota(store);

  assert.equal(outcome.relieved, true);
  assert.deepEqual(outcome.dropped, [
    "unsaved drafts",
    "execution audit log",
    "copilot chat history",
    "saved research reports",
  ]);

  for (const [key, value] of Object.entries(PROTECTED_ENTRIES)) {
    assert.equal(store.getItem(key), value, `${key} must survive a full relief sweep`);
  }
});

test("storage-relief: drops tiers in priority order, cheapest first", () => {
  const store = fakeStorage({
    [storageKeys.copilotSessions]: JSON.stringify([{ messages: ["hi"] }]),
    [storageKeys.drafts]: "draft text",
    [storageKeys.journal]: JSON.stringify([{ title: "report" }]),
  });

  // Only enough room is needed for one tier, so the first in priority order
  // goes and the saved research reports are spared.
  const outcome = relieveStorageQuota(store, 4);

  assert.deepEqual(outcome.dropped, ["unsaved drafts"]);
  assert.equal(store.getItem(storageKeys.drafts), null);
  assert.notEqual(store.getItem(storageKeys.copilotSessions), null);
  assert.notEqual(store.getItem(storageKeys.journal), null);
});

test("storage-relief: keeps dropping until the requested space is freed", () => {
  const store = fakeStorage({
    [storageKeys.drafts]: "x".repeat(10), // 20 bytes at 2 bytes per code unit
    [storageKeys.ruleRunnerLogs]: "y".repeat(100), // 200 bytes
    [storageKeys.journal]: "z".repeat(100),
  });

  const outcome = relieveStorageQuota(store, 30);

  assert.deepEqual(outcome.dropped, ["unsaved drafts", "execution audit log"]);
  assert.notEqual(store.getItem(storageKeys.journal), null, "stopped as soon as enough was freed");
});

test("storage-relief: a store that cannot be read or removed does not abort the sweep", () => {
  const store = fakeStorage(
    {
      [storageKeys.drafts]: "draft text",
      [storageKeys.ruleRunnerLogs]: "logs",
      [storageKeys.journal]: "report",
    },
    { throwOnGet: [storageKeys.ruleRunnerLogs] },
  );

  const outcome = relieveStorageQuota(store);

  assert.equal(outcome.relieved, true);
  assert.deepEqual(outcome.dropped, ["unsaved drafts", "saved research reports"]);
  // The unreadable tier was skipped over rather than aborting the sweep, and the
  // tiers after it were still reclaimed. Its own state is unobservable here by
  // construction — reading it is what throws.
  assert.equal(store.getItem(storageKeys.drafts), null);
  assert.equal(store.getItem(storageKeys.journal), null);
});

test("storage-relief: continues past a removeItem that throws", () => {
  const store = fakeStorage(
    {
      [storageKeys.drafts]: "draft text",
      [storageKeys.journal]: "report",
    },
    { throwOnRemove: [storageKeys.drafts] },
  );

  const outcome = relieveStorageQuota(store);

  assert.equal(outcome.relieved, true);
  assert.deepEqual(outcome.dropped, ["saved research reports"], "the blocked tier was skipped, not counted");
});

// ---------------------------------------------------------------------------
// describeDroppedStores
// ---------------------------------------------------------------------------

test("storage-relief: describeDroppedStores reads as an English list", () => {
  assert.equal(describeDroppedStores([]), "");
  assert.equal(describeDroppedStores(["unsaved drafts"]), "unsaved drafts");
  assert.equal(describeDroppedStores(["unsaved drafts", "copilot chat history"]), "unsaved drafts and copilot chat history");
  assert.equal(
    describeDroppedStores(["unsaved drafts", "execution audit log", "copilot chat history"]),
    "unsaved drafts, execution audit log and copilot chat history",
  );
});
