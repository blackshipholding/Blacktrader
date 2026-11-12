import { beforeEach, describe, expect, it } from "vitest";
import { collectLearnData, restoreLearnData } from "../src/lib/client/learnData";

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return mem.size;
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  } as Storage;
});

describe("Lerndaten sichern", () => {
  it("nimmt Trainer-/Lernschlüssel mit, aber nie Zugangsdaten", () => {
    mem.set("bsh-training-session", JSON.stringify({ status: "done" }));
    mem.set("bt-stop-params", JSON.stringify({ gain: 0.2 }));
    mem.set("bt-tournament-reports", JSON.stringify([{ id: 1 }]));
    mem.set("bsh-trainer-token", "geheim");
    mem.set("bt-autobackup-sig", "x");
    mem.set("andere", "1");
    const d = collectLearnData();
    expect(Object.keys(d).sort()).toEqual(["bsh-training-session", "bt-stop-params", "bt-tournament-reports"]);
    expect(d["bt-stop-params"]).toEqual({ gain: 0.2 });
  });
  it("spielt sie wieder ein, Fremdes und Zugangsdaten nicht", () => {
    const n = restoreLearnData({ "bt-stop-params": { gain: 0.25 }, "bsh-trainer-token": "böse", fremd: 1 });
    expect(n).toBe(1);
    expect(mem.get("bt-stop-params")).toBe('{"gain":0.25}');
    expect(mem.has("bsh-trainer-token")).toBe(false);
    expect(mem.has("fremd")).toBe(false);
  });
});
