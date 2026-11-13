import { describe, expect, it } from "vitest";
import { fxReady } from "../src/lib/client/account";
import { setFxRates } from "../src/lib/fx";

describe("Wechselkurs-Sperre", () => {
  it("Euro immer bereit, Dollar erst mit Kurs", () => {
    expect(fxReady("EUR")).toBe(true);
    expect(fxReady(undefined)).toBe(true);
    expect(fxReady("XXX")).toBe(false);
    setFxRates({ USD: 0.9 });
    expect(fxReady("USD")).toBe(true);
    expect(fxReady("USDT")).toBe(true);
  });
});
