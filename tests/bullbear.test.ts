import { describe, expect, it } from "vitest";
import { bullBearShare } from "../src/lib/analysis/scenario";

const c = (probability: number, bias: 1 | -1) => ({ probability, bias }) as never;

describe("Gelb: Einschätzung steigend/fallend", () => {
  it("Haupt steigend, Alternative fallend → Anteile nach Passung", () => {
    const s = bullBearShare({ best: c(0.52, 1), alternative: c(0.48, -1) })!;
    expect(Math.round(s.up * 100)).toBe(52);
    expect(Math.round(s.down * 100)).toBe(48);
  });
  it("Haupt fallend → fallend überwiegt", () => {
    const s = bullBearShare({ best: c(0.6, -1), alternative: c(0.2, 1) })!;
    expect(s.down).toBeCloseTo(0.75, 6);
  });
  it("beide gleiche Richtung → 100 % in diese Richtung; ohne Zählung null", () => {
    expect(bullBearShare({ best: c(0.5, 1), alternative: c(0.3, 1) })!.up).toBe(1);
    expect(bullBearShare({ best: c(0.5, -1), alternative: null } as never)!.down).toBe(1);
    expect(bullBearShare(null)).toBeNull();
  });
});
