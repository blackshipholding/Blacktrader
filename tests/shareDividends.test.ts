import { describe, expect, it } from "vitest";
import { GET, POST } from "../src/app/api/share-dividends/route";

const code = "abcdefghijkmnpqrstuv2345";
const post = (b: unknown) => POST(new Request("http://x/api/share-dividends", { method: "POST", body: JSON.stringify(b) }));
const get = (c: string) => GET(new Request(`http://x/api/share-dividends?code=${c}`));

describe("Dividenden an Blacktime", () => {
  it("speichert und liefert nur mit dem richtigen Code", async () => {
    const rows = [{ name: "Muster", symbol: "X", date: "2025-01-02", shares: 5, gross: 10, net: 7.25, source: "auto" }, { name: "kaputt", symbol: "Y", date: "morgen", gross: 1, net: 1 }];
    expect((await post({ code, rows })).status).toBe(200);
    const r = await (await get(code)).json();
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].net).toBe(7.25);
    expect(r.rows[0].shares).toBe(5);
    expect((await get("zzzzzzzzzzzzzzzzzzzz")).status).toBe(404);
    expect((await get("kurz")).status).toBe(400);
  });
});
