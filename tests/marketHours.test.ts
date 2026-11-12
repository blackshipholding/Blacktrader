import { describe, expect, it } from "vitest";
import { marketClosed } from "../src/lib/client/marketHours";

const now = 1_700_000_000_000;
const t = (minAgo: number) => now / 1000 - minAgo * 60;

describe("Börse geschlossen", () => {
  it("frischer oder 15 Min alter Kurs (verzögert) = offen", () => {
    expect(marketClosed("stock", t(1), now)).toBe(false);
    expect(marketClosed("stock", t(15), now)).toBe(false);
  });
  it("Kurs älter als 30 Min = geschlossen", () => {
    expect(marketClosed("stock", t(31), now)).toBe(true);
    expect(marketClosed("commodity", t(600), now)).toBe(true);
  });
  it("Krypto handelt immer, ohne Kurszeit nie geschlossen", () => {
    expect(marketClosed("crypto", t(600), now)).toBe(false);
    expect(marketClosed("stock", undefined, now)).toBe(false);
  });
});
