import { describe, expect, it } from "vitest";
import { nextWave, waveCaption } from "../src/components/waveText";
import type { WaveCount } from "../src/lib/analysis/elliott";

const c = (o: Partial<WaveCount>) => o as WaveCount;

describe("Wellen verständlich beschreiben", () => {
  it("Abwärts-Impuls 1-2: als Nächstes Welle 3 abwärts", () => {
    const w = c({ pattern: "impulse", complete: false, labels: ["1", "2"], direction: -1, bias: -1 });
    expect(nextWave(w)).toEqual({ label: "3", dir: -1 });
    expect(waveCaption(w)).toBe("Blacktrader zählt: Welle 1 abwärts, Welle 2 aufwärts – als Nächstes Welle 3 abwärts erwartet.");
  });
  it("Aufwärts-Impuls 1-4: als Nächstes Welle 5 aufwärts", () => {
    expect(nextWave(c({ pattern: "impulse", complete: false, labels: ["1", "2", "3", "4"], direction: 1, bias: 1 }))).toEqual({ label: "5", dir: 1 });
  });
  it("A-B: als Nächstes Welle C in Richtung A", () => {
    expect(waveCaption(c({ pattern: "zigzag", complete: false, labels: ["A", "B"], direction: -1, bias: -1 }))).toBe("Blacktrader zählt: A abwärts, B aufwärts – als Nächstes Welle C abwärts erwartet.");
  });
  it("abgeschlossener Impuls aufwärts: Korrektur abwärts", () => {
    expect(nextWave(c({ pattern: "impulse", complete: true, labels: ["1", "2", "3", "4", "5"], direction: 1, bias: -1 }))).toEqual({ label: "Korrektur", dir: -1 });
  });
});

describe("abgeschlossene Korrektur", () => {
  it("A-B-C abwärts beendet: als Nächstes neuer Anstieg", () => {
    const w = { pattern: "zigzag", complete: true, labels: ["A", "B", "C"], direction: -1, bias: 1 } as unknown as WaveCount;
    expect(waveCaption(w)).toBe("Blacktrader zählt: A abwärts, B aufwärts, C abwärts – als Nächstes neuer Anstieg erwartet.");
  });
});
