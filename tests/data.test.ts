import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("Datenanbindung (offline)", () => {
  it("aggregiert 1h- zu 4h-Kerzen", async () => {
    const { aggregateCandles } = await import("../src/lib/data/aggregate");
    const c = Array.from({ length: 8 }, (_, i) => ({ time: i * 3600, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 10 }));
    const a = aggregateCandles(c, 4 * 3600);
    expect(a).toHaveLength(2);
    expect(a[0]).toEqual({ time: 0, open: 0, high: 4, low: -1, close: 3.5, volume: 40 });
  });

  it("parst Google-News-RSS inkl. Quelle", async () => {
    const { parseRss } = await import("../src/lib/data/news");
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Apple beats estimates - Reuters</title><link>https://x/1</link><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item>
      <item><title>Zweite Meldung - Handelsblatt</title><link>https://x/2</link><pubDate>Sun, 08 Nov 2026 09:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const items = parseRss(xml, "Google News");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Apple beats estimates", source: "Reuters", link: "https://x/1" });
    expect(items[1].source).toBe("Handelsblatt");
  });

  it("wählt sinnvolle Yahoo-Notierung aus OpenFIGI-Treffern", async () => {
    const { pickYahooSymbol } = await import("../src/lib/data/openfigi");
    const hits = [
      { ticker: "SAP", name: "SAP SE", exchCode: "US" },
      { ticker: "SAP", name: "SAP SE", exchCode: "GY" },
    ];
    expect(pickYahooSymbol("DE0007164600", hits)?.symbol).toBe("SAP.DE");
    expect(pickYahooSymbol("US0378331005", [{ ticker: "AAPL", name: "Apple", exchCode: "US" }])?.symbol).toBe("AAPL");
    expect(pickYahooSymbol("IE00B4L5Y983", [{ ticker: "EUNL", name: "iShares", exchCode: "GY" }])?.symbol).toBe("EUNL.DE");
  });

  it("Cache dedupliziert parallele Aufrufe", async () => {
    const { cached } = await import("../src/lib/data/http");
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    };
    const [a, b] = await Promise.all([cached("k", 1000, fn), cached("k", 1000, fn)]);
    expect([a, b, calls]).toEqual([42, 42, 1]);
    expect(await cached("k", 1000, fn)).toBe(42);
    expect(calls).toBe(1);
  });
});

describe("Suche nach Rohstoffen", () => {
  it("Gold, Silber, Öl werden als Rohstoff erkannt (nicht als Firma)", async () => {
    const { commodityFor } = await import("../src/lib/data/resolve");
    expect(commodityFor("Gold")?.symbol).toBe("GC=F");
    expect(commodityFor("silber")?.symbol).toBe("SI=F");
    expect(commodityFor("Öl")?.symbol).toBe("CL=F");
    expect(commodityFor("gc=f")?.name).toBe("Gold");
    expect(commodityFor("Goldman")).toBeUndefined();
  });
});
