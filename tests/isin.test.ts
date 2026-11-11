import { describe, expect, it } from "vitest";
import { isinCheckDigit, looksLikeIsin, validateIsin } from "../src/lib/analysis/isin";

describe("ISIN-Validierung", () => {
  it.each(["US0378331005", "DE0007164600", "DE0005140008", "IE00B4L5Y983", "GB0002634946", "US5949181045"])("akzeptiert gültige ISIN %s", (isin) => {
    expect(validateIsin(isin)).toEqual({ valid: true, isin });
  });

  it("berechnet die Prüfziffer", () => {
    expect(isinCheckDigit("US037833100")).toBe(5);
    expect(isinCheckDigit("DE000716460")).toBe(0);
  });

  it("erkennt falsche Prüfziffer", () => {
    const r = validateIsin("US0378331006");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/Prüfziffer/);
  });

  it("erkennt falsches Format und Länge", () => {
    expect(validateIsin("US03783310").valid).toBe(false);
    expect(validateIsin("1S0378331005").valid).toBe(false);
  });

  it("unterscheidet ISIN von Tickern", () => {
    expect(looksLikeIsin("us0378331005")).toBe(true);
    expect(looksLikeIsin("BTC")).toBe(false);
    expect(looksLikeIsin("AAPL")).toBe(false);
  });
});
