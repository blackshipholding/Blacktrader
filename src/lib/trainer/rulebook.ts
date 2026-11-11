// Regelwerk: wann Blacktrader in seiner Entscheidung etwas ändern darf (Anzeige auf /regelwerk, Werte aus dem Code).
import { LOCKED } from "../analysis/locked-config";
import { BLUE_RULE } from "../analysis/potential";
import { MIN_SIGNALS_VALID } from "./engine";
import { STEP_LIMIT } from "./moves";
import { LIVE_LEARN_MIN } from "./session";
import { RULES } from "./tournament";

export interface Rule {
  id: string;
  title: string;
  text: string;
}

const eur = (x: number) => `${x.toLocaleString("de-DE", { minimumFractionDigits: Number.isInteger(x) ? 0 : 2 })} €`;

/** A – was Blacktrader NIE selbst ändert (nur der Nutzer, nach Test und Rückfrage) */
export const RULES_A: Rule[] = [
  { id: "A1", title: "Elliott-Wellen mindestens 60 %", text: `Gewichtung: Elliott ≥ ${LOCKED.weightBounds.elliottMin} %, Fundamental/News ≥ ${LOCKED.weightBounds.fundamentalMin} %, Volumen/RSI ≥ ${LOCKED.weightBounds.volumeMin} %. Die Elliott-Grundregeln (Welle 2, 3, 4) sind fest.` },
  { id: "A2", title: "Risiko-Logik und Einsatz", text: `${eur(RULES.stake)} je Trade, Nachkauf nur bei Blau (höchstens ${RULES.addMax} × ${eur(RULES.addStake)}), eine Position je Wert, Stop und Ziel aus der Zone, Chance-Risiko mindestens ${LOCKED.minRiskReward}.` },
  { id: "A3", title: "Konto, Gebühren, Steuer", text: `Depot-Konto ${eur(RULES.start)}, ${eur(RULES.fee)} je Order (flatex), ${(RULES.tax * 100).toLocaleString("de-DE")} % KESt mit Verlustausgleich im Kalenderjahr.` },
  { id: "A4", title: "Feste Handelsregeln", text: `Sektor-Regel, Shorts nur im Bärenmarkt, ein Signal je Wert, grüne Box bis 1 % über dem Stop, Finanz-Filter (live), Blau-Regel ${BLUE_RULE.enabled ? "an" : "aus"}.` },
  { id: "A5", title: "Prüfregeln selbst", text: "Die Regeln B1–B7 und C1–C4 kann Blacktrader nicht lockern. Er lernt nicht aus deinen Käufen und Verkäufen." },
];

/** B – ein neuer Lern-Stand wird nur gespeichert, wenn ALLE Bedingungen erfüllt sind */
export const RULES_B: Rule[] = [
  { id: "B1", title: "Nur auf unbekannten Daten besser", text: "Alt gegen neu wird nur auf Daten verglichen, die beim Lernen nicht benutzt wurden: Die Zonen-Quote muss höher sein." },
  { id: "B2", title: "Kein Zufall", text: `Die Verbesserung muss mit 95 % Sicherheit echt sein, gemessen an mindestens ${MIN_SIGNALS_VALID} Zonen bzw. Signalen.` },
  { id: "B3", title: "Profit-Faktor nicht schlechter", text: "Gewinne im Verhältnis zu Verlusten dürfen nicht sinken." },
  { id: "B4", title: "Rückgang nicht schlechter", text: "Der größte zwischenzeitliche Verlust darf nicht größer werden." },
  { id: "B5", title: "Genug Signale", text: `Höchstens ${Math.round(LOCKED.acceptance.maxSignalDrop * 100)} % weniger Signale pro Monat; die Mindest-Signalstärke darf nur steigen.` },
  { id: "B6", title: "Beständig", text: "In mindestens drei von vier Prüfzeiträumen besser, nicht nur im Durchschnitt." },
  { id: "B7", title: "Turnier-Prüfung", text: `Mit dem neuen Stand spielt Blacktrader alle ${RULES.reps} Turnier-Zeiträume (${RULES.years} Jahre, ${eur(RULES.start)}, Gebühren, KESt) – er darf im Schnitt nicht schlechter sein und nie ausscheiden.` },
];

/** C – wie geändert wird */
export const RULES_C: Rule[] = [
  { id: "C1", title: "Kleine Schritte", text: `Je Speichern höchstens ${STEP_LIMIT.stepsPerKey} Lernschritte je Stellschraube, höchstens ${STEP_LIMIT.maxKeys} Stellschrauben auf einmal, Gewichtung höchstens ±${STEP_LIMIT.weightPoints} Punkte.` },
  { id: "C2", title: "Versionen mit Hinweis", text: "Jede gespeicherte Änderung bekommt eine neue Versionsnummer je Bereich; die App zeigt dir neue Versionen an, bis du sie als gesehen markierst." },
  { id: "C3", title: "Rückweg", text: "Jede Version kann auf die vorige zurückgesetzt werden. Warnt die Live-Kontrolle (Live schlechter als im Test), schlägt die App vor, die seit Beginn der Live-Bilanz gelernten Stände zurückzunehmen – du entscheidest." },
  { id: "C4", title: "Live-Prüfung", text: `Ab ${LIVE_LEARN_MIN} abgeschlossenen Ergebnissen der Live-Bilanz muss ein neuer Stand zusätzlich im Live-Zeitraum mindestens so gut sein.` },
];

/** Gegner im Turnier (fair): */
export const RULES_OPPONENTS: Rule[] = [
  { id: "G1", title: "Gleiche Bedingungen", text: `Alle 15 Gegner handeln mit ${eur(RULES.start)} Start, ${eur(RULES.stake)} je Trade, ${eur(RULES.fee)} Gebühr und KESt; wer kein Geld mehr hat, scheidet aus. Der S&P-500-ETF läuft nur zum Vergleich.` },
  { id: "G2", title: "Veränderliche Gegner", text: "Jeder Gegner hat faire Stellschrauben aus seiner veröffentlichten Methode. Vor jedem Turnier tritt sein Champion gegen neue Varianten an – der Beste spielt und bleibt Champion." },
  { id: "G3", title: "Nie gegen Blacktrader abgestimmt", text: "Ausgewählt wird auf eigenen Zeiträumen (3 Jahre, andere Startzeitpunkte) und nur nach dem eigenen Ergebnis. Die Auswertung zeigt, welche Variante gespielt hat." },
];
