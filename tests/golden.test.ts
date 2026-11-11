// Golden-Test: Mit Standardparametern muss die Analyse EXAKT dieselben Ergebnisse liefern wie vor dem Trainer-Umbau.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapshot } from "./golden/snapshot";

describe("Methode unverändert (Fingerabdruck vor dem Umbau)", () => {
  it("Scores, Signale, Einstieg/Stop/Ziel und EchoChart identisch", () => {
    const before = JSON.parse(fs.readFileSync(path.join(__dirname, "golden/analysis-golden.json"), "utf8"));
    expect(snapshot()).toEqual(before);
  });
});
