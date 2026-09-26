export class AIRequestError extends Error {
  constructor(message: string, public status = 502, public retryAt: number | null = null) {
    super(message);
    this.name = "AIRequestError";
  }
}

export function providerRetryAt(headers: Headers, now = Date.now()): number {
  const retry = headers.get("retry-after");
  if (retry) {
    const value = Number(retry);
    const date = Number.isFinite(value) ? now + Math.max(0, value) * 1000 : Date.parse(retry);
    if (Number.isFinite(date)) return Math.max(now, date);
  }
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (reset > 0) return Math.max(now, reset > 1e12 ? reset : reset * 1000);
  return now + 60_000;
}

export function aiErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The request could not finish. Your input is saved; try again.";
  const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
  return {
    status: error instanceof AIRequestError ? error.status : timeout ? 504 : 502,
    error: timeout ? "The provider took too long to respond. Your input is saved; try again or choose another model in Settings." : message,
    retryAt: error instanceof AIRequestError ? error.retryAt : null,
  };
}
