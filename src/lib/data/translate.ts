// Automatische Übersetzung von Schlagzeilen ins Deutsche (kostenlos, ohne Schlüssel).
// Primär: Google-Übersetzer-Endpunkt (client=gtx), Ersatz: MyMemory. Ergebnisse werden zwischengespeichert.
import "server-only";
import { cached, fetchJson } from "./http";

const DE_WORDS = ["der", "die", "das", "und", "mit", "für", "nicht", "ist", "auf", "im", "zu", "den", "von", "ein", "eine", "aktie", "nach", "bei", "über", "wie", "noch", "auch", "sich", "des", "dem", "wird"];
const EN_WORDS = ["the", "and", "of", "to", "in", "for", "on", "with", "is", "as", "after", "its", "by", "at", "from", "stock", "shares", "says", "will", "are", "be", "how", "why"];

/** Grobe Spracherkennung für kurze Titel. */
export function looksGerman(text: string): boolean {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\s]/gu, " ")} `;
  if (/[äöüß]/.test(t)) return true;
  const count = (ws: string[]) => ws.reduce((n, w) => n + (t.includes(` ${w} `) ? 1 : 0), 0);
  return count(DE_WORDS) > count(EN_WORDS);
}

/** Antwort des gtx-Endpunkts: [[["übersetzt", "original", …], …], …] */
export function parseGtx(data: unknown): string {
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("Unerwartetes Format");
  return (data[0] as unknown[][]).map((seg) => (typeof seg?.[0] === "string" ? seg[0] : "")).join("");
}

async function gtx(text: string): Promise<string> {
  const data = await fetchJson<unknown>(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=de&dt=t&q=${encodeURIComponent(text)}`, { timeoutMs: 8000 });
  return parseGtx(data);
}

async function myMemory(text: string): Promise<string> {
  const r = await fetchJson<{ responseData?: { translatedText?: string }; responseStatus?: number }>(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|de`,
    { timeoutMs: 8000 },
  );
  const t = r.responseData?.translatedText;
  if (!t || r.responseStatus !== 200) throw new Error("MyMemory: keine Übersetzung");
  return t;
}

/** Übersetzt mehrere Titel; Ergebnis je Titel oder null (dann Original anzeigen). */
export async function translateTitles(titles: string[]): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(titles.length).fill(null);
  // Bereits übersetzte aus dem Zwischenspeicher, Rest gebündelt (eine Zeile je Titel)
  const todo: number[] = [];
  await Promise.all(
    titles.map(async (t, i) => {
      try {
        out[i] = await cached(`tr:${t}`, 7 * 86400e3, async () => {
          throw new Error("miss");
        });
      } catch {
        todo.push(i);
      }
    }),
  );
  // Pakete bis ca. 1800 Zeichen (URL-Länge)
  const batches: number[][] = [];
  let cur: number[] = [];
  let len = 0;
  for (const i of todo.sort((a, b) => a - b)) {
    const l = encodeURIComponent(titles[i]).length + 3;
    if (cur.length && len + l > 1800) {
      batches.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(i);
    len += l;
  }
  if (cur.length) batches.push(cur);
  for (const b of batches) {
    let lines: string[] | null = null;
    try {
      lines = (await gtx(b.map((i) => titles[i]).join("\n"))).split("\n").map((s) => s.trim());
      if (lines.length !== b.length) lines = null;
    } catch {
      lines = null;
    }
    for (let k = 0; k < b.length; k++) {
      const i = b[k];
      let t = lines?.[k] || null;
      if (!t) {
        try {
          t = await myMemory(titles[i]);
        } catch {
          t = null;
        }
      }
      if (t) {
        out[i] = t;
        const tt = t;
        await cached(`tr:${titles[i]}`, 7 * 86400e3, async () => tt);
      }
    }
  }
  return out;
}
