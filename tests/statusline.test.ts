import { describe, expect, it } from "vitest";
import { entryStatus, expectText } from "../src/components/StatusLine";

const down = { pattern: "zigzag", complete: true, labels: ["A", "B", "C"], direction: 1, bias: -1 } as never;
const up = { pattern: "impulse", complete: false, labels: ["1", "2"], direction: 1, bias: 1 } as never;

describe("Ein Satz je Farbe (ohne Wellennummern)", () => {
  it("Gelb", () => {
    expect(entryStatus({ color: "gelb", key: "g", reason: "" }, down, "EUR")).toEqual({ tone: "gelb", title: "Noch keine Handelsmöglichkeit gefunden.", text: "Als Nächstes könnte ein Rückgang kommen." });
  });
  it("Grün", () => {
    const s = entryStatus({ color: "gruen", key: "x", reason: "", zoneTop: 124, zoneBottom: 120 }, up, "EUR");
    expect(s.title).toBe("Handelsmöglichkeit gefunden: Kauf.");
    expect(s.text).toMatch(/^Einstieg 124,00 € bis 120,00 € – als Nächstes wird ein Anstieg erwartet\.$/);
  });
  it("Blau", () => {
    const s = entryStatus({ color: "blau", key: "b", reason: "", zoneTop: 76, zoneBottom: 60 }, undefined, "EUR");
    expect(s.title).toBe("Langfristiger Einstieg gefunden.");
    expect(s.text).toContain("erwartet: Rücksetzer in den Bereich, danach ein Anstieg.");
  });
  it("keine Wellennummern im Satz", () => {
    expect(expectText(up)).toBe("Als Nächstes wird ein Anstieg erwartet.");
  });
});

describe("Shipmaster-Betrag im Satz (nur Detailansicht)", () => {
  it("Grün und Blau nennen den Betrag, Gelb nicht", () => {
    const g = entryStatus({ color: "gruen", key: "x", reason: "", zoneTop: 124, zoneBottom: 120 }, undefined, "EUR", 1070.92);
    expect(g.text).toContain("Shipmaster: 1.071 €.");
    const y = entryStatus({ color: "gelb", key: "g", reason: "" }, undefined, "EUR", 1000);
    expect(y.text ?? "").not.toContain("Shipmaster");
  });
});
