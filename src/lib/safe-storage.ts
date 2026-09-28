/**
 * Guarded localStorage access for the desk.
 *
 * `setItem` throws in more situations than you would expect. Safari private
 * mode rejects every write, a full quota throws `QuotaExceededError`, and
 * embedded or locked-down browsers can make the `localStorage` property itself
 * throw when read. Most of these writes happen inside React event handlers —
 * and a couple happen inside a `setState` updater, where a throw is worse than
 * a throw in a handler because it corrupts the render — so one unguarded write
 * can take the entire tree down to a blank page.
 *
 * Persisted state here is a convenience, never the source of truth for the
 * running session: the in-memory state has already been updated by the time we
 * write. So the correct behaviour on failure is to keep going, tell the user
 * once, and never let the exception escape.
 */

export type StorageFailureReason = "unavailable" | "quota" | "error";

export type SafeWriteResult =
  | { ok: true; relieved: boolean }
  | { ok: false; reason: StorageFailureReason };

type FailureListener = (reason: StorageFailureReason, key: string) => void;

/**
 * Registered by the app to free space when a write hits the quota. Returning
 * `true` means "I made room, retry the write"; `false` means there was nothing
 * disposable left to drop.
 */
type ReliefHandler = () => boolean;

const failureListeners = new Set<FailureListener>();
const lastNotifiedAt = new Map<StorageFailureReason, number>();

/**
 * Minimum gap between two notifications about the same failure reason. When the
 * quota is full, dozens of writes can fail in the same tick; without this the
 * toast would be re-set constantly and never stay readable.
 */
const NOTIFY_THROTTLE_MS = 4000;

let reliefHandler: ReliefHandler | null = null;

/**
 * Distinguish a full quota from every other storage failure. The name is the
 * reliable modern signal; the numeric codes cover older Firefox (1014) and
 * Safari (22), which report quota exhaustion differently.
 */
export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: unknown; code?: unknown };
  if (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return true;
  }
  return err.code === 22 || err.code === 1014;
}

function readStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Reading the property itself throws in some locked-down browsers.
    return null;
  }
}

function notify(reason: StorageFailureReason, key: string) {
  const now = Date.now();
  const previous = lastNotifiedAt.get(reason) ?? 0;
  if (now - previous < NOTIFY_THROTTLE_MS) return;
  lastNotifiedAt.set(reason, now);
  for (const listener of failureListeners) {
    try {
      listener(reason, key);
    } catch {
      // A broken listener must never break the write path it was called from.
    }
  }
}

function fail(reason: StorageFailureReason, key: string): SafeWriteResult {
  notify(reason, key);
  return { ok: false, reason };
}

/**
 * Subscribe to storage failures so the UI can explain them. Returns an
 * unsubscribe function.
 */
export function subscribeToStorageFailures(listener: FailureListener): () => void {
  failureListeners.add(listener);
  return () => {
    failureListeners.delete(listener);
  };
}

/** Register (or clear, with `null`) the handler invoked when a write hits the quota. */
export function registerQuotaRelief(handler: ReliefHandler | null): void {
  reliefHandler = handler;
}

/**
 * Write a raw string to localStorage without ever throwing.
 *
 * On `QuotaExceededError` this asks the registered relief handler to free space
 * and retries exactly once, which is what turns "storage is full" from a hard
 * failure into a recoverable one.
 */
export function safeWrite(key: string, value: string): SafeWriteResult {
  const store = readStorage();
  if (!store) return fail("unavailable", key);

  try {
    store.setItem(key, value);
    return { ok: true, relieved: false };
  } catch (error) {
    if (!isQuotaError(error)) return fail("error", key);

    if (reliefHandler) {
      let relieved = false;
      try {
        relieved = reliefHandler();
      } catch {
        relieved = false;
      }
      if (relieved) {
        try {
          store.setItem(key, value);
          return { ok: true, relieved: true };
        } catch (retryError) {
          return fail(isQuotaError(retryError) ? "quota" : "error", key);
        }
      }
    }

    return fail("quota", key);
  }
}

/** Serialise `value` and write it. Returns the same non-throwing result as {@link safeWrite}. */
export function safeWriteJson(key: string, value: unknown): SafeWriteResult {
  let serialised: string;
  try {
    serialised = JSON.stringify(value);
  } catch {
    // A circular or BigInt-bearing value can never be persisted; not a storage fault.
    return fail("error", key);
  }
  if (serialised === undefined) return fail("error", key);
  return safeWrite(key, serialised);
}

/** Remove a key without throwing. */
export function safeRemove(key: string): SafeWriteResult {
  const store = readStorage();
  if (!store) return fail("unavailable", key);
  try {
    store.removeItem(key);
    return { ok: true, relieved: false };
  } catch (error) {
    return fail(isQuotaError(error) ? "quota" : "error", key);
  }
}

/**
 * Test/reset seam. Clears listeners, the relief handler and the notification
 * throttle so each test starts from a clean slate.
 */
export function resetSafeStorageForTests(): void {
  failureListeners.clear();
  lastNotifiedAt.clear();
  reliefHandler = null;
}
