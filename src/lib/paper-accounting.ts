export type LedgerFill = { symbol: string; side: "buy" | "sell"; quantity: number; price: number; feeBps?: number };

export function paperFillFee(fill: LedgerFill, assumedFeeBps: number) {
  return fill.quantity * fill.price * (fill.feeBps ?? assumedFeeBps) / 10_000;
}

export function paperCash(fills: LedgerFill[], assumedFeeBps: number, initial = 10_000) {
  return fills.reduce((cash, fill) => cash + (fill.side === "buy" ? -1 : 1) * fill.quantity * fill.price - paperFillFee(fill, assumedFeeBps), initial);
}
