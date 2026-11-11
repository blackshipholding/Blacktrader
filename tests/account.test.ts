import { describe, expect, it } from "vitest";
import { ACCOUNT, computeAccount } from "../src/lib/client/account";
import { summarizeHolding, totalTax } from "../src/lib/client/holdings";
import type { Trade } from "../src/lib/store/store";

const T = (id: string, openedAt: number, r?: number, closedAt?: number, extra: Partial<Trade> = {}): Trade =>
  ({ id, symbol: id, name: id, kind: "stock", horizon: "medium", interval: "1d", direction: "long", entry: 100, stop: 90, targets: [120], openedAt, reason: "", score: 50, signal: "buy", pattern: "", status: closedAt ? "closed" : "open", returnPct: r, closedAt, source: "manual", ...extra }) as Trade;
const Y = Date.UTC(2026, 0, 10);
const D = 86400e3;

describe("Blacktrader-Konto im Depot", () => {
  it("8.000 € Start, 500 € je Trade, 7,90 € je Order, 27,5 % KESt auf den Gewinn", () => {
    expect(ACCOUNT).toMatchObject({ start: 8000, stake: 500, fee: 7.9, tax: 0.275 });
    const [a] = computeAccount([T("A", Y, 10, Y + D)], [], () => null);
    // +10 % auf 500 € = 50 €, 2 × 7,90 € Gebühr, 13,75 € KESt
    expect(a.equity).toBeCloseTo(8000 + 50 - 15.8 - 13.75, 6);
    expect(a.fees).toBeCloseTo(15.8, 6);
    expect(a.tax).toBeCloseTo(13.75, 6);
    expect(a.closed).toBe(1);
    expect(a.wins).toBe(1);
  });
  it("Verlust im selben Jahr holt KESt zurück; offene Trades zum aktuellen Kurs bewertet", () => {
    const [a] = computeAccount([T("A", Y, 10, Y + D), T("B", Y + 2 * D, -10, Y + 3 * D), T("C", Y + 4 * D)], [], () => 20);
    expect(a.tax).toBeCloseTo(0, 6);
    expect(a.open).toBe(1);
    expect(a.equity).toBeCloseTo(8000 - 4 * 7.9 - 7.9 + 100, 6);
  });
  it("ohne Geld keine neuen Trades; ohne Geld und ohne offene Position pleite – Neustart beginnt eine neue Runde", () => {
    const many = Array.from({ length: 16 }, (_, i) => T(`S${i}`, Y + i));
    const [a] = computeAccount(many, [], () => 0);
    expect(a.blocked).toBe(true);
    expect(a.broke).toBe(false);
    const lost = Array.from({ length: 16 }, (_, i) => T(`L${i}`, Y + i * D, -100, Y + i * D + 1000));
    const [b] = computeAccount(lost, [], () => null);
    expect(b.broke).toBe(true);
    const rounds = computeAccount(lost, [Y + 20 * D], () => null);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].equity).toBe(8000);
    expect(rounds[1].broke).toBe(false);
  });
});

describe("Konto mit echtem Betrag (Stück × Kurs)", () => {
  it("rechnet mit dem eingesetzten Betrag statt pauschal 500 €", () => {
    const [a] = computeAccount([T("U", Y, 10, Y + D, { stakeEur: 506.56 })], [], () => null);
    expect(a.equity).toBeCloseTo(8000 + 50.656 - 15.8 - 50.656 * 0.275, 6);
  });
});

describe("Buy & Hold", () => {
  it("gleitender Durchschnittspreis, verkaufter Gewinn, Gebühren, KESt je Jahr verrechnet", () => {
    const s = summarizeHolding({
      txs: [
        { id: "1", type: "buy", date: "2025-01-02", price: 100, qty: 10, fee: 7.9 },
        { id: "2", type: "buy", date: "2025-06-02", price: 200, qty: 10, fee: 7.9 },
        { id: "3", type: "sell", date: "2026-03-01", price: 180, qty: 5, fee: 7.9 },
      ],
    });
    expect(s.avg).toBeCloseTo(150, 6);
    expect(s.qty).toBe(15);
    expect(s.realized).toBeCloseTo(150, 6);
    expect(s.fees).toBeCloseTo(23.7, 6);
    expect(s.tax).toBeCloseTo(150 * 0.275, 6);
    const loss = summarizeHolding({ txs: [{ id: "a", type: "buy", date: "2026-01-01", price: 50, qty: 10, fee: 0 }, { id: "b", type: "sell", date: "2026-05-01", price: 40, qty: 10, fee: 0 }] });
    expect(loss.qty).toBe(0);
    expect(totalTax([s, loss])).toBeCloseTo(50 * 0.275, 6);
  });
});

describe("Dividenden und Steuer-Jahresübersicht", () => {
  it("Dividenden zählen zur KESt und werden mit Verlusten verrechnet; Blacktrader-Trades und Buy & Hold zusammen", async () => {
    const { taxYears } = await import("../src/lib/client/taxYear");
    const h = { id: "h", symbol: "X", name: "X", kind: "stock" as const, txs: [
      { id: "1", type: "buy" as const, date: "2026-01-02", price: 100, qty: 10, fee: 7.9 },
      { id: "2", type: "div" as const, date: "2026-03-01", price: 40, qty: 1, fee: 0 },
      { id: "3", type: "sell" as const, date: "2026-06-01", price: 90, qty: 10, fee: 7.9 },
    ] };
    const s = summarizeHolding(h);
    expect(s.dividends).toBe(40);
    expect(s.realized).toBeCloseTo(-100, 6);
    const trade = T("A", Date.UTC(2026, 1, 1), 20, Date.UTC(2026, 2, 1), { stakeEur: 500 });
    const [y] = taxYears([trade], [h]);
    expect(y.year).toBe("2026");
    expect(y.trades).toBeCloseTo(100, 6);
    expect(y.sold).toBeCloseTo(-100, 6);
    expect(y.dividends).toBe(40);
    expect(y.kest).toBeCloseTo(40 * 0.275, 6);
  });
});

describe("EchoChart-Konto (8.000 €, 500 € je Trade, netto)", () => {
  it("Gewinn nach Gebühr und KESt; ohne Geld wird ausgelassen", async () => {
    const { simulateAccount } = await import("../src/lib/client/account");
    const r = simulateAccount([{ sym: "A", entry: Y, exit: Y + D, r: 20 }]);
    // 100 € Gewinn − 2 × 7,90 € − 27,50 € KESt
    expect(r.end).toBeCloseTo(8000 + 100 - 15.8 - 27.5, 6);
    expect(r.profitPct).toBeCloseTo(((100 - 15.8 - 27.5) / 8000) * 100, 6);
    const many = Array.from({ length: 20 }, (_, i) => ({ sym: `S${i}`, entry: Y + i, exit: Y + 10 * D, r: 0 }));
    const m = simulateAccount(many);
    expect(m.taken).toBe(15);
    expect(m.skipped).toBe(5);
  });
});

describe("KESt mit Verlusttopf (wie bei der österreichischen Bank)", () => {
  it("Verlust zuerst, Gewinn später im selben Jahr: verrechnet; im nächsten Jahr verfällt der Topf", async () => {
    const { KestYear } = await import("../src/lib/analysis/kest");
    const k = new KestYear(0.275);
    expect(k.settle(-100, 2026)).toBeCloseTo(0, 6); // nichts bezahlt → in den Topf
    expect(k.settle(150, 2026)).toBeCloseTo(50 * 0.275, 6); // nur 50 € steuerpflichtig
    expect(k.settle(-20, 2026)).toBeCloseTo(-20 * 0.275, 6); // holt bezahlte KESt zurück
    const n = new KestYear(0.275);
    n.settle(-100, 2025);
    expect(n.settle(100, 2026)).toBeCloseTo(27.5, 6); // kein Vortrag ins nächste Jahr
    const { simulateAccount } = await import("../src/lib/client/account");
    const r = simulateAccount([
      { sym: "A", entry: Y, exit: Y + D, r: -20 },
      { sym: "B", entry: Y + 2 * D, exit: Y + 3 * D, r: 20 },
    ]);
    expect(r.tax).toBeCloseTo(0, 6);
  });
});

describe("Blau in drei Teilen: Gewinn/Verlust nur auf den gekauften Teil", () => {
  it("1 von 3 Teilen gekauft: Verlust nur auf diesen Teil, der Rest der Reservierung kommt zurück", async () => {
    const { computeAccount, investedOf } = await import("../src/lib/client/account");
    const t = { id: "b", strategy: "longterm", status: "closed", symbol: "IFX.DE", name: "Infineon", kind: "stock", horizon: "long", direction: "long", entry: 56, stop: 0, targets: [88], openedAt: Date.UTC(2026, 0, 2), closedAt: Date.UTC(2026, 1, 2), closeReason: "invalidiert", returnPct: -20, stakeEur: 482, tranches: [{ price: 56, filledAt: 1, qty: 3, eur: 168 }, { price: 49, qty: 3, eur: 147 }, { price: 42, qty: 4, eur: 167 }], partials: [], source: "manual" } as never;
    expect(investedOf(t)).toBe(168);
    const r = computeAccount([t], [], () => null).at(-1)!;
    // 8.000 − 1 Kauf-Gebühr − 1 Verkaufs-Gebühr − 20 % von 168 €
    expect(r.equity).toBeCloseTo(8000 - 7.9 - 7.9 - 33.6, 6);
  });
});
