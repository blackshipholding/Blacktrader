import { describe, expect, it } from "vitest";
import { chanceStats, evaluateChance, type ChanceLogEntry } from "../src/lib/client/chanceLog";
import { makeOrderSlip, qtyFor } from "../src/lib/client/orderSlip";

const c = (time: number, low: number, high: number, close = (low + high) / 2) => ({ time, open: close, high, low, close, volume: 0 });
const base: ChanceLogEntry = { key: "k", symbol: "X", name: "X", kind: "stock", color: "gruen", dir: "long", zoneTop: 100, zoneBottom: 95, stop: 90, target: 120, from: 0 };

describe("Live-Bilanz der Chancen", () => {
  it("Ziel nach dem Einstieg = Treffer; Stop zuerst = Stop; Ziel ohne Einstieg = verpasst", () => {
    expect(evaluateChance(base, [c(1, 101, 105), c(2, 99, 104), c(3, 110, 121)]).result).toBe("ziel");
    expect(evaluateChance(base, [c(1, 99, 104), c(2, 89, 100)]).result).toBe("stop");
    expect(evaluateChance(base, [c(1, 105, 122)]).result).toBe("verpasst");
    const open = evaluateChance(base, [c(1, 99, 104)]);
    expect(open.result).toBeUndefined();
    expect(open.entered).toBe(1);
    // Blau: nur Schlusskurs unter der Ungültig-Grenze zählt
    expect(evaluateChance({ ...base, color: "blau" }, [c(1, 99, 104), c(2, 88, 95, 92)]).result).toBeUndefined();
    // nur Kerzen nach dem Eintragen
    expect(evaluateChance({ ...base, from: 5 }, [c(1, 99, 125)]).result).toBeUndefined();
    const s = chanceStats([{ ...base, result: "ziel" }, { ...base, result: "stop" }, { ...base, result: "ziel" }, base]);
    expect(s.hitRate).toBeCloseTo(2 / 3, 6);
    expect(s.open).toBe(1);
  });
});

describe("Order-Zettel für flatex", () => {
  it("ganze Stück so nah wie möglich an 500 € (bis 50 € darüber), Bruchteile bei Krypto, Blau in drei Teilen", () => {
    expect(qtyFor("stock", 500, 119.15)).toBe(4);
    expect(qtyFor("stock", 500, 63.32)).toBe(8); // 506,56 € statt 443,24 €
    expect(qtyFor("stock", 500, 530)).toBe(1); // 1 Stück bis 550 € erlaubt
    expect(qtyFor("stock", 500, 560)).toBe(0);
    expect(qtyFor("crypto", 500, 61593.88)).toBeCloseTo(0.0081, 6);
    const s = makeOrderSlip({ kind: "stock", symbol: "SAP.DE", name: "SAP", currency: "EUR", direction: "long", entry: 200, stop: 180, targets: [240] });
    expect(s.orders[0]).toMatchObject({ qty: 2, limitEur: 200 });
    expect(s.text).toContain("Limit-Kauf 2 Stück zu 200,00 €");
    expect(s.text).toContain("Stop-Loss: 180,00 €");
    const lt = makeOrderSlip({ kind: "stock", symbol: "SAP.DE", name: "SAP", currency: "EUR", direction: "long", entry: 100, tranches: [100, 90, 80], invalidation: 70, targets: [150] });
    expect(lt.orders.map((o) => o.qty)).toEqual([1, 2, 3]); // 520 € (bis 550 € je Trade) statt 440 €
    expect(lt.text).toContain("ungültig unter 70,00 €");
  });
});

describe("Kontrolle der Live-Bilanz", () => {
  it("warnt erst ab 100 Ergebnissen und nur bei sehr deutlicher Abweichung", async () => {
    const { liveCheck } = await import("../src/lib/client/liveCheck");
    const mk = (n: number, hits: number, color: "gruen" | "blau" | "rot" = "gruen") =>
      Array.from({ length: n }, (_, i) => ({ ...base, key: `${color}${i}`, color, result: (i < hits ? "ziel" : "stop") as "ziel" | "stop" }));
    expect(liveCheck(mk(60, 10)).all.verdict).toBe("zu-wenig");
    expect(liveCheck(mk(100, 45)).warn).toBe(false); // 45 % statt 50 % – Zufall
    const bad = liveCheck(mk(120, 30)); // 25 % statt 50 %
    expect(bad.warn).toBe(true);
    expect(bad.byColor.gruen.verdict).toBe("schlechter");
    expect(liveCheck(mk(100, 75)).all.verdict).toBe("besser");
  });
});
