type Validator = (value: unknown) => boolean;
const text: Validator = (v) => typeof v === "string" && v.length <= 20_000;
const longText: Validator = (v) => typeof v === "string" && v.length <= 200_000;
const num: Validator = (v) => typeof v === "number" && Number.isFinite(v);
const positive: Validator = (v) => num(v) && (v as number) > 0;
const nonnegative: Validator = (v) => num(v) && (v as number) >= 0;
const symbol: Validator = (v) => typeof v === "string" && /^[A-Z0-9]{5,20}$/.test(v);
const oneOf = (...options: unknown[]): Validator => (v) => options.includes(v);
const optional = (check: Validator): Validator => (v) => v === undefined || check(v);
const nullable = (check: Validator): Validator => (v) => v === null || check(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const object = (fields: Record<string, Validator>): Validator => (v) => record(v) && Object.keys(v).every((key) => Object.hasOwn(fields, key)) && Object.entries(fields).every(([key, check]) => check(v[key]));
const looseObject = (fields: Record<string, Validator>): Validator => (v) => record(v) && Object.entries(fields).every(([key, check]) => check(v[key]));
const array = (check: Validator, max = 10000): Validator => (v) => Array.isArray(v) && v.length <= max && v.every(check);
const interval = oneOf("15m", "1H", "4H", "1D");
const fee: Validator = (v) => nonnegative(v) && (v as number) <= 1000;
const source = object({ url: text, title: text, content: text });
const researchRef = object({ id: text, question: text });
const backtestRef = object({ symbol, interval, summary: text, returnPct: num, capturedAt: positive });
const fill = object({ id: text, symbol, side: oneOf("buy", "sell"), quantity: positive, price: positive, createdAt: positive, feeBps: optional(fee), researchRef: optional(researchRef), backtestRef: optional(backtestRef), playbookName: optional(text), exitNote: optional(text) });
const journal = object({
  id: text, question: text, symbol, interval, summary: text, regime: text, price: positive, createdAt: positive,
  marketSnapshot: optional(object({ change24h: num, high24h: num, low24h: num, volume24h: num, turnover24h: num, asOf: positive })),
  indicators: optional(object({ ema20: nullable(num), ema50: nullable(num), rsi14: num, support: num, resistance: num, rangePct: num, regime: text })),
  bullCase: optional(text), bearCase: optional(text), invalidation: optional(text), engine: optional(text), commentary: optional(nullable(text)), newsContext: optional(text), sources: optional(array(source, 100)), webResearchIncluded: optional(oneOf(true, false)),
});
const playbook = object({ id: text, name: text, symbol, interval, prompt: text, lookbackDays: oneOf(7, 30, 90, 180, 365), feeBps: fee, slippageBps: fee, createdAt: positive, researchRef: optional(researchRef), backtestRef: optional(backtestRef) });
const bracket = object({ symbol, takeProfitPrice: optional(positive), takeProfitPct: optional(positive), stopLossPrice: optional(positive), stopLossPct: optional(positive), trailingStopPct: optional(positive), peakPrice: optional(positive), createdAt: positive });
const ruleRunnerLog = looseObject({ id: text, time: positive, symbol, action: oneOf("buy", "sell", "hold"), message: text });
const copilotAction = (v: unknown) => record(v) && typeof v.type === "string" && oneOf("order", "backtest", "playbook", "market")(v.type);
const copilotMessage = looseObject({ id: text, role: oneOf("user", "assistant", "system"), content: longText, timestamp: positive, actions: optional(array(copilotAction, 100)) });
const copilotSession = looseObject({ id: text, title: text, createdAt: positive, updatedAt: positive, symbol, messages: array(copilotMessage, 5_000) });

const schemas: Record<string, Validator> = {
  "goriee.journal.v1": array(journal, 30),
  "goriee.paper.v1": array(fill),
  "goriee.watchlist.v1": array(symbol, 50),
  "goriee.paper-alerts.v1": array(object({ id: text, symbol, purpose: oneOf("price", "stop", "target"), direction: oneOf("above", "below"), price: positive, createdAt: positive, triggeredAt: nullable(positive) }), 50),
  "goriee.paper-risk.v1": (v) => num(v) && (v as number) >= 1 && (v as number) <= 100000,
  "goriee.paper-fee-bps.v1": fee,
  "goriee.playbooks.v1": array(playbook, 30),
  "goriee.active-paper-playbook.v1": text,
  "goriee.paper-brackets.v1": (v) => record(v) && Object.entries(v).every(([key, value]) => symbol(key) && bracket(value) && (value as Record<string, unknown>).symbol === key),
  "goriee.drafts.v1": object({ question: optional(text), strategy: optional(text) }),
  "goriee.auto-rule-runner.v1": (v) => typeof v === "boolean",
  "goriee.rule-runner-logs.v1": array(ruleRunnerLog, 50),
  "goriee_copilot_sessions_v1": array(copilotSession, 100),
};

export type WorkspaceSnapshot = { format: "goriee-workspace"; version: 1; exportedAt: string; data: Record<string, unknown> };
export const backupKeys = Object.keys(schemas);

export function parseWorkspaceBackup(raw: string): WorkspaceSnapshot {
  if (raw.length > 4_000_000) throw new Error("Backup is too large (4 MB maximum).");
  const snapshot: unknown = JSON.parse(raw);
  if (!record(snapshot) || snapshot.format !== "goriee-workspace" || snapshot.version !== 1 || typeof snapshot.exportedAt !== "string" || !Number.isFinite(Date.parse(snapshot.exportedAt)) || !record(snapshot.data)) throw new Error("Choose a Goriee workspace backup, version 1.");
  const data = snapshot.data;
  if (!Object.keys(data).length || !Object.entries(data).every(([key, value]) => Object.hasOwn(schemas, key) && schemas[key](value))) throw new Error("Backup contains unsupported or invalid data. Nothing was changed.");
  for (const key of ["goriee.paper.v1", "goriee.journal.v1", "goriee.playbooks.v1", "goriee.paper-alerts.v1", "goriee.rule-runner-logs.v1", "goriee_copilot_sessions_v1"]) {
    const items = (data[key] ?? []) as Array<{ id: string }>;
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Backup contains duplicate record IDs.");
  }
  return snapshot as WorkspaceSnapshot;
}

export function captureWorkspace(storage: Pick<Storage, "getItem">): WorkspaceSnapshot {
  const data: Record<string, unknown> = {};
  for (const key of backupKeys) {
    const value = storage.getItem(key);
    if (value !== null) data[key] = JSON.parse(value);
  }
  return { format: "goriee-workspace", version: 1, exportedAt: new Date().toISOString(), data };
}

export function restoreWorkspace(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, snapshot: WorkspaceSnapshot) {
  const validated = parseWorkspaceBackup(JSON.stringify(snapshot));
  const original = backupKeys.map((key) => [key, storage.getItem(key)] as const);
  try {
    for (const key of backupKeys) storage.removeItem(key);
    for (const [key, value] of Object.entries(validated.data)) storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    for (const key of backupKeys) storage.removeItem(key);
    for (const [key, value] of original) if (value !== null) storage.setItem(key, value);
    throw error;
  }
}
