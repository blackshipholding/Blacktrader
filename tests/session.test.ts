import { describe, expect, it } from "vitest";
import { checkpoint, newSession, runSession, type CellOutcome } from "../src/lib/trainer/session";
import { randomWalk } from "./golden/fixtures";

const data = new Map<string, ReturnType<typeof randomWalk>>();
const load = async (s: { symbol: string }) => {
  if (!data.has(s.symbol)) data.set(s.symbol, randomWalk(s.symbol.length * 7 + s.symbol.charCodeAt(0), 700));
  return data.get(s.symbol)!;
};

describe("Trainingssitzung", () => {
  it("hält die Dauer ein, wertet jeden Bereich aus und lässt sich fortsetzen", async () => {
    let t = 0;
    const now = () => (t += 5); // künstliche Uhr
    const cfg = { id: "x", durationMs: 4000, cells: ["commodity:medium" as const], baseVersion: 1, paramSet: {}, extra: [], baseParams: {} };
    const st = newSession(cfg);
    const done: CellOutcome[] = [];
    await runSession(st, { load, now, onProgress: () => {}, onCellDone: (o) => void done.push(o), shouldStop: () => false, chunkMs: 50 });
    expect(st.status).toBe("done");
    expect(done).toHaveLength(1);
    expect(st.elapsedMs).toBeLessThanOrEqual(cfg.durationMs + 200);
    // … und ein Prüfpunkt lässt sich speichern (ohne Backtest-Daten)
    const cp = checkpoint({ ...st, status: "running", cellIdx: 0, wf: null });
    expect(JSON.stringify(cp).length).toBeLessThan(200_000);
  }, 120_000);

  it("Turnier-Runden: Lernen pausiert bei der Rundengrenze und läuft danach weiter", async () => {
    let t = 0;
    const now = () => (t += 5);
    const cfg = { id: "r", durationMs: 4000, cells: ["commodity:medium" as const, "commodity:long" as const], baseVersion: 1, paramSet: {}, extra: [], baseParams: {} };
    const st = newSession(cfg);
    const done: CellOutcome[] = [];
    const io = { load, now, onProgress: () => {}, onCellDone: (o: CellOutcome) => void done.push(o), shouldStop: () => false, chunkMs: 50 };
    await runSession(st, { ...io, pauseAtMs: 100 });
    expect(st.status).toBe("running"); // nur pausiert
    expect(st.elapsedMs).toBeGreaterThanOrEqual(100);
    expect(st.elapsedMs).toBeLessThan(4000);
    await runSession(st, io); // nächste Runde: weiterlernen bis zum Ende
    expect(st.status).toBe("done");
    expect(done).toHaveLength(2);
  }, 120_000);

  it("Stopp wertet den laufenden Bereich noch aus", async () => {
    const cfg = { id: "y", durationMs: 3_600_000, cells: ["commodity:medium" as const, "commodity:long" as const], baseVersion: 1, paramSet: {}, extra: [], baseParams: {} };
    const st = newSession(cfg);
    const done: CellOutcome[] = [];
    let calls = 0;
    await runSession(st, { load, onProgress: () => {}, onCellDone: (o) => void done.push(o), shouldStop: () => ++calls > 2, chunkMs: 300 });
    expect(st.status).toBe("stopped");
    expect(done).toHaveLength(1);
    expect(done[0].reasons.length + (done[0].accept ? 1 : 0)).toBeGreaterThan(0);
  }, 120_000);
});

describe("Ohne Kursdaten", () => {
  it("meldet 'Keine Kursdaten' und schickt kein 0-%-Ergebnis", async () => {
    const st = newSession({ id: "z", durationMs: 60_000, cells: ["stock:long"], baseVersion: 1, paramSet: {}, extra: [], baseParams: {} });
    const done: CellOutcome[] = [];
    await runSession(st, { load: async () => null, onProgress: () => {}, onCellDone: (o) => void done.push(o), shouldStop: () => false });
    expect(done[0].base).toBeNull();
    expect(done[0].reasons[0]).toMatch(/Keine Kursdaten/);
  });
});
