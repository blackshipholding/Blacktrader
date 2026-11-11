// Härtetest – Schritt 2: Kunden, Konten, 20 Gegner, Auswertung.
// Ein Kunde = (Startzeitpunkt, Depotgröße). Das Ergebnis jeder Strategie hängt nur davon ab – daher wird jede Strategie
// für alle Startzeitpunkte (wöchentlich 1990–2021) × 40 Depotgrößen (1.000 € – 1.000.000 €) exakt gerechnet, und die
// 1.000.000 Kunden je Durchgang (100 Durchgänge) werden daraus gezogen.
// Regeln für alle: 7,90 € je Order, 27,5 % KESt sofort mit Verlusttopf im Kalenderjahr (KestYear aus der App),
// Signal am Tagesschluss → Ausführung frühestens zum nächsten Schlusskurs (Gegner); Blacktrader: Trades aus dem App-Code.
// Wer kein Geld mehr für eine Order hat und nichts hält, scheidet für den Durchgang aus.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { KestYear } from "/home/user/Blacktrader/src/lib/analysis/kest";
import { suppressedBy, type ActiveIntervals } from "/home/user/Blacktrader/src/lib/analysis/tradeRules";

const DIR = "/tmp/claude-0/-home-user-Blacktrader/4a846118-24a7-55aa-85de-daff0330394a/scratchpad/ht";
// Gegenproben (11.11.2026): STRESS=1 doppelte Gebühren + 0,5 % schlechtere Kurse; DROP=n ohne zufällige 20 % der Werte
const STRESS = !!process.env.STRESS;
const DROP = Number(process.env.DROP ?? 0);
const FEE = STRESS ? 2 * 7.9 : 7.9;
const TAX = 0.275;
const DAY = 86400;
const utc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 1000;

// ------------------------------------------------------------------------------------------------ Daten
const spxRaw = JSON.parse(readFileSync(`${DIR}/data/_SPX.json`, "utf8")) as number[][];
const CAL0 = utc("1988-01-01");
const spx = spxRaw.filter((c) => c[0] >= CAL0);
const cal = spx.map((c) => c[0]);
const N = cal.length;
const idxOf = new Map(cal.map((t, i) => [t, i]));
/** erster Kalendertag mit Zeit ≥ t */
function atOrAfter(t: number): number {
  let lo = 0, hi = N;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (cal[m] < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}
const spxClose = Float64Array.from(spx.map((c) => c[4]));

const meta = JSON.parse(readFileSync(`${DIR}/data/_meta.json`, "utf8")).meta as Record<string, unknown>;
const SYMS = Object.keys(meta).sort();
const S = SYMS.length;
const close: Float64Array[] = SYMS.map((s) => {
  const a = new Float64Array(N).fill(NaN);
  for (const c of JSON.parse(readFileSync(`${DIR}/data/${s}.json`, "utf8")) as number[][]) {
    const i = idxOf.get(c[0]);
    if (i != null) a[i] = c[4];
  }
  return a;
});
const sector: string[] = SYMS.map(() => "");
for (const line of readFileSync(`${DIR}/overview.csv`, "utf8").split("\n").slice(1)) {
  const m = line.match(/^([^,]+),(?:"[^"]*"|[^,]*),([^,]*),/);
  if (m) {
    const k = SYMS.indexOf(m[1]);
    if (k >= 0) sector[k] = m[2];
  }
}
/** letzter vorhandener Schlusskurs bis Tag i */
function lastClose(s: number, i: number): number {
  const a = close[s];
  for (let k = i; k >= 0 && k > i - 40; k--) if (a[k] === a[k]) return a[k];
  return NaN;
}

// ------------------------------------------------------------------------------------------------ Trades
interface Tr {
  s: number; // Aktie (−1 = Index)
  e: number; // Kalenderindex Einstieg
  x: number; // Kalenderindex Ausstieg (> Datenende = offen)
  pe: number; // Einstiegskurs
  px: number; // Ausstiegskurs
  zt?: number; // Oberkante der blauen Zone
  extraFee?: number; // zusätzliche Orders (Teilverkauf)
  short?: boolean;
  blue?: boolean;
  pos?: number; // gemeinsame Position (neues Blau: Erstkauf + Nachkäufe)
  leg?: number;
  prio?: number;
  color?: string;
  risk?: number;
  chance?: number;
}
const END = N - 1;
const priceIdx = (s: number, i: number) => (s < 0 ? spxClose[i] : lastClose(s, i));

// Blacktrader (aus gen.ts)
const btOld: Tr[] = [];
const btOldNoRule: Tr[] = [];
const btOldBelow: Tr[] = [];
const btNew: Tr[] = [];
const btNewNoRule: Tr[] = [];
let posId = 0;
const blueStats: { held: number; days: number; legs: number; why: string; ret: number }[] = [];
for (const f of readdirSync(`${DIR}/sig`)) {
  const d = JSON.parse(readFileSync(`${DIR}/sig/${f}`, "utf8"));
  const s = SYMS.indexOf(d.sym);
  if (s < 0 || d.err) continue;
  const iv = (a: number[][]) => a.map(([x, y]) => [x, y]);
  const oldActive: ActiveIntervals = { blau: d.oldBlue.map((t: { e: number; x: number }) => [t.e, t.x]), "1d": iv(d.z1d), "1w": iv(d.z1w) };
  const newActiveAll: ActiveIntervals = { blau: d.newBlue.map((p: { legs: { t: number }[]; exit: { t: number } | null }) => [p.legs[0].t, p.exit ? p.exit.t : 4e9]), "1d": iv(d.z1d), "1w": iv(d.z1w) };
  const newActive: ActiveIntervals = { ...newActiveAll, blau: d.newBlue.filter((p: { rule: boolean }) => p.rule).map((p: { legs: { t: number }[]; exit: { t: number } | null }) => [p.legs[0].t, p.exit ? p.exit.t : 4e9]) };
  const gr = (active: ActiveIntervals, out: Tr[]) => {
    for (const t of d.gr) {
      if (suppressedBy("stock", t.src, t.e, active)) continue;
      const e = atOrAfter(t.e);
      const x = atOrAfter(t.x);
      if (e >= N) continue;
      const px = t.short ? t.px * (1 - t.r / 100) : t.px * (1 + t.r / 100);
      out.push({ s, e, x: x >= N ? N + 1 : x, pe: t.px, px, short: t.short, color: t.color, risk: t.risk, chance: t.chance });
    }
  };
  // Alt: wie App-Turnier (Blau-Regel: ok)
  for (const t of d.oldBlue) {
    const e = atOrAfter(t.e);
    if (e >= N) continue;
    const tr: Tr = { s, e, x: t.open ? N + 1 : atOrAfter(t.x), pe: t.px, px: t.px * (1 + t.r / 100), blue: true, color: "blau", risk: t.risk, chance: t.chance, zt: t.zt };
    btOldNoRule.push(tr);
    if (t.ok) btOld.push({ ...tr });
    // C: Blau nur, wenn kein aktiver grüner Kauf-Bereich darunter liegt (Blau-Oberkante unter der grünen Unterkante)
    const greenBelow = [...d.z1d, ...d.z1w].some((z: number[]) => z[4] === 1 && z[0] <= t.e && t.e < z[1] && Math.min(z[2], z[3]) <= t.zt);
    if (!greenBelow) btOldBelow.push({ ...tr });
  }
  gr(oldActive, btOld);
  gr(oldActive, btOldNoRule);
  gr(oldActive, btOldBelow);
  // Neu: Positionen mit bis zu 3 Käufen
  for (const p of d.newBlue) {
    const id = posId++;
    const x = p.exit ? atOrAfter(p.exit.t) : N + 1;
    const exitPx = p.exit ? p.exit.px : NaN;
    p.legs.forEach((l: { t: number; px: number }, k: number) => {
      const tr: Tr = { s, e: atOrAfter(l.t), x, pe: l.px, px: exitPx, blue: true, pos: id, leg: k };
      if (tr.e >= N) return;
      btNewNoRule.push(tr);
      if (p.rule) btNew.push({ ...tr });
    });
    if (p.rule) {
      const e0 = atOrAfter(p.legs[0].t);
      const avg = p.legs.reduce((a: number, l: { px: number }) => a + l.px, 0) / p.legs.length;
      const xi = Math.min(x, END);
      const endPx = p.exit ? p.exit.px : priceIdx(s, END);
      blueStats.push({ held: 1, days: (cal[xi] - cal[Math.min(e0, END)]) / DAY, legs: p.legs.length, why: p.exit ? p.exit.why : "offen", ret: endPx / avg - 1 });
    }
  }
  gr(newActive, btNew);
  gr(newActiveAll, btNewNoRule);
}

// ------------------------------------------------------------------------------------------------ Gegner
const sma = (a: Float64Array, n: number) => {
  const o = new Float64Array(a.length).fill(NaN);
  let sum = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v !== v) { sum = 0; cnt = 0; continue; }
    sum += v; cnt++;
    if (cnt > n) sum -= a[i - n];
    if (cnt >= n) o[i] = sum / n;
  }
  return o;
};
const ema = (a: Float64Array, n: number) => {
  const o = new Float64Array(a.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v !== v) { prev = NaN; continue; }
    prev = prev !== prev ? v : v * k + prev * (1 - k);
    o[i] = prev;
  }
  return o;
};
function rollMax(a: Float64Array, n: number) {
  const o = new Float64Array(a.length).fill(NaN);
  for (let i = n; i < a.length; i++) {
    let m = -Infinity, ok = true;
    for (let k = i - n; k < i; k++) { const v = a[k]; if (v !== v) { ok = false; break; } if (v > m) m = v; }
    if (ok) o[i] = m;
  }
  return o;
}
function rollMin(a: Float64Array, n: number) {
  const o = new Float64Array(a.length).fill(NaN);
  for (let i = n; i < a.length; i++) {
    let m = Infinity, ok = true;
    for (let k = i - n; k < i; k++) { const v = a[k]; if (v !== v) { ok = false; break; } if (v < m) m = v; }
    if (ok) o[i] = m;
  }
  return o;
}
function rsi(a: Float64Array, n: number) {
  const o = new Float64Array(a.length).fill(NaN);
  let g = 0, l = 0, c = 0;
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    if (d !== d) { g = l = c = 0; continue; }
    c++;
    if (c <= n) { g += Math.max(d, 0) / n; l += Math.max(-d, 0) / n; }
    else { g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
    if (c >= n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
}
/** Regel je Aktie: enter(i)/exit(i) am Schluss von Tag i → Ausführung zum Schlusskurs am nächsten Tag (kein Blick voraus) */
function ruleTrades(s: number, enter: (i: number) => boolean, exit: (i: number, eIdx: number, peak: number) => boolean, prio = 0): Tr[] {
  const a = close[s];
  const out: Tr[] = [];
  let open = -1, pe = 0, peak = 0;
  for (let i = 260; i < N - 1; i++) {
    if (a[i] !== a[i]) continue;
    if (open < 0) {
      if (enter(i) && a[i + 1] === a[i + 1]) { open = i + 1; pe = a[i + 1]; peak = pe; i++; }
    } else {
      peak = Math.max(peak, a[i]);
      if (exit(i, open, peak) && a[i + 1] === a[i + 1]) { out.push({ s, e: open, x: i + 1, pe, px: a[i + 1], prio }); open = -1; i++; }
    }
  }
  if (open >= 0) out.push({ s, e: open, x: N + 1, pe, px: NaN, prio });
  return out;
}
/** Rangliste: zu jedem Monats-/Quartals-/Jahresanfang die besten k (score höher = besser), halten bis sie rausfallen.
 *  Rang = Priorität bei gleichzeitigen Käufen. Signal am Schluss von Tag i → Kauf/Verkauf zum Schlusskurs von Tag i+1. */
function rankTrades(score: (s: number, i: number) => number, k: number, every: "m" | "q" | "y", filter?: (s: number, i: number) => boolean): Tr[] {
  const out: Tr[] = [];
  const held = new Map<number, { e: number; pe: number; r: number }>();
  let lastKey = "";
  for (let i = 260; i < N - 1; i++) {
    const d = new Date(cal[i] * 1000);
    const key = every === "m" ? `${d.getUTCFullYear()}-${d.getUTCMonth()}` : every === "q" ? `${d.getUTCFullYear()}-${Math.floor(d.getUTCMonth() / 3)}` : `${d.getUTCFullYear()}`;
    if (key === lastKey) continue;
    lastKey = key;
    const cand: [number, number][] = [];
    for (let s = 0; s < S; s++) {
      if (close[s][i] !== close[s][i] || close[s][i + 1] !== close[s][i + 1]) continue;
      if (filter && !filter(s, i)) continue;
      const v = score(s, i);
      if (v === v) cand.push([s, v]);
    }
    cand.sort((x, y) => y[1] - x[1] || x[0] - y[0]);
    const top = new Map(cand.slice(0, k).map(([s], r) => [s, r]));
    for (const [s, h] of [...held]) {
      if (!top.has(s)) {
        out.push({ s, e: h.e, x: i + 1, pe: h.pe, px: lastClose(s, i + 1), prio: h.r });
        held.delete(s);
      }
    }
    for (const [s, r] of top) if (!held.has(s)) held.set(s, { e: i + 1, pe: close[s][i + 1], r });
  }
  for (const [s, h] of held) out.push({ s, e: h.e, x: N + 1, pe: h.pe, px: NaN, prio: h.r });
  return out;
}
/** Index-Zeitsteuerung: in(i) am Schluss → ganz rein/raus zum nächsten Schlusskurs */
function indexTiming(isIn: (i: number) => boolean): Tr[] {
  const out: Tr[] = [];
  let open = -1;
  for (let i = 260; i < N - 1; i++) {
    const want = isIn(i);
    if (open < 0 && want) open = i + 1;
    else if (open >= 0 && !want) { out.push({ s: -1, e: open, x: i + 1, pe: spxClose[open], px: spxClose[i + 1] }); open = -1; }
  }
  if (open >= 0) out.push({ s: -1, e: open, x: N + 1, pe: spxClose[open], px: NaN });
  return out;
}

const C = close;
let dayRegimeRef: Int8Array | null = null;
const dayRegimeAt = (i: number) => {
  if (!dayRegimeRef) {
    const m = sma(spxClose, 200);
    dayRegimeRef = new Int8Array(N);
    for (let k = 200; k < N; k++) { const r = spxClose[k] / spxClose[k - 100] - 1; dayRegimeRef[k] = spxClose[k] > m[k] && r > 0.05 ? 1 : spxClose[k] < m[k] && r < -0.05 ? -1 : 0; }
  }
  return i >= 0 ? dayRegimeRef[i] : 0;
};
const sma200 = C.map((a) => sma(a, 200));
const sma50 = C.map((a) => sma(a, 50));
const sma20 = C.map((a) => sma(a, 20));
const sma5 = C.map((a) => sma(a, 5));
const hi55 = C.map((a) => rollMax(a, 55));
const lo20 = C.map((a) => rollMin(a, 20));
const hi252 = C.map((a) => rollMax(a, 252));
const lo252 = C.map((a) => rollMin(a, 252));
const rsi2 = C.map((a) => rsi(a, 2));
const macd = C.map((a) => { const f = ema(a, 12), s = ema(a, 26); return f.map((v, i) => v - s[i]); });
const macdSig = macd.map((m) => ema(m, 9));
const sd20 = C.map((a, s) => { const o = new Float64Array(N).fill(NaN); for (let i = 20; i < N; i++) { const m = sma20[s][i]; if (m !== m) continue; let q = 0; for (let k = i - 19; k <= i; k++) q += (a[k] - m) ** 2; o[i] = Math.sqrt(q / 20); } return o; });
const ret = (s: number, i: number, n: number) => { const a = C[s][i], b = C[s][i - n]; return a === a && b === b && b > 0 ? a / b - 1 : NaN; };
const vol252 = (s: number, i: number) => { const a = C[s]; let m = 0, q = 0, n = 0; for (let k = i - 251; k <= i; k++) { const r = a[k] / a[k - 1] - 1; if (r !== r) return NaN; m += r; q += r * r; n++; } m /= n; return Math.sqrt(q / n - m * m); };

// Zufall reproduzierbar
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const spx200 = sma(spxClose, 200);
const spxHi252 = rollMax(spxClose, 252);
const monthOf = (i: number) => new Date(cal[i] * 1000).getUTCMonth();

type Sizing = "ship" | "btP" | "btNew" | "btNk" | "btNkMinCash" | "btOld" | "btOldMin" | "btOldCash" | "btOldMinCash" | "slots10" | "allIn" | "sparplan" | "buyHold";
interface ShipP { first: number; add: number; max: number; green?: number; crvSize?: boolean; sectorMax?: number; equity?: boolean }
interface Strat { id: string; name: string; group: string; sizing: Sizing; trades: Tr[]; stateful?: boolean; interest?: number; p?: { first: number; add: number; max: number; mc: boolean }; sp?: ShipP }
const strategies: Strat[] = [];
// stateful: Strategie beschreibt einen Zustand (Rangliste, Index drin/draußen) → Kunde übernimmt beim Start, was sie gerade hält
const STATEFUL = new Set(["momentum", "hi52", "lowvol", "bluechip", "sector", "may", "blood", "jan", "trendIdx"]);
const add = (id: string, name: string, group: string, sizing: Sizing, trades: Tr[]) => strategies.push({ id, name, group, sizing, trades, stateful: STATEFUL.has(id), interest: id === "v_int" ? 0.02 : 0 });
const per = (f: (s: number) => Tr[]) => { const o: Tr[] = []; for (let s = 0; s < S; s++) o.push(...f(s)); return o; };

add("bt_new", "Blacktrader – neue Regeln (6 % + 2 × 2 %, Blau ohne Verlust-Verkauf)", "Blacktrader", "btNew", btNew);
add("bt_new_nr", "Blacktrader – neue Regeln, ohne Blau-Regel", "Blacktrader", "btNew", btNewNoRule);
add("bt_old", "Blacktrader – bisherige Regeln (1/16 + 4 Nachkäufe, App-Turnier)", "Blacktrader", "btOld", btOld);
add("bt_old_nr", "Blacktrader – bisherige Regeln, ohne Blau-Regel", "Blacktrader", "btOld", btOldNoRule);
// Varianten auf Basis „alt ohne Blau-Regel“
const momOk = (t: Tr) => { const e = t.e - 1; if (e < 253 || t.s < 0) return false; const a = C[t.s][e], b = C[t.s][e - 252]; return a === a && b === b && b > 0 && a / b > spxClose[e] / spxClose[e - 252]; };
add("v_below", "C: Blau nur unter Grün", "Varianten", "btOld", btOldBelow);
add("v_min", "D: Mindestorder 1.000 €", "Varianten", "btOldMin", btOldNoRule);
add("v_cash", "E: Geld arbeiten lassen (Kauf = max(1/16 Start, 1/8 freies Geld))", "Varianten", "btOldCash", btOldNoRule);
add("v_mom", "F: nur starke Aktien (12 Monate besser als S&P 500)", "Varianten", "btOld", btOldNoRule.filter(momOk));
add("v_int", "G: 2 % Zinsen auf freies Geld", "Varianten", "btOld", btOldNoRule);
add("v_combo", "H: D + E + F", "Varianten", "btOldMinCash", btOldNoRule.filter(momOk));
add("v_de", "I: D + E (ohne Momentum-Filter)", "Varianten", "btOldMinCash", btOldNoRule);
// Neuer Nachkauf (höchstens 2, nach oben oder unten, kein Verlust-Verkauf, Ziel = höchstes) mit bisheriger Kaufgröße 1/16 + 1/32
add("nk_rule", "J: neuer Nachkauf + Blau-Regel (Kauf 1/16, Nachkauf 1/32)", "Varianten", "btNk", btNew);
add("nk_nr", "K: neuer Nachkauf ohne Blau-Regel (Kauf 1/16, Nachkauf 1/32)", "Varianten", "btNk", btNewNoRule);
add("nk_rule_dE", "L: J + Mindestorder 1.000 € + Geld arbeiten lassen", "Varianten", "btNkMinCash", btNew);
for (const [f, a, mx] of [[16, 32, 4], [16, 32, 2], [16, 48, 2], [12, 32, 2], [12, 48, 2], [10, 32, 2], [10, 48, 2], [8, 32, 2], [8, 48, 2]] as const)
  for (const mc of [false, true]) {
    const id = `p_${f}_${a}_${mx}${mc ? "_mc" : ""}`;
    add(id, `1. Kauf 1/${f}, Nachkauf ${mx} × 1/${a}${mc ? " + Mindestorder + Geld arbeiten" : ""} (ohne Blau-Regel)`, "Größen", "btP", btOldNoRule);
    strategies[strategies.length - 1].p = { first: 1 / f, add: 1 / a, max: mx, mc };
  }
// ---- Shipmaster und Herausforderer
const crv = (t: Tr) => (t.chance != null && t.risk ? t.chance / Math.max(0.5, t.risk) : NaN);
const regimeBefore = (t: Tr) => dayRegimeAt(t.e - 1);
const SHIP: ShipP = { first: 0.1, add: 0.02, max: 2 };
const ship = (id: string, name: string, trades: Tr[], sp: Partial<ShipP> = {}) => { add(id, name, "Shipmaster", "ship", trades); strategies[strategies.length - 1].sp = { ...SHIP, ...sp }; };
ship("S0", "Shipmaster (10 % + 2 × 2 %, ohne Blau-Regel)", btOldNoRule);
ship("S1", "S1: ohne Shorts", btOldNoRule.filter((t) => !t.short));
ship("S2", "S2: Grün nur, wenn der Markt nicht bärisch ist", btOldNoRule.filter((t) => t.color !== "gruen" || regimeBefore(t) !== -1));
ship("S3", "S3: nur Blau", btOldNoRule.filter((t) => t.blue));
ship("S4", "S4: Blau 10 %, Grün/Rot 5 %", btOldNoRule, { green: 0.05 });
ship("S5", "S5: Größe nach Chance/Risiko (10 % ab 3, sonst 5 %)", btOldNoRule, { crvSize: true });
ship("S6", "S6: nur Chance/Risiko ab 2", btOldNoRule.filter((t) => !(crv(t) < 2)));
ship("S7", "S7: höchstens 3 Positionen je Branche", btOldNoRule, { sectorMax: 3 });
ship("S8", "S8: Zinseszins (10 % vom aktuellen Kontostand)", btOldNoRule, { equity: true });
ship("S9", "S9: ohne Shorts + Zinseszins (S1 + S8)", btOldNoRule.filter((t) => !t.short), { equity: true });
// Gewinn-Schutz Blau (Nutzer-Frage 11.11.2026): Kurs über der Oberkante und mind. +gain über Ø Einstieg → Stop
// (ab dem nächsten Tag) auf die Oberkante (lvl "top") bzw. den Ø Einstieg (lvl "avg"); nur Schlusskurse vorhanden →
// Stop greift beim ersten Schlusskurs auf/unter der Stop-Linie, Verkauf zu diesem Schlusskurs.
function trail(t: Tr, gain: number, lvl: "top" | "avg", base: "avg" | "top" = "avg"): Tr {
  if (!t.blue || t.zt == null) return t;
  const stop = lvl === "top" ? t.zt : t.pe;
  const a = close[t.s];
  let on = false;
  const last = Math.min(t.x, END + 1);
  for (let i = t.e + 1; i < last; i++) {
    const c = a[i];
    if (c !== c) continue;
    if (on && c <= stop) return { ...t, x: i, px: c };
    if (!on && c >= (base === "top" ? t.zt : t.pe) * (1 + gain) && c > t.zt) on = true;
  }
  return t;
}
const s9base = btOldNoRule.filter((t) => !t.short);
const trailed = (g: number, l: "top" | "avg", base: "avg" | "top" = "avg") => s9base.map((t) => trail(t, g, l, base)).sort((a, b) => a.e - b.e);
ship("S15", "S15: S9 + Stop auf Oberkante ab +20 %", trailed(0.2, "top"), { equity: true });
ship("S21", "S21: S9 + Stop auf Oberkante ab +20 % über der Oberkante", trailed(0.2, "top", "top"), { equity: true });
ship("S16", "S16: S9 + Stop auf Oberkante ab +10 %", trailed(0.1, "top"), { equity: true });
ship("S17", "S17: S9 + Stop auf Oberkante ab +30 %", trailed(0.3, "top"), { equity: true });
ship("S18", "S18: S9 + Stop auf Ø Einstieg ab +20 %", trailed(0.2, "avg"), { equity: true });
// Nutzer-Varianten (11.11.2026): bei +g über Ø Einstieg (egal ob über der Oberkante) 10 % der Position verkaufen
// (eigene Order, eigene Gebühr) und Stop für den Rest auf den Ø Einstieg. Gerechnet als ein Trade mit Misch-Ausstieg.
function partial(t: Tr, g: number, share = 0.1): Tr {
  if (!t.blue) return t;
  const a = close[t.s];
  const last = Math.min(t.x, END + 1);
  let r1: number | null = null;
  for (let i = t.e + 1; i < last; i++) {
    const c = a[i];
    if (c !== c) continue;
    if (r1 != null && c <= t.pe) return { ...t, x: i, px: t.pe * (1 + share * r1 + (1 - share) * (c / t.pe - 1)), extraFee: 1 };
    if (r1 == null && c >= t.pe * (1 + g)) r1 = c / t.pe - 1;
  }
  if (r1 == null || t.px !== t.px) return t;
  return { ...t, px: t.pe * (1 + share * r1 + (1 - share) * (t.px / t.pe - 1)), extraFee: 1 };
}
const parted = (g: number) => s9base.map((t) => partial(t, g)).sort((a, b) => a.e - b.e);
ship("S19", "S19: S9 + bei +10 % 10 % verkaufen, Stop auf Ø Einstieg", parted(0.1), { equity: true });
ship("S20", "S20: S9 + bei +20 % 10 % verkaufen, Stop auf Ø Einstieg", parted(0.2), { equity: true });
// Momentum und RSI zusätzlich (nur Daten bis zum Vortag des Kaufs)
const rsi14 = C.map((a) => rsi(a, 14));
const rsiOk = (t: Tr) => { const v = rsi14[t.s]?.[t.e - 1]; return !(v > 70); };
const rsiLow = (t: Tr) => { const v = rsi14[t.s]?.[t.e - 1]; return !(v > 50); };
const mom6 = (t: Tr) => { const e = t.e - 1; if (e < 130 || t.s < 0) return false; const a = C[t.s][e], b = C[t.s][e - 126]; return a === a && b === b && b > 0 && a / b > spxClose[e] / spxClose[e - 126]; };
const s9 = btOldNoRule.filter((t) => !t.short);
ship("S10", "S10: S9 + Momentum (12 Monate besser als S&P 500)", s9.filter(momOk), { equity: true });
ship("S11", "S11: S9 + Momentum (6 Monate besser als S&P 500)", s9.filter(mom6), { equity: true });
ship("S12", "S12: S9 + RSI-Filter (nicht kaufen, wenn RSI über 70)", s9.filter(rsiOk), { equity: true });
ship("S13", "S13: S9 + RSI-Filter streng (nur kaufen, wenn RSI unter 50)", s9.filter(rsiLow), { equity: true });
ship("S14", "S14: S9 + Momentum 12 Monate nur für Grün", s9.filter((t) => t.blue || momOk(t)), { equity: true });
add("nk_nr_dE", "M: K + Mindestorder 1.000 € + Geld arbeiten lassen", "Varianten", "btNkMinCash", btNewNoRule);
console.error("Blacktrader:", btNew.length, btNewNoRule.length, btOld.length, "Trades");

// ETF
add("etf", "S&P 500 kaufen & halten (Index, ohne Dividenden)", "ETF", "buyHold", [{ s: -1, e: 0, x: N + 1, pe: 1, px: NaN }]);
add("sparplan", "ETF-Sparplan monatlich (Index)", "ETF", "sparplan", []);
// Bots (Aktien, 10 Plätze à 10 %)
const rTr: Tr[] = [];
for (let s = 0; s < S; s++) for (let i = 260; i < N - 21; i++) if (C[s][i + 1] === C[s][i + 1] && C[s][i + 21] === C[s][i + 21] && rnd() < 0.0008) rTr.push({ s, e: i + 1, x: i + 21, pe: C[s][i + 1], px: C[s][i + 21] });
add("random", "Zufalls-Bot (hält 20 Tage)", "Bots", "slots10", rTr);
add("trend200", "Trendfolger (200-Tage-Linie)", "Bots", "slots10", per((s) => ruleTrades(s, (i) => C[s][i] > sma200[s][i] && C[s][i - 1] <= sma200[s][i - 1], (i) => C[s][i] < sma200[s][i])));
add("golden", "Golden Cross (50/200)", "Bots", "slots10", per((s) => ruleTrades(s, (i) => sma50[s][i] > sma200[s][i] && sma50[s][i - 1] <= sma200[s][i - 1], (i) => sma50[s][i] < sma200[s][i])));
add("macd", "MACD-Bot (12/26/9)", "Bots", "slots10", per((s) => ruleTrades(s, (i) => macd[s][i] > macdSig[s][i] && macd[s][i - 1] <= macdSig[s][i - 1] && C[s][i] > sma200[s][i], (i) => macd[s][i] < macdSig[s][i])));
add("turtle", "Ausbruchs-Bot (Turtle 55/20)", "Bots", "slots10", per((s) => ruleTrades(s, (i) => C[s][i] > hi55[s][i], (i) => C[s][i] < lo20[s][i])));
add("bollinger", "Bollinger-Bot (Rücksetzer an das untere Band)", "Bots", "slots10", per((s) => ruleTrades(s, (i) => C[s][i] < sma20[s][i] - 2 * sd20[s][i], (i) => C[s][i] > sma20[s][i])));
add("momentum", "Momentum (12 Monate, monatlich Top 10)", "Bots", "slots10", rankTrades((s, i) => (C[s][i - 21] === C[s][i - 21] ? ret(s, i - 21, 231) : NaN), 10, "m"));
add("hi52", "52-Wochen-Hoch (monatlich Top 10)", "Bots", "slots10", rankTrades((s, i) => C[s][i] / hi252[s][i], 10, "m"));
add("connors", "Connors RSI-2", "Bots", "slots10", per((s) => ruleTrades(s, (i) => C[s][i] > sma200[s][i] && rsi2[s][i] < 10, (i) => C[s][i] > sma5[s][i])));
add("lowvol", "Niedrige Schwankung (vierteljährlich Top 10)", "Bots", "slots10", rankTrades((s, i) => -vol252(s, i), 10, "q"));
// Börsenweisheiten
add("may", "„Sell in May and go away“ (Index Nov–Apr)", "Börsenweisheiten", "allIn", indexTiming((i) => { const m = monthOf(i); return m >= 10 || m <= 3; }));
add("blood", "„Kaufen, wenn Blut auf den Straßen fließt“ (Index −20 % → bis Rekordhoch)", "Börsenweisheiten", "allIn", (() => { let inn = false; return indexTiming((i) => { if (!inn && spxClose[i] <= 0.8 * spxHi252[i]) inn = true; else if (inn && spxClose[i] >= spxHi252[i]) inn = false; return inn; }); })());
add("letrun", "„Gewinne laufen lassen, Verluste begrenzen“ (Trend + 10 % Nachlauf-Stop)", "Börsenweisheiten", "slots10", per((s) => ruleTrades(s, (i) => C[s][i] > sma200[s][i] && C[s][i] >= hi55[s][i], (i, _e, peak) => C[s][i] < peak * 0.9)));
add("knife", "„Greif nie ins fallende Messer“ (erst +20 % vom Tief, über 50-Tage-Linie)", "Börsenweisheiten", "slots10", per((s) => ruleTrades(s, (i) => C[s][i] >= lo252[s][i] * 1.2 && C[s][i] > sma50[s][i] && C[s][i - 1] <= sma50[s][i - 1] && C[s][i] < hi252[s][i] * 0.8, (i) => C[s][i] < sma50[s][i])));
add("jan", "Januar-Barometer (Index Feb–Dez nur nach positivem Januar)", "Börsenweisheiten", "allIn", (() => { let ok = false, janStart = NaN; return indexTiming((i) => { const m = monthOf(i), pm = monthOf(i - 1); if (m === 0 && pm !== 0) janStart = spxClose[i - 1]; if (m === 1 && pm === 0) ok = spxClose[i - 1] > janStart; return m !== 0 && ok; }); })());
add("trendIdx", "„The trend is your friend“ (Index über 200-Tage-Linie)", "Börsenweisheiten", "allIn", indexTiming((i) => spxClose[i] > spx200[i]));
// Analysten-Stil
add("bluechip", "Blue-Chip-Korb (10 älteste Werte, jährlich neu)", "Analysten-Stil", "slots10", rankTrades((s, i) => { let k = i; while (k > 0 && C[s][k - 1] === C[s][k - 1]) k--; return i - k; }, 10, "y"));
add("sector", "Sektor-Rotation (stärkster Sektor, Top 10 darin, monatlich)", "Analysten-Stil", "slots10", (() => {
  // Sektor mit der besten Durchschnittsrendite über 6 Monate; daraus die 10 stärksten Werte
  const best = new Map<string, string>();
  return rankTrades((s, i) => {
    const key = String(i);
    if (!best.has(key)) {
      const agg = new Map<string, [number, number]>();
      for (let q = 0; q < S; q++) { const r = ret(q, i, 126); if (r === r && sector[q]) { const v = agg.get(sector[q]) ?? [0, 0]; v[0] += r; v[1]++; agg.set(sector[q], v); } }
      let bs = "", bv = -Infinity;
      for (const [k, [sum, n]] of agg) if (n >= 3 && sum / n > bv) { bv = sum / n; bs = k; }
      best.set(key, bs);
    }
    return sector[s] === best.get(key) ? ret(s, i, 126) : NaN;
  }, 10, "m");
})());
for (const st of strategies) st.trades.sort((a, b) => a.e - b.e || (a.prio ?? 0) - (b.prio ?? 0) || a.s - b.s || (a.leg ?? 0) - (b.leg ?? 0));
console.error("Gegner:", strategies.length - 3, strategies.map((s) => `${s.id}:${s.trades.length}`).join(" "));

// ------------------------------------------------------------------------------------------------ Konto
const CAPS = Array.from({ length: 40 }, (_, k) => Math.round(1000 * Math.pow(1000, k / 39)));
const yearOf = (i: number) => new Date(cal[Math.min(i, END)] * 1000).getUTCFullYear();
interface Res { end: number; broke: boolean; fees: number; tax: number; n: number; low: number }

function exitValue(t: Tr, w1: number): { at: number; px: number } {
  const sl = STRESS ? (t.short ? 1.005 : 0.995) : 1;
  if (t.x <= w1 && t.px === t.px) return { at: t.x, px: t.px * sl };
  return { at: w1, px: priceIdx(t.s, w1) * sl };
}
function gain(t: Tr, stake: number, px: number) {
  const r = t.short ? 1 - px / t.pe : px / t.pe - 1;
  return stake * (r === r ? r : 0);
}

function simulate(st: Strat, ev: { t: Tr; ex: { at: number; px: number } }[], w0: number, w1: number, cap: number): Res {
  const kest = new KestYear(TAX);
  let cash = cap, fees = 0, tax = 0, n = 0, low = cap, broke = false;
  if (st.sizing === "buyHold" || st.sizing === "sparplan") {
    // ETF: Index-Anteile; Sparplan: 60 gleiche Monatsraten
    let units = 0, cost = 0;
    if (st.sizing === "buyHold") {
      const inv = cap - FEE; units = inv / spxClose[w0]; cost = inv; cash = 0; fees += FEE; n = 1;
    } else {
      const rate = cap / 60;
      let m = -1;
      for (let i = w0; i < w1 && n < 60; i++) {
        const mo = monthOf(i);
        if (mo !== m) { m = mo; if (cash >= rate) { const inv = rate - FEE; if (inv > 0) { units += inv / spxClose[i]; cost += inv; } cash -= rate; fees += FEE; n++; } }
      }
    }
    const val = units * spxClose[w1];
    const g = val - cost;
    const k = kest.settle(g, yearOf(w1));
    cash += val - FEE - k; fees += FEE; tax += k;
    return { end: cash, broke: cash <= 0, fees, tax, n, low: Math.min(low, cash) };
  }
  const open = new Map<Tr, number>();
  const posOpen = new Map<number, boolean>(); // neues Blau: Position aktiv (Erstkauf gekauft)
  const symOpen = new Int32Array(S + 1);
  const minStake = st.sizing === "ship" ? st.sp!.add * cap : st.sizing === "btP" ? (st.p!.mc ? Math.max(st.p!.add * cap, 1000) : st.p!.add * cap) : st.sizing === "btNk" ? cap / 32 : st.sizing === "btNkMinCash" ? Math.max(cap / 32, 1000) : st.sizing === "btNew" ? Math.min(0.02 * cap, 1000) : st.sizing === "btOld" || st.sizing === "btOldCash" ? cap / 32 : st.sizing === "btOldMin" || st.sizing === "btOldMinCash" ? Math.max(cap / 32, 1000) : st.sizing === "slots10" ? cap / 10 : FEE * 2;
  // G: Zinsen auf freies Geld (täglich verzinst bis zum nächsten Ereignis, KESt 27,5 % sofort)
  let lastDay = w0;
  const accrue = (day: number) => {
    if (st.interest && cash > 0 && day > lastDay) {
      const z = cash * (Math.pow(1 + st.interest, (cal[Math.min(day, END)] - cal[lastDay]) / (365 * DAY)) - 1);
      cash += z * (1 - TAX); tax += z * TAX;
    }
    lastDay = Math.max(lastDay, day);
  };
  // Ereignisse: Ausstiege vor Einstiegen am selben Tag
  let ei = 0;
  // Min-Heap nach Ausstiegstag
  type Ex = { at: number; t: Tr; px: number };
  const heap: Ex[] = [];
  const hpush = (x: Ex) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].at <= heap[i].at) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const hpop = (): Ex => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].at < heap[m].at) m = l; if (r < heap.length && heap[r].at < heap[m].at) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  let invested = 0;
  const sectorOpen = new Map<string, number>();
  const doExit = (o: { at: number; t: Tr; px: number }) => {
    const stake = open.get(o.t);
    if (stake == null) return;
    const g = gain(o.t, stake, o.px);
    const ef = (o.t.extraFee ?? 0) * FEE;
    cash += stake + g - FEE - ef; fees += FEE + ef;
    const k = kest.settle(g, yearOf(o.at));
    cash -= k; tax += k;
    open.delete(o.t);
    invested -= stake;
    symOpen[o.t.s + 1]--;
    if (symOpen[o.t.s + 1] === 0 && o.t.s >= 0) sectorOpen.set(sector[o.t.s], (sectorOpen.get(sector[o.t.s]) ?? 1) - 1);
    if (o.t.pos != null && symOpen[o.t.s + 1] === 0) posOpen.delete(o.t.pos);
  };
  for (; ei < ev.length; ei++) {
    const { t, ex } = ev[ei];
    // fällige Ausstiege bis einschließlich Tag t.e (vor dem Einstieg)
    while (heap.length && heap[0].at <= t.e) { const o = hpop(); accrue(o.at); doExit(o); }
    accrue(t.e);
    if (broke) continue;
    let stake = 0;
    const have = symOpen[t.s + 1];
    switch (st.sizing) {
      case "ship": {
        const p = st.sp!;
        if (have > 0 && (!t.blue || have > p.max)) continue;
        if (have === 0 && p.sectorMax && t.s >= 0 && (sectorOpen.get(sector[t.s]) ?? 0) >= p.sectorMax) continue;
        const base = p.equity ? cash + invested : cap;
        let f = have > 0 ? p.add : t.blue || p.green == null ? p.first : p.green;
        if (have === 0 && p.crvSize && !(crv(t) >= 3)) f = p.first / 2;
        stake = f * base;
        break;
      }
      case "btP": {
        const p = st.p!;
        if (have > 0 && (!t.blue || have > p.max)) continue;
        stake = have > 0 ? (p.mc ? Math.max(p.add * cap, cash * p.add * 2, 1000) : p.add * cap) : p.mc ? Math.max(p.first * cap, cash * p.first * 2, 1000) : p.first * cap;
        break;
      }
      case "btNk":
      case "btNkMinCash": {
        const mc = st.sizing === "btNkMinCash";
        const first = mc ? Math.max(cap / 16, cash / 8, 1000) : cap / 16;
        const more = mc ? Math.max(cap / 32, cash / 16, 1000) : cap / 32;
        if (t.pos != null) {
          if (t.leg === 0) { if (have > 0) continue; stake = first; }
          else { if (!posOpen.get(t.pos)) continue; stake = more; }
        } else { if (have > 0) continue; stake = first; }
        break;
      }
      case "btNew":
        if (t.pos != null) {
          if (t.leg === 0) { if (have > 0) continue; stake = Math.min(0.06 * cap, 3000); }
          else { if (!posOpen.get(t.pos)) continue; stake = Math.min(0.02 * cap, 1000); }
        } else { if (have > 0) continue; stake = Math.min(0.06 * cap, 3000); }
        break;
      case "btOld":
        if (have > 0 && (!t.blue || have > 4)) continue;
        stake = have > 0 ? cap / 32 : cap / 16;
        break;
      case "btOldMin":
        if (have > 0 && (!t.blue || have > 4)) continue;
        stake = Math.max(have > 0 ? cap / 32 : cap / 16, 1000);
        break;
      case "btOldCash":
        if (have > 0 && (!t.blue || have > 4)) continue;
        stake = have > 0 ? Math.max(cap / 32, cash / 16) : Math.max(cap / 16, cash / 8);
        break;
      case "btOldMinCash":
        if (have > 0 && (!t.blue || have > 4)) continue;
        stake = Math.max(have > 0 ? Math.max(cap / 32, cash / 16) : Math.max(cap / 16, cash / 8), 1000);
        break;
      case "slots10":
        if (have > 0) continue;
        stake = cap / 10;
        break;
      case "allIn":
        if (have > 0) continue;
        stake = cash - FEE;
        if (stake <= 0) continue;
        break;
    }
    if (cash < stake + FEE) {
      if (open.size === 0 && cash < minStake + FEE) broke = true;
      continue;
    }
    cash -= stake + FEE; fees += FEE; n++;
    open.set(t, stake);
    if (symOpen[t.s + 1] === 0 && t.s >= 0) sectorOpen.set(sector[t.s], (sectorOpen.get(sector[t.s]) ?? 0) + 1);
    symOpen[t.s + 1]++;
    if (t.pos != null && t.leg === 0) posOpen.set(t.pos, true);
    hpush({ at: ex.at, t, px: ex.px });
    invested += stake;
    low = Math.min(low, cash + invested);
  }
  while (heap.length) { const o = hpop(); accrue(o.at); doExit(o); }
  accrue(w1);
  return { end: cash, broke: broke || cash < minStake + FEE, fees, tax, n, low: Math.min(low, cash) };
}

// ------------------------------------------------------------------------------------------------ Zeiträume
const START0 = atOrAfter(utc("1990-01-01"));
const LAST_START = atOrAfter(utc("2021-11-10"));
const STARTS: number[] = [];
const QUICK = !!process.env.QUICK;
for (let i = START0; i <= LAST_START; i += QUICK ? 60 : 5) STARTS.push(i);
const endOf = (w0: number) => { const d = new Date(cal[w0] * 1000); d.setUTCFullYear(d.getUTCFullYear() + 5); return Math.min(atOrAfter(d.getTime() / 1000), END); };

// Marktlage wie im App-Turnier: Anteil Bären-/Bullentage (S&P 500 vs. 200-Tage-Linie und 100-Tage-Trend)
const dayRegime = new Int8Array(N);
for (let i = 200; i < N; i++) { const m = spx200[i], r = spxClose[i] / spxClose[i - 100] - 1; dayRegime[i] = spxClose[i] > m && r > 0.05 ? 1 : spxClose[i] < m && r < -0.05 ? -1 : 0; }
function scenarioOf(w0: number, w1: number) {
  let bull = 0, bear = 0;
  for (let i = w0; i <= w1; i++) { if (dayRegime[i] === 1) bull++; else if (dayRegime[i] === -1) bear++; }
  const n = w1 - w0 + 1;
  return bear / n >= 0.15 ? "bärisch" : bull / n >= 0.55 ? "bullisch" : bull / n < 0.45 ? "normal" : "gemischt";
}
const CRISES: [string, string, string][] = [
  ["Golfkrieg/Irak 1990", "1990-07-16", "1990-10-11"], ["Asienkrise 1997", "1997-07-01", "1997-12-31"], ["Russland/LTCM 1998", "1998-07-17", "1998-10-08"],
  ["Dotcom-Blase 2000–02", "2000-03-24", "2002-10-09"], ["11. September 2001", "2001-09-11", "2001-09-21"], ["Irakkrieg 2003", "2003-03-20", "2003-05-01"],
  ["Bankenkrise 2007–09", "2007-10-09", "2009-03-09"], ["Griechenland/Euro 2010–12", "2010-04-23", "2012-07-26"], ["China/Öl 2015–16", "2015-08-11", "2016-02-11"],
  ["Zinsangst 2018", "2018-10-03", "2018-12-24"], ["Corona 2020", "2020-02-19", "2020-03-23"], ["Zinsschock/Ukraine 2022", "2022-01-03", "2022-10-12"],
  ["KI-Boom 2023–26", "2023-01-01", "2026-11-10"],
];
const crisisIdx = CRISES.map(([name, a, b]) => ({ name, a: atOrAfter(utc(a)), b: atOrAfter(utc(b)) }));
const ELECTION = new Set([1992, 1996, 2000, 2004, 2008, 2012, 2016, 2020]);
const win = STARTS.map((w0) => {
  const w1 = endOf(w0);
  return { w0, w1, scen: scenarioOf(w0, w1), crises: crisisIdx.filter((c) => c.a >= w0 && c.a < w1).map((c) => c.name), election: ELECTION.has(yearOf(w0)) };
});

// ------------------------------------------------------------------------------------------------ Rechnen
const W = STARTS.length, K = CAPS.length;
const out: Record<string, { end: Float64Array; broke: Uint8Array; fees: Float64Array; tax: Float64Array; n: Uint16Array; low: Float64Array }> = {};
const t0 = Date.now();
const PART = process.env.PART?.split("/").map(Number);
const AGG = !!process.env.AGG;
const tag = QUICK ? "q" : STRESS ? "st" : DROP ? `d${DROP}` : "f";
const dropped = (sym: string, seed: number) => { let h = 2166136261 ^ seed; for (let i = 0; i < sym.length; i++) h = Math.imul(h ^ sym.charCodeAt(i), 16777619); return ((h >>> 0) % 100) < 20; };
for (const [si, st] of strategies.entries()) {
  if (AGG) {
    const j = JSON.parse(readFileSync(`${DIR}/cells/${tag}_${st.id}.json`, "utf8"));
    out[st.id] = { end: Float64Array.from(j.end), broke: Uint8Array.from(j.broke), fees: Float64Array.from(j.fees), tax: Float64Array.from(j.tax), n: Uint16Array.from(j.n), low: Float64Array.from(j.low) };
    continue;
  }
  if (PART && si % PART[1] !== PART[0]) continue;
  if (process.env.ONLY && !process.env.ONLY.split(",").includes(st.id)) continue;
  if (DROP) st.trades = st.trades.filter((t) => t.s < 0 || !dropped(SYMS[t.s], DROP));
  if (STRESS) st.trades = st.trades.map((t) => ({ ...t, pe: t.short ? t.pe * 0.995 : t.pe * 1.005 }));
  const R = { end: new Float64Array(W * K), broke: new Uint8Array(W * K), fees: new Float64Array(W * K), tax: new Float64Array(W * K), n: new Uint16Array(W * K), low: new Float64Array(W * K) };
  // Einstiege je Zeitraum über binäre Suche
  const es = st.trades.map((t) => t.e);
  const lb = (v: number) => { let lo = 0, hi = es.length; while (lo < hi) { const m = (lo + hi) >> 1; if (es[m] < v) lo = m + 1; else hi = m; } return lo; };
  for (let w = 0; w < W; w++) {
    const { w0, w1 } = win[w];
    const ev: { t: Tr; ex: { at: number; px: number } }[] = [];
    if (st.stateful) {
      // beim Start gehaltene Werte zum Schlusskurs des Starttags übernehmen
      for (let k = 0; k < es.length && es[k] < w0; k++) {
        const t = st.trades[k];
        if (t.x > w0) { const pe = priceIdx(t.s, w0); if (pe === pe) { const c: Tr = { ...t, e: w0, pe }; ev.push({ t: c, ex: exitValue(c, w1) }); } }
      }
    }
    for (let k = lb(w0); k < es.length && es[k] < w1; k++) { const t = st.trades[k]; ev.push({ t, ex: exitValue(t, w1) }); }
    for (let c = 0; c < K; c++) {
      const r = simulate(st, ev, w0, w1, CAPS[c]);
      const j = w * K + c;
      R.end[j] = r.end; R.broke[j] = r.broke ? 1 : 0; R.fees[j] = r.fees; R.tax[j] = r.tax; R.n[j] = Math.min(65535, r.n); R.low[j] = r.low;
    }
  }
  out[st.id] = R;
  mkdirSync(`${DIR}/cells`, { recursive: true });
  writeFileSync(`${DIR}/cells/${tag}_${st.id}.json`, JSON.stringify({ end: [...R.end], broke: [...R.broke], fees: [...R.fees], tax: [...R.tax], n: [...R.n], low: [...R.low] }));
  console.error(`${st.id} fertig (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

// ------------------------------------------------------------------------------------------------ Kunden: 1.000.000 je Durchgang, 100 Durchgänge
if (!AGG) process.exit(0);
const REPS = QUICK ? 2 : 100, CUST = QUICK ? 20_000 : 1_000_000;
const capIdx = (v: number) => Math.max(0, Math.min(K - 1, Math.round((Math.log(v / 1000) / Math.log(1000)) * 39)));
let s2 = 987654321;
const rnd2 = () => ((s2 = (Math.imul(s2, 1664525) + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd2() + 1e-12)) * Math.cos(2 * Math.PI * rnd2());
const cagr = (end: number, cap: number) => (end > 0 ? Math.pow(end / cap, 1 / 5) - 1 : -1);
const ids = strategies.map((s) => s.id);
// Rendite pro Jahr je Zelle vorausberechnen
const G: Record<string, Float64Array> = Object.fromEntries(ids.map((id) => [id, Float64Array.from({ length: W * K }, (_, j) => cagr(out[id].end[j], CAPS[j % K]))]));
type Agg = { sum: number; n: number; loss: number; broke: number; worst: number; best: number; feeShare: number; taxShare: number; trades: number };
const blank = (): Agg => ({ sum: 0, n: 0, loss: 0, broke: 0, worst: Infinity, best: -Infinity, feeShare: 0, taxShare: 0, trades: 0 });
const capBucket = (v: number) => (v < 5000 ? "1–5 Tsd. €" : v < 20000 ? "5–20 Tsd. €" : v < 100000 ? "20–100 Tsd. €" : "100 Tsd.–1 Mio. €");
const cellKeys = (w: number) => [win[w].scen, ...win[w].crises, ...(win[w].election ? ["Start im US-Wahljahr"] : []), yearOf(win[w].w0) < 2006 ? "Start 1990–2005" : "Start 2006–2021"];
const repMeans: Record<string, number[]> = Object.fromEntries(ids.map((i) => [i, []]));
const total: Record<string, Agg> = Object.fromEntries(ids.map((i) => [i, blank()]));
const byCap: Record<string, Record<string, Agg>> = Object.fromEntries(ids.map((i) => [i, {}]));
const byScen: Record<string, Record<string, Agg>> = Object.fromEntries(ids.map((i) => [i, {}]));
const beats: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
const capDist = new Float64Array(K);
const add2 = (a: Agg, id: string, j: number, m: number) => {
  const g = G[id][j], R = out[id], cap = CAPS[j % K];
  a.sum += g * m; a.n += m; if (g < 0) a.loss += m; if (R.broke[j]) a.broke += m;
  if (g < a.worst) a.worst = g; if (g > a.best) a.best = g;
  a.feeShare += (R.fees[j] / cap) * m; a.taxShare += (R.tax[j] / cap) * m; a.trades += R.n[j] * m;
};
for (let rep = 0; rep < REPS; rep++) {
  // 1.000.000 Kunden ziehen: Depotgröße logarithmisch (Mitte ~15.000 €, 1.000 € – 1 Mio. €), Start zufällig 1990–2021
  const cnt = new Uint32Array(W * K);
  for (let c = 0; c < CUST; c++) {
    const capV = Math.min(1e6, Math.max(1000, 15000 * Math.exp(1.2 * gauss())));
    const k = capIdx(capV), w = Math.floor(rnd2() * W);
    cnt[w * K + k]++;
    capDist[k]++;
  }
  for (const id of ids) {
    let rs = 0;
    for (let j = 0; j < W * K; j++) {
      const m = cnt[j];
      if (!m) continue;
      rs += G[id][j] * m;
      add2(total[id], id, j, m);
      add2((byCap[id][capBucket(CAPS[j % K])] ??= blank()), id, j, m);
      for (const sk of cellKeys(Math.floor(j / K))) add2((byScen[id][sk] ??= blank()), id, j, m);
      if (id !== "bt_new" && G.bt_new[j] > G[id][j]) beats[id] += m;
    }
    repMeans[id].push(rs / CUST);
  }
  if (rep % 10 === 9) console.error(`Durchgang ${rep + 1}/${REPS}`);
}
const fmt = (a: Agg) => ({ avg: a.sum / a.n, lossShare: a.loss / a.n, brokeShare: a.broke / a.n, worst: a.worst, best: a.best, feeShare: a.feeShare / a.n, taxShare: a.taxShare / a.n, trades: a.trades / a.n, n: a.n });
const result = {
  windows: W, caps: CAPS, customers: CUST, reps: REPS, capDist: [...capDist].map((x) => x / (REPS * CUST)),
  scenarioCounts: Object.fromEntries(["bullisch", "bärisch", "normal", "gemischt"].map((s) => [s, win.filter((w) => w.scen === s).length])),
  strategies: strategies.map((s) => ({ id: s.id, name: s.name, group: s.group, trades: s.trades.length, total: fmt(total[s.id]), repMin: Math.min(...repMeans[s.id]), repMax: Math.max(...repMeans[s.id]), byCap: Object.fromEntries(Object.entries(byCap[s.id]).map(([k, v]) => [k, fmt(v)])), byScen: Object.fromEntries(Object.entries(byScen[s.id]).map(([k, v]) => [k, fmt(v)])), btBeats: s.id === "bt_new" ? null : beats[s.id] / (REPS * CUST) })),
  blue: (() => {
    const b = blueStats;
    const neg = b.filter((x) => x.ret < 0);
    const open = b.filter((x) => x.why === "offen");
    return { positions: b.length, ziel: b.filter((x) => x.why === "ziel").length, stop: b.filter((x) => x.why === "stop").length, offen: open.length, offenImMinus: open.filter((x) => x.ret < 0).length, avgDays: b.reduce((a, x) => a + x.days, 0) / b.length, avgDaysLoss: neg.length ? neg.reduce((a, x) => a + x.days, 0) / neg.length : 0, legs: [1, 2, 3].map((l) => b.filter((x) => x.legs === l).length), worstOpen: open.length ? Math.min(...open.map((x) => x.ret)) : 0, closedLoss: b.filter((x) => x.why !== "offen" && x.ret < 0).length };
  })(),
  secs: (Date.now() - t0) / 1000,
};
writeFileSync(`${DIR}/${QUICK ? "result_quick" : "result"}.json`, JSON.stringify(result, null, 1));
console.error("fertig", result.secs, "s");
