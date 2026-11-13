import { beforeEach, describe, expect, it } from "vitest";
import { orderError, orderFillPrice, orderTriggered, reservedForSale, type Holding } from "../src/lib/client/holdings";
import { levelTouched } from "../src/lib/analysis/missedStop";
import { actions, getData } from "../src/lib/store/store";

const base = (): Holding => ({ id: "h", symbol: "X", name: "X", kind: "stock", txs: [{ id: "a", type: "buy", date: "2025-01-02", price: 100, qty: 10, fee: 7.9 }] });

describe("Buy & Hold: Orders", () => {
  it("mehrere Stops je Aktie, Summe nie über dem Bestand", () => {
    const h = { ...base(), orders: [{ id: "o1", kind: "stop" as const, priceEur: 90, qty: 5, createdAt: 1 }] };
    expect(orderError(h, { kind: "stop", priceEur: 80, qty: 5 })).toBeNull();
    expect(orderError(h, { kind: "stop", priceEur: 80, qty: 6 })).toMatch(/Frei sind nur 5/);
    expect(reservedForSale(h)).toBe(5);
    // Kauf-Limit braucht keine Stück im Depot
    expect(orderError(h, { kind: "buy", priceEur: 80, qty: 50 })).toBeNull();
  });
  it("Stop muss unter dem Kurs liegen, Verkaufs-Limit darüber", () => {
    const h = base();
    expect(orderError(h, { kind: "stop", priceEur: 105, qty: 1 }, 100)).toMatch(/unter dem aktuellen Kurs/);
    expect(orderError(h, { kind: "sell", priceEur: 95, qty: 1 }, 100)).toMatch(/über dem aktuellen Kurs/);
    expect(orderError(h, { kind: "sell", priceEur: 120, qty: 1 }, 100)).toBeNull();
  });
  it("Auslösen und Ausführungspreis wie bei flatex", () => {
    expect(orderTriggered({ kind: "stop", priceEur: 90 }, 89.9)).toBe(true);
    expect(orderTriggered({ kind: "stop", priceEur: 90 }, 90.1)).toBe(false);
    expect(orderTriggered({ kind: "sell", priceEur: 120 }, 120)).toBe(true);
    expect(orderTriggered({ kind: "buy", priceEur: 80 }, 79)).toBe(true);
    expect(orderFillPrice({ kind: "stop", priceEur: 90 }, 85)).toBe(85); // Stop = Marktpreis, nie besser
    expect(orderFillPrice({ kind: "sell", priceEur: 120 }, 125)).toBe(120);
  });
  it("Rückrechnen in Euro mit dem Wechselkurs der Zeit; nach Zeit sortiert prüfbar", () => {
    const c = (time: number, low: number, high: number) => ({ time, open: low, high, low, close: high, volume: 1 });
    const candles = [c(1000, 100, 101), c(2000, 94, 99), c(3000, 80, 90)];
    // Dollar: 1 USD = 0,9 € zur Zeit 1000/2000, 0,8 € bei 3000
    const eurPer = (t: number) => (t < 3000 ? 0.9 : 0.8);
    const stop = levelTouched(candles, 76, eurPer, 0, 1000, "below"); // 80 $ × 0,8 = 64 € ≤ 76
    expect(stop?.touched).toBe(true);
    expect(stop?.at).toBe(3000);
    const lim = levelTouched(candles, 100, eurPer, 0, 1000, "above", 0); // 101 $ × 0,9 = 90,9 € < 100
    expect(lim?.touched).toBe(false);
  });
});

describe("Buy & Hold: Order buchen (fillHoldOrder)", () => {
  beforeEach(() => {
    actions.clearHoldings();
    actions.addHolding({ symbol: "X", name: "X", kind: "stock" }, { type: "buy", date: "2025-01-02", price: 100, qty: 10, fee: 7.9 });
  });
  it("Verkauf wird eingetragen, Order entfernt, übrige Stops auf den Rest gekürzt", () => {
    const id = getData().holdings[0].id;
    actions.addHoldOrder(id, { kind: "stop", priceEur: 90, qty: 6 });
    actions.addHoldOrder(id, { kind: "stop", priceEur: 80, qty: 4 });
    const o1 = getData().holdings[0].orders![0];
    actions.fillHoldOrder(id, o1.id, 89, "2025-02-01", 7.9);
    const h = getData().holdings[0];
    expect(h.txs.at(-1)).toMatchObject({ type: "sell", qty: 6, price: 89, fee: 7.9 });
    expect(h.orders).toHaveLength(1);
    expect(h.orders![0].qty).toBe(4);
  });
  it("Ganz verkauft: Stops und Verkaufs-Orders verschwinden, Kauf-Limit bleibt", () => {
    const id = getData().holdings[0].id;
    actions.addHoldOrder(id, { kind: "stop", priceEur: 90, qty: 10 });
    actions.addHoldOrder(id, { kind: "buy", priceEur: 70, qty: 3 });
    actions.fillHoldOrder(id, getData().holdings[0].orders![0].id, 90, "2025-02-01", 7.9);
    const h = getData().holdings[0];
    expect(h.orders!.map((o) => o.kind)).toEqual(["buy"]);
  });
  it("Kauf-Limit ausgeführt: Kauf eingetragen", () => {
    const id = getData().holdings[0].id;
    actions.addHoldOrder(id, { kind: "buy", priceEur: 70, qty: 3 });
    actions.fillHoldOrder(id, getData().holdings[0].orders![0].id, 70, "2025-02-01", 7.9);
    expect(getData().holdings[0].txs.at(-1)).toMatchObject({ type: "buy", qty: 3, price: 70 });
  });
});
