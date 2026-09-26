"use client";

import { useEffect, useState } from "react";

export function RequestRecovery({ retryAt, busy, onRetry }: { retryAt: number; busy: boolean; onRetry: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return <div className="request-recovery"><p>Your input is kept here and saved in this browser. {seconds ? `Retry available in ${seconds}s. The provider may still have a daily quota.` : "You can retry with your current input or change the model in Settings."}</p><button type="button" className="button button-secondary" disabled={busy || seconds > 0} onClick={onRetry}>{busy ? "Request in progress…" : seconds ? `Wait ${seconds}s` : "Retry request"}</button></div>;
}
