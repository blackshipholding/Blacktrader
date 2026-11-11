import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("News auf Deutsch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("erkennt deutsche und englische Titel", async () => {
    const { looksGerman } = await import("../src/lib/data/translate");
    expect(looksGerman("Apple-Aktie steigt nach starken Zahlen")).toBe(true);
    expect(looksGerman("Siemens hebt die Prognose für das Jahr an")).toBe(true);
    expect(looksGerman("Apple beats estimates as iPhone sales jump")).toBe(false);
    expect(looksGerman("Why Nvidia stock is rising today")).toBe(false);
  });

  it("liest das Antwortformat des Übersetzers", async () => {
    const { parseGtx } = await import("../src/lib/data/translate");
    expect(parseGtx([[["Apple übertrifft Erwartungen\n", "Apple beats estimates\n"], ["Aktie steigt", "Shares rise"]], null, "en"])).toBe("Apple übertrifft Erwartungen\nAktie steigt");
  });

  it("übersetzt englische Titel gebündelt und behält das Original", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      const q = decodeURIComponent(new URL(url).searchParams.get("q")!);
      const map: Record<string, string> = { "Apple beats estimates": "Apple übertrifft Erwartungen", "Shares surge to record": "Aktie steigt auf Rekord" };
      const lines = q.split("\n").map((l) => map[l] ?? l);
      return new Response(JSON.stringify([lines.map((l, i) => [l + (i < lines.length - 1 ? "\n" : ""), ""]), null, "en"]), { status: 200 });
    });
    const { translateTitles } = await import("../src/lib/data/translate");
    const r = await translateTitles(["Apple beats estimates", "Shares surge to record"]);
    expect(r).toEqual(["Apple übertrifft Erwartungen", "Aktie steigt auf Rekord"]);
    expect(calls).toHaveLength(1); // ein gebündelter Aufruf
    // zweiter Aufruf aus dem Zwischenspeicher
    await translateTitles(["Apple beats estimates"]);
    expect(calls).toHaveLength(1);
  });

  it("zeigt bei Ausfall das Original (null)", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }));
    const { translateTitles } = await import("../src/lib/data/translate");
    expect(await translateTitles(["Completely new headline here"])).toEqual([null]);
  });
});
