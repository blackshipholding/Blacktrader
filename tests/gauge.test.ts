import { describe, expect, it } from "vitest";
import { gaugeTone } from "../src/components/NeutralGauge";

describe("Gelb: Stimmungs-Balken", () => {
  it("45–55 neutral (gelb), darüber bullisch (grün), darunter bärisch (rot)", () => {
    expect(gaugeTone(50)).toBe("neutral");
    expect(gaugeTone(45)).toBe("neutral");
    expect(gaugeTone(55)).toBe("neutral");
    expect(gaugeTone(56)).toBe("bull");
    expect(gaugeTone(44)).toBe("bear");
  });
});
