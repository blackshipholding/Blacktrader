import { describe, expect, it } from "vitest";
import { regionOf, worldAssets } from "../src/lib/client/worldList";
import { MARKET_ASSETS } from "../src/lib/client/marketList";

describe("Welt-Suche: Werteliste", () => {
  const all = worldAssets();
  it("Umfang: rund 1.000 Werte, genau 40 Coins und 20 Rohstoffe, keine Doppelten, nichts aus der normalen Chancen-Suche", () => {
    expect(all.length).toBeGreaterThan(800);
    expect(all.filter((a) => a.kind === "crypto")).toHaveLength(40);
    expect(all.filter((a) => a.kind === "commodity")).toHaveLength(20);
    const keys = all.map((a) => `${a.kind}:${a.symbol}`);
    expect(new Set(keys).size).toBe(keys.length);
    const market = new Set(MARKET_ASSETS.map((a) => `${a.kind}:${a.symbol}`));
    expect(keys.filter((k) => market.has(k))).toEqual([]);
  });
  it("Regionen nach Börsen-Endung", () => {
    expect(regionOf({ kind: "stock", symbol: "AAPL" })).toBe("USA");
    expect(regionOf({ kind: "stock", symbol: "SAP.DE" })).toBe("Europa");
    expect(regionOf({ kind: "stock", symbol: "RY.TO" })).toBe("Kanada");
    expect(regionOf({ kind: "stock", symbol: "7203.T" })).toBe("Asien-Pazifik");
    expect(regionOf({ kind: "stock", symbol: "0700.HK" })).toBe("Asien-Pazifik");
    expect(regionOf({ kind: "stock", symbol: "2331.HK" })).toBe("Schwellenländer Asien");
    expect(regionOf({ kind: "stock", symbol: "600519.SS" })).toBe("Schwellenländer Asien");
    expect(regionOf({ kind: "stock", symbol: "TCS.NS" })).toBe("Schwellenländer Asien");
    expect(regionOf({ kind: "crypto", symbol: "PEPE" })).toBe("Krypto");
  });
});
