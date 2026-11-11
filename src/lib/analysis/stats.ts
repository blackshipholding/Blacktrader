// Performance-Kennzahlen für Journal und Backtest.

export interface ClosedTradeLike {
  returnPct: number; // in Prozent, z. B. 4.2
  closedAt: number; // ms
}

export interface PerformanceStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number; // 0 … 1
  avgWin: number; // %
  avgLoss: number; // % (negativ)
  profitFactor: number | null;
  totalReturn: number; // % kumuliert (zusammengesetzt)
  maxDrawdown: number; // % (negativ oder 0)
  curve: { time: number; equity: number; cumulative: number }[];
}

/** Rendite einer Position in % (Long/Short). */
export function tradeReturnPct(direction: "long" | "short", entry: number, exit: number): number {
  const r = direction === "long" ? (exit - entry) / entry : (entry - exit) / entry;
  return r * 100;
}

/** Kennzahlen: jede Position mit vollem Einsatz nacheinander → zusammengesetzte Equity-Kurve. */
export function performance(trades: ClosedTradeLike[]): PerformanceStats {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  const curve: PerformanceStats["curve"] = [];
  const winsArr: number[] = [];
  const lossArr: number[] = [];
  for (const t of sorted) {
    equity *= 1 + t.returnPct / 100;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, (equity - peak) / peak);
    curve.push({ time: t.closedAt, equity, cumulative: (equity - 1) * 100 });
    if (t.returnPct > 0) winsArr.push(t.returnPct);
    else lossArr.push(t.returnPct);
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const grossWin = sum(winsArr);
  const grossLoss = -sum(lossArr);
  return {
    trades: sorted.length,
    wins: winsArr.length,
    losses: lossArr.length,
    winRate: sorted.length ? winsArr.length / sorted.length : 0,
    avgWin: winsArr.length ? grossWin / winsArr.length : 0,
    avgLoss: lossArr.length ? -grossLoss / lossArr.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : winsArr.length ? null : 0,
    totalReturn: (equity - 1) * 100,
    maxDrawdown: maxDd * 100,
    curve,
  };
}
