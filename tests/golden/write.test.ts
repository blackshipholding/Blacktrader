// Nur manuell ausführen (GOLDEN_WRITE=1), um den Fingerabdruck VOR einem Umbau festzuhalten.
import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { snapshot } from "./snapshot";

it.skipIf(!process.env.GOLDEN_WRITE)("Fingerabdruck schreiben", () => {
  fs.writeFileSync(path.join(__dirname, "analysis-golden.json"), JSON.stringify(snapshot(), null, 1));
});
