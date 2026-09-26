import type { CompletedTrade } from "@/lib/backtest";

export type MonteCarloStepPercentiles = {
  step: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
};

export type MonteCarloResult = {
  simulationsCount: number;
  tradeCount: number;
  startingBalance: number;
  var95ReturnPct: number; // 5th percentile return (95% VaR)
  cvar95ReturnPct: number; // Conditional VaR / Expected Shortfall
  medianReturnPct: number; // 50th percentile
  p95ReturnPct: number; // 95th percentile
  medianMaxDrawdownPct: number;
  p95MaxDrawdownPct: number; // 95% worst-case max drawdown
  probSevereDrawdownPct: number; // % paths > 25% max DD
  probRuinPct: number; // % paths > 50% max DD
  stressRating: "Robust" | "Acceptable" | "Fragile";
  stressVerdict: string;
  fanTrajectory: MonteCarloStepPercentiles[];
};

function percentile(sortedValues: number[], pct: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.floor((pct / 100) * sortedValues.length)));
  return sortedValues[index];
}

export function runMonteCarloSimulation(
  trades: CompletedTrade[],
  startingBalance = 10000,
  simulationsCount = 1000,
  slippageJitterBps = 4
): MonteCarloResult {
  if (trades.length === 0) {
    return {
      simulationsCount: 0,
      tradeCount: 0,
      startingBalance,
      var95ReturnPct: 0,
      cvar95ReturnPct: 0,
      medianReturnPct: 0,
      p95ReturnPct: 0,
      medianMaxDrawdownPct: 0,
      p95MaxDrawdownPct: 0,
      probSevereDrawdownPct: 0,
      probRuinPct: 0,
      stressRating: "Fragile",
      stressVerdict: "No completed trades to simulate.",
      fanTrajectory: [],
    };
  }

  const tradeReturns = trades.map((t) => t.returnPct);
  const k = tradeReturns.length;
  const numSteps = Math.min(k, 30);
  const stepIndices = Array.from({ length: numSteps + 1 }, (_, i) => Math.round((i / numSteps) * k));

  const finalReturns: number[] = [];
  const maxDrawdowns: number[] = [];
  // stepValues[stepIndex] = array of balance values across all iterations
  const stepValues: number[][] = Array.from({ length: stepIndices.length }, () => []);

  // Pseudo-random generator with fixed-ish spread for repeatability if needed, or Math.random
  for (let sim = 0; sim < simulationsCount; sim += 1) {
    let balance = startingBalance;
    let peak = startingBalance;
    let maxDd = 0;

    let stepTracker = 0;
    if (stepIndices[0] === 0) {
      stepValues[0].push(balance);
      stepTracker = 1;
    }

    for (let tradeIdx = 0; tradeIdx < k; tradeIdx += 1) {
      // Bootstrap resample with replacement
      const randomPick = tradeReturns[Math.floor(Math.random() * tradeReturns.length)];
      // Apply slight random execution slippage noise (+/- slippageJitterBps)
      const noise = ((Math.random() * 2 - 1) * slippageJitterBps) / 100;
      const effectiveReturn = randomPick + noise;

      // Compound balance
      balance = Math.max(1, balance * (1 + effectiveReturn / 100));
      if (balance > peak) peak = balance;
      const currentDd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
      if (currentDd > maxDd) maxDd = currentDd;

      // Check if current tradeIdx+1 matches a recorded trajectory step
      if (stepTracker < stepIndices.length && tradeIdx + 1 === stepIndices[stepTracker]) {
        stepValues[stepTracker].push(balance);
        stepTracker += 1;
      }
    }

    const retPct = ((balance - startingBalance) / startingBalance) * 100;
    finalReturns.push(retPct);
    maxDrawdowns.push(maxDd);
  }

  // Sort distributions for percentile extraction
  finalReturns.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);

  const var95ReturnPct = percentile(finalReturns, 5);
  const bottom5Percent = finalReturns.slice(0, Math.max(1, Math.floor(0.05 * finalReturns.length)));
  const cvar95ReturnPct = bottom5Percent.reduce((a, b) => a + b, 0) / bottom5Percent.length;

  const medianReturnPct = percentile(finalReturns, 50);
  const p95ReturnPct = percentile(finalReturns, 95);

  const medianMaxDrawdownPct = percentile(maxDrawdowns, 50);
  const p95MaxDrawdownPct = percentile(maxDrawdowns, 95);

  const severeDds = maxDrawdowns.filter((dd) => dd >= 25).length;
  const probSevereDrawdownPct = (severeDds / simulationsCount) * 100;

  const ruinDds = maxDrawdowns.filter((dd) => dd >= 50).length;
  const probRuinPct = (ruinDds / simulationsCount) * 100;

  // Compute Fan Trajectory percentiles
  const fanTrajectory: MonteCarloStepPercentiles[] = stepIndices.map((step, idx) => {
    const vals = (stepValues[idx] || []).slice().sort((a, b) => a - b);
    return {
      step,
      p5: percentile(vals, 5),
      p25: percentile(vals, 25),
      p50: percentile(vals, 50),
      p75: percentile(vals, 75),
      p95: percentile(vals, 95),
    };
  });

  // Determine institutional rating
  let stressRating: "Robust" | "Acceptable" | "Fragile" = "Acceptable";
  let stressVerdict = "";

  if (probRuinPct === 0 && probSevereDrawdownPct < 10 && var95ReturnPct > -5) {
    stressRating = "Robust";
    stressVerdict = `High sequence resilience. 95% worst-case max drawdown is contained at ${p95MaxDrawdownPct.toFixed(1)}% with zero observed ruin paths.`;
  } else if (probRuinPct < 3 && p95MaxDrawdownPct < 38) {
    stressRating = "Acceptable";
    stressVerdict = `Moderate risk profile. 95% VaR floor is ${var95ReturnPct.toFixed(1)}% with severe drawdown risk at ${probSevereDrawdownPct.toFixed(1)}%.`;
  } else {
    stressRating = "Fragile";
    stressVerdict = `High vulnerability to trade clustering or sequence shocks. Worst-case drawdown reaches ${p95MaxDrawdownPct.toFixed(1)}% (Ruin risk: ${probRuinPct.toFixed(1)}%).`;
  }

  return {
    simulationsCount,
    tradeCount: k,
    startingBalance,
    var95ReturnPct,
    cvar95ReturnPct,
    medianReturnPct,
    p95ReturnPct,
    medianMaxDrawdownPct,
    p95MaxDrawdownPct,
    probSevereDrawdownPct,
    probRuinPct,
    stressRating,
    stressVerdict,
    fanTrajectory,
  };
}
