import { describe, expect, it } from "vitest";
import { zoneOutcome } from "../src/lib/analysis/zoneOutcome";

const k = (time: number, o: number, h: number, l: number, c: number) => ({ time, open: o, high: h, low: l, close: c, volume: 1 });
const Z = { top: 100, bottom: 90, dir: 1 as const, cancel: 120, maxWait: 10 };

describe("Zonen-Erfolg wie HKCM", () => {
  it("eintauchen, vor der Unterkante drehen, oben heraus → Erfolg", () => {
    expect(zoneOutcome([k(0, 110, 111, 109, 110), k(1, 104, 105, 95, 96), k(2, 96, 103, 95, 102)], 0, Z)).toEqual({ result: "erfolg", at: 2 });
  });
  it("unter die Unterkante → gescheitert", () => {
    expect(zoneOutcome([k(0, 110, 111, 109, 110), k(1, 104, 105, 95, 96), k(2, 96, 97, 88, 89)], 0, Z)?.result).toBe("gescheitert");
  });
  it("Zone nie erreicht → zählt nicht", () => {
    expect(zoneOutcome([k(0, 110, 111, 109, 110), k(1, 110, 125, 108, 124)], 0, Z)).toBeNull();
  });
  it("Short gespiegelt", () => {
    const S = { top: 100, bottom: 110, dir: -1 as const, cancel: 80, maxWait: 10 };
    expect(zoneOutcome([k(0, 90, 91, 89, 90), k(1, 96, 105, 95, 104), k(2, 104, 105, 97, 98)], 0, S)?.result).toBe("erfolg");
  });
  it("nutzt nur Kerzen nach dem Signal", () => {
    expect(zoneOutcome([k(0, 95, 96, 80, 95), k(1, 110, 111, 109, 110)], 0, Z)).toBeNull();
  });
});
