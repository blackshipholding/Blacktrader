// Regelbasierte Texterzeugung im Stil des Blacktrader (Black Ship Holding):
// selbstbewusst im Ton, ehrlich in der Sache. Unsichere Setups werden als unsicher benannt.
import type { ElliottResult, WaveCount } from "./elliott";
import type { FundamentalResult } from "./fundamental";
import { SIGNAL_LABEL, type SignalDecision, type TradePlan } from "./score";
import type { VolumeRsiResult } from "./volume";
import type { NewsItem } from "../types";
import { toEur } from "../fx";

export interface Commentary {
  /** Kurzfassung in Alltagssprache, z. B. „Einstieg bei 12,50 € · Stop bei 10,00 €“ */
  summary: string;
  /** Risiko/Chance in einfachen Worten */
  risk: string;
  /** Ein-Satz-Begründung, z. B. „Einstieg in die Aktie, da sie einen lokalen Boden ausgebildet hat.“ */
  reason: string;
  headline: string;
  elliott: string;
  fundamental: string;
  volume: string;
  plan: string;
  invalidation: string;
  verdict: string;
}

function pick<T>(seed: string, options: T[]): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}

export function fmtPrice(x: number): string {
  const abs = Math.abs(x);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return x.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

const CURRENCY_SIGN: Record<string, string> = { EUR: "€", USD: "$", USDT: "$", USDC: "$", GBP: "£", GBp: "Pence", CHF: "CHF", JPY: "¥" };

/**
 * Preis in Euro, z. B. „12,50 €“. Werte in Dollar (oder anderer Währung) werden zum aktuellen Wechselkurs umgerechnet.
 * Ist (noch) kein Kurs bekannt, bleibt die Originalwährung stehen.
 */
export function money(x: number, currency?: string): string {
  if (currency && currency !== "EUR") {
    const eur = toEur(x, currency);
    if (eur != null) return `${fmtPrice(eur)} €`;
  }
  const sign = currency ? CURRENCY_SIGN[currency] ?? currency : "";
  return sign ? `${fmtPrice(x)} ${sign}` : fmtPrice(x);
}

export type AssetKindNoun = "stock" | "crypto" | "commodity";

/** Sehr kurze Setup-Beschreibung ohne Fachbegriffe (für Journal, Backtest, Listen). */
export function plainSetup(c: WaveCount | undefined): string {
  if (!c) return "Kein klares Bild";
  const up = c.bias === 1;
  const n = c.labels.length;
  if (c.pattern === "impulse" && !c.complete) {
    if (n === 2) return up ? "Boden gebildet – Anstieg startet" : "Hoch gebildet – Rückgang startet";
    if (n === 3) return up ? "Erholung nach starkem Fall" : "Pause nach starkem Anstieg";
    return up ? "Letzter Anstieg im Trend" : "Letzter Rückgang im Trend";
  }
  if (c.pattern === "impulse") return up ? "Abwärtstrend ausgelaufen" : "Aufwärtstrend ausgelaufen";
  if (c.pattern === "ending-diagonal") return up ? "Abwärtstrend erschöpft – Umkehr" : "Aufwärtstrend erschöpft – Umkehr";
  if (c.pattern === "leading-diagonal") return up ? "Gegenbewegung nach oben" : "Rücksetzer erwartet";
  if (c.pattern === "zigzag" && !c.complete) return up ? "Weiterer Anstieg erwartet" : "Weiterer Rückgang erwartet";
  if (c.pattern.startsWith("triangle")) return up ? "Ausbruch nach oben" : "Ausbruch nach unten";
  return up ? "Rücksetzer beendet – Boden gebildet" : "Erholung beendet – Hoch gebildet";
}

/** Einfacher Grund in Alltagssprache (ohne Wellen-Nummern oder Fachbegriffe). */
export function plainReason(c: WaveCount | undefined, it: string): string {
  if (!c) return `${it} zeigt kein klares Bild`;
  const up = c.bias === 1;
  const n = c.labels.length;
  if (c.pattern === "impulse" && !c.complete) {
    if (n === 2)
      return up
        ? `${it} nach einem Rücksetzer einen Boden gebildet hat und der Anstieg jetzt Fahrt aufnehmen dürfte`
        : `${it} nach einer Erholung ein Hoch gebildet hat und der Rückgang jetzt Fahrt aufnehmen dürfte`;
    if (n === 3) return up ? `${it} stark gefallen ist und eine Erholung wahrscheinlich ist` : `${it} stark gestiegen ist und eine Pause wahrscheinlich ist`;
    return up ? `die kurze Pause vorbei ist und noch ein letzter Anstieg folgen dürfte` : `die kurze Erholung vorbei ist und noch ein letzter Rückgang folgen dürfte`;
  }
  if (c.pattern === "impulse") return up ? `der Abwärtstrend ausgelaufen ist und ${it} einen Boden bildet` : `der Aufwärtstrend ausgelaufen ist und ein Rücksetzer wahrscheinlich ist`;
  if (c.pattern === "ending-diagonal") return up ? `der Abwärtstrend an Kraft verliert und eine Umkehr nach oben wahrscheinlich ist` : `der Aufwärtstrend an Kraft verliert und eine Umkehr nach unten wahrscheinlich ist`;
  if (c.pattern === "leading-diagonal") return up ? `nach dem ersten Rückgang eine Gegenbewegung nach oben fällig ist` : `nach dem ersten Anstieg ein Rücksetzer fällig ist`;
  if (c.pattern === "zigzag" && !c.complete) return up ? `nach dem kurzen Rücksetzer ein weiterer Anstieg wahrscheinlich ist` : `nach der kurzen Erholung ein weiterer Rückgang wahrscheinlich ist`;
  if (c.pattern.startsWith("triangle")) return up ? `die Seitwärtsphase vorbei ist und ein Ausbruch nach oben erwartet wird` : `die Seitwärtsphase vorbei ist und ein Ausbruch nach unten erwartet wird`;
  return up ? `der Rücksetzer beendet ist und ${it} einen Boden gebildet hat` : `die Erholung beendet ist und ${it} ein Hoch gebildet hat`;
}

const VETO_PLAIN: [RegExp, string][] = [
  [/Chance-Risiko/, "der mögliche Gewinn in keinem guten Verhältnis zum Risiko steht"],
  [/zu unsicher/, "das Chartbild noch zu unklar ist"],
  [/Alternative/, "der Kurs genauso gut in die andere Richtung laufen kann"],
  [/Kein sauberer Plan/, "sich keine sinnvolle Verlustgrenze festlegen lässt"],
  [/widerspricht/, "sich Chartbild und Gesamtbewertung widersprechen"],
  [/Gegen den übergeordneten Trend/, "der Einstieg gegen den großen Trend laufen würde"],
  [/Kein klarer übergeordneter Trend/, "es gerade keinen klaren großen Trend gibt"],
  [/Bestätigung/, "der Kurs die Richtung noch nicht bestätigt hat"],
  [/Keine Einstiegszone/, "gerade keine günstige Einstiegszone in Reichweite ist – der Kurs ist zu weit gelaufen oder die Korrektur zu tief"],
];

function shortCount(c: WaveCount): string {
  return `${c.patternLabel} ${c.direction === 1 ? "↑" : "↓"} (${c.degree}): ${c.phase} – ${pct(c.probability)}`;
}

export function writeCommentary(input: {
  symbol: string;
  name: string;
  price: number;
  elliott: ElliottResult;
  fundamental: FundamentalResult;
  volume: VolumeRsiResult;
  total: number;
  decision: SignalDecision;
  plan: TradePlan | null;
  news: NewsItem[];
  horizonLabel: string;
  kind?: AssetKindNoun;
  currency?: string;
}): Commentary {
  const { symbol, elliott, fundamental, volume, total, decision, plan } = input;
  const seed = `${symbol}${decision.level}`;
  const best = elliott.best;
  const label = SIGNAL_LABEL[decision.level];

  // --- Kurzfassung in Alltagssprache
  const noun = input.kind === "crypto" ? "den Coin" : input.kind === "commodity" ? "den Rohstoff" : "die Aktie";
  const it = input.kind === "crypto" ? "der Coin" : input.kind === "commodity" ? "der Preis" : "die Aktie";
  const pron = input.kind === "stock" || !input.kind ? "sie" : "er";
  const cur = input.currency;
  let summary: string;
  let reason: string;
  if (decision.level !== "neutral" && plan) {
    const t = plan.targets.slice(0, 2).map((x) => money(x, cur)).join(" bzw. ");
    summary =
      plan.direction === "long"
        ? `Einstieg bei ${money(plan.entry, cur)} · Stop bei ${money(plan.stop, cur)} · Ziel ${t}`
        : `Einstieg auf fallende Kurse bei ${money(plan.entry, cur)} · Stop bei ${money(plan.stop, cur)} · Ziel ${t}`;
    const why = plainReason(best, pron);
    reason = plan.direction === "long" ? `Einstieg in ${noun}, da ${why}.` : `Verkaufen bzw. auf fallende Kurse setzen, da ${why}.`;
    if (plan.orderType) {
      const up = plan.direction === "long";
      const zone = `${money(plan.zoneStart ?? plan.entry, cur)}–${money(plan.zoneEnd ?? plan.entry, cur)}`;
      if (plan.orderType === "limit") {
        summary = `${up ? "Kaufzone" : "Verkaufszone"} ${zone} · Einstieg bei ${money(plan.entry, cur)} · Stop bei ${money(plan.stop, cur)} · Ziel ${t}`;
        reason = up
          ? `Einstieg in ${noun}, sobald der Kurs auf ${money(plan.entry, cur)} zurückkommt: Der Aufwärtstrend ist intakt, und nach dem letzten Anstieg ist ein Rücksetzer in diese Zone typisch. Dort wird gekauft – nicht vorher.`
          : `Einstieg auf fallende Kurse, sobald der Kurs auf ${money(plan.entry, cur)} steigt: Der Abwärtstrend ist intakt, und nach dem letzten Rückgang ist eine Erholung in diese Zone typisch. Erst dort wird verkauft.`;
      } else {
        summary = `Einstieg bei ${money(plan.entry, cur)} · Stop bei ${money(plan.stop, cur)} · Ziel ${t}`;
        reason = up
          ? `Einstieg in ${noun}, da der Aufwärtstrend intakt ist und der Kurs jetzt in der Kaufzone (${zone}) nach dem Rücksetzer liegt.`
          : `Einstieg auf fallende Kurse, da der Abwärtstrend intakt ist und der Kurs jetzt in der Verkaufszone (${zone}) nach der Erholung liegt.`;
      }
    }
  } else {
    summary = "Kein Einstieg – abwarten";
    const veto = decision.vetoes.map((v) => VETO_PLAIN.find(([re]) => re.test(v))?.[1]).find(Boolean);
    const lean = best ? ` Tendenz: eher ${best.bias === 1 ? "aufwärts" : "abwärts"}.` : "";
    reason = veto ? `Noch nicht einsteigen, da ${veto}.${lean}` : `${it.charAt(0).toUpperCase() + it.slice(1)} zeigt gerade kein klares Signal.${lean}`;
  }

  let risk = "";
  if (plan) {
    const lossPct = (Math.abs(plan.entry - plan.stop) / plan.entry) * 100;
    const gainPct = (Math.abs(plan.targets[0] - plan.entry) / plan.entry) * 100;
    risk =
      plan.direction === "long"
        ? `Fällt der Kurs unter ${money(plan.stop, cur)}, wird verkauft – Verlust ca. ${lossPct.toFixed(1).replace(".", ",")} %. Möglicher Gewinn bis zum ersten Ziel: ca. ${gainPct.toFixed(1).replace(".", ",")} %.`
        : `Steigt der Kurs über ${money(plan.stop, cur)}, wird die Wette auf fallende Kurse beendet – Verlust ca. ${lossPct.toFixed(1).replace(".", ",")} %. Möglicher Gewinn bis zum ersten Ziel: ca. ${gainPct.toFixed(1).replace(".", ",")} %.`;
    if (plan.trailDistance) risk += ` Ab dem ersten Ziel wird der Stop auf den Einstieg gezogen und dem Kurs nachgezogen – Gewinne laufen lassen.`;
    if (plan.orderType === "limit" && plan.cancelAbove != null)
      risk += ` ${plan.direction === "long" ? "Steigt" : "Fällt"} der Kurs vorher ${plan.direction === "long" ? "über" : "unter"} ${money(plan.cancelAbove, cur)}, verfällt die Order.`;
    if (decision.level === "neutral") risk = "";
  }

  // --- Überschrift (kurz)
  let headline: string;
  if (decision.level === "neutral")
    headline =
      decision.vetoes.length && decision.rawLevel !== "neutral"
        ? `Kein Trade – ${decision.vetoes[0]}.`
        : pick(seed, ["Kein Trade. Unklares Bild.", "Neutral. Geduld ist die Position.", "Kein Trade. Ich spiele nicht."]);
  else if (decision.level.includes("buy"))
    headline = pick(seed, [`${label}. Setup mit Kante – long.`, `${label}. Struktur steht, ich gehe long.`]);
  else headline = pick(seed, [`${label}. Die Struktur kippt.`, `${label}. Kapital schützen.`]);

  // --- Elliott (1–2 Sätze)
  let ew = best ? shortCount(best) + "." : "Keine regelkonforme Zählung.";
  if (best && elliott.alternative) ew += ` Alt.: ${elliott.alternative.patternLabel} (${pct(elliott.alternative.probability)}).`;
  if (elliott.contested) ew += " Münzwurf – Alternative fast gleich stark.";
  else if (best && elliott.confidence < 0.35) ew += " Schwach belegt.";

  // --- Fundamental & News (1 Satz)
  const fParts: string[] = [];
  if (fundamental.fundamentalScore != null) {
    const top = [...fundamental.items].sort((a, b) => b.score - a.score);
    const strong = top[0]?.score >= 65 ? `+ ${top[0].name} ${top[0].value}` : "";
    const weak = top[top.length - 1]?.score < 45 ? `− ${top[top.length - 1].name} ${top[top.length - 1].value}` : "";
    fParts.push(`Score ${fundamental.fundamentalScore}${strong || weak ? ` (${[strong, weak].filter(Boolean).join(", ")})` : ""}.`);
  } else fParts.push("Keine Fundamentaldaten (neutral).");
  if (fundamental.newsScore != null) {
    const mood = fundamental.newsScore > 58 ? "freundlich" : fundamental.newsScore < 42 ? "belastet" : "gemischt";
    fParts.push(`News ${mood} (${fundamental.newsCount}).`);
  }
  if (fundamental.warnings.length) fParts.push(fundamental.warnings[0]);

  // --- Volumen & RSI (max. 2 Befunde)
  const vol = volume.findings.slice(0, 2).join(" ") || "Keine Volumen-/RSI-Daten.";

  // --- Plan
  const planText = plan
    ? `${plan.direction === "long" ? "Long" : "Short"} ${money(plan.entry, input.currency)} · Stop ${money(plan.stop, input.currency)} · Ziel ${plan.targets.slice(0, 2).map((x) => money(x, input.currency)).join(" / ")} · CRV ${plan.riskReward.toFixed(2).replace(".", ",")}`
    : "Kein Plan ohne definierten Stop.";

  const invalidation = best
    ? `${best.bias === 1 ? "Unter" : "Über"} ${money(best.stop, input.currency)} ist die Zählung falsch – dann raus.`
    : "Kein Invalidierungslevel.";

  const verdict =
    decision.level === "neutral"
      ? `${input.horizonLabel}: abwarten (${total.toFixed(0)}/100).`
      : `${input.horizonLabel}: ${label} (${total.toFixed(0)}/100), Konfidenz ${elliott.confidence > 0.6 ? "hoch" : "mittel"}.`;

  return { summary, reason, risk, headline, elliott: ew, fundamental: fParts.join(" "), volume: vol, plan: planText, invalidation, verdict };
}
