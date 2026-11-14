// Regelwerk: wann Blacktrader in seiner Entscheidung etwas ändern darf (Anzeige auf /regelwerk, Werte aus dem Code).
import { shipLabel } from "../client/shipVersion";
import { LOCKED } from "../analysis/locked-config";
import { BLUE_RULE } from "../analysis/potential";
import { MIN_SIGNALS_VALID } from "./engine";
import { STEP_LIMIT } from "./moves";
import { LIVE_LEARN_MIN } from "./session";
import { RULES, TOURNEY_CAPS } from "./tournament";
import { HT_CAPS, HT_LOCK_YEARS, HT_MIN_GAIN } from "./hardtest";

export interface Rule {
  id: string;
  title: string;
  text: string;
}

const eur = (x: number) => `${x.toLocaleString("de-DE", { minimumFractionDigits: Number.isInteger(x) ? 0 : 2 })} €`;

/** A – was Blacktrader NIE selbst ändert (nur der Nutzer, nach Test und Rückfrage) */
export const RULES_A: Rule[] = [
  { id: "A1", title: "Elliott-Wellen mindestens 60 %", text: `Gewichtung: Elliott ≥ ${LOCKED.weightBounds.elliottMin} %, Fundamental/News ≥ ${LOCKED.weightBounds.fundamentalMin} %, Volumen/RSI ≥ ${LOCKED.weightBounds.volumeMin} %. Die Elliott-Grundregeln (Welle 2, 3, 4) sind fest.` },
  { id: "A2", title: `${shipLabel()}: Einsatz`, text: `1. Kauf ${RULES.first * 100} % vom Kontostand (Blau in 3 Teilen), Nachkauf nur bei Blau – höchstens ${RULES.addMax} × ${RULES.add * 100} %, erst wenn der Kurs die erste blaue Zone verlassen hat. Eine Position je Wert, Stop und Ziel aus der Zone, Chance-Risiko mindestens ${LOCKED.minRiskReward}.` },
  { id: "A2b", title: `${shipLabel()}: Gewinn-Schutz`, text: "Blauer Kauf, je Kauf einzeln: Steht der Kurs über der Oberkante der Zone (goldener Schnitt 61,8 %) und mindestens +20 % über deinem Ø Einstieg, schlägt Blacktrader einen Stop-Loss auf die Oberkante vor – wartende Teile werden gelöscht. Gebucht wird erst nach „Bei flatex erledigt“. Im Härtetest (realistisch gerechnet): 10,9 % statt 10,1 % p. a., 5,8 % statt 8,1 % Kunden mit Verlust; knapp bei hohen Kosten und Kurslücken. Der Stop startet immer auf der Oberkante und liegt nie darunter; Blacktrader darf im Training nur im engen Rahmen (Auslöser +15 bis +30 %, Nachziehen über 2–8 Wochenkerzen, Mindestschritt 3–10 %) lernen – geprüft einmal je fertiger Wochenkerze, übernommen nur nach bestandener Prüfung B8." },
  { id: "A3", title: "Konto, Gebühren, Steuer", text: `Startkapital trägst du im Depot ein (Standard ${eur(RULES.start)}, darunter handelt Blacktrader nicht), ${eur(RULES.fee)} je Order (flatex), ${(RULES.tax * 100).toLocaleString("de-DE")} % KESt mit Verlustausgleich im Kalenderjahr.` },
  { id: "A4", title: "Feste Handelsregeln", text: `Keine Shorts (rote Signale nur als Info im Bärenmarkt), Sektor-Regel, ein Signal je Wert, grüne Box bis 1 % über dem Stop, Finanz-Filter (live), Blau-Regel ${BLUE_RULE.enabled ? "an" : "aus"}.` },
  { id: "A5", title: "Prüfregeln selbst", text: "Die Regeln B1–B9 und C1–C4 kann Blacktrader nicht lockern. Er lernt nicht aus deinen Käufen und Verkäufen und nie die Geld-Regeln von " + shipLabel() + "." },
];

/** B – ein neuer Lern-Stand wird nur gespeichert, wenn ALLE Bedingungen erfüllt sind */
export const RULES_B: Rule[] = [
  { id: "B1", title: "Nur auf unbekannten Daten besser", text: "Alt gegen neu wird nur auf Daten verglichen, die beim Lernen nicht benutzt wurden: Die Zonen-Quote muss höher sein." },
  { id: "B2", title: "Kein Zufall", text: `Die Verbesserung muss mit 95 % Sicherheit echt sein, gemessen an mindestens ${MIN_SIGNALS_VALID} Zonen bzw. Signalen.` },
  { id: "B3", title: "Profit-Faktor nicht schlechter", text: "Gewinne im Verhältnis zu Verlusten dürfen nicht sinken." },
  { id: "B4", title: "Rückgang nicht schlechter", text: "Der größte zwischenzeitliche Verlust darf nicht größer werden." },
  { id: "B5", title: "Genug Signale", text: `Höchstens ${Math.round(LOCKED.acceptance.maxSignalDrop * 100)} % weniger Signale pro Monat; die Mindest-Signalstärke darf nur steigen.` },
  { id: "B6", title: "Beständig", text: "In mindestens drei von vier Prüfzeiträumen besser, nicht nur im Durchschnitt." },
  { id: "B7", title: "Turnier-Prüfung", text: `Mit dem neuen Stand spielt Blacktrader alle ${RULES.reps} Turnier-Zeiträume (${RULES.years} Jahre, je ${TOURNEY_CAPS.length} Depotgrößen ab ${eur(TOURNEY_CAPS[0])}, Regeln von ${shipLabel()}, Gebühren, KESt) – er darf im Schnitt nicht schlechter sein und nie öfter ausscheiden.` },
  { id: "B8", title: "Härtetest", text: `Rund 6.000 Kunden (jeder Wochen-Start × ${HT_CAPS.length} Depotgrößen von ${eur(HT_CAPS[0])} bis ${eur(HT_CAPS[HT_CAPS.length - 1])}, je ${RULES.years} Jahre). Der neue Stand muss netto mindestens +${(HT_MIN_GAIN * 100).toLocaleString("de-DE")} Punkte pro Jahr besser sein und alle Prüfungen bestehen: beide Zeithälften, bärische Zeiträume, nicht mehr Kunden mit Verlust, die schlechtesten 5 % nicht schlechter, Ausfall-Prüfung (5 × ohne 20 % der Werte, mind. 4 von 5), doppelte Gebühren und 0,5 % schlechtere Kurse. Gerechnet wird wie im echten Depot: nur gekaufte Teile bringen Gewinn, wartende Teile blockieren Geld, jede Order kostet ihre Gebühr, Grün und Blau zusammen. Die letzten ${HT_LOCK_YEARS} Jahre bleiben gesperrt – nur zur Schlusskontrolle.` },
  { id: "B9", title: "Gegner-Prüfung", text: "Gegen die 9 Gegner des Turniers (sie wechseln sich ab: TradingView-Bots, Bank-Analysten, bekannte Strategien und die stärksten aus dem Härtetest) darf der neue Stand in der Rangliste nicht abrutschen." },
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
  { id: "G1", title: "Gleiche Bedingungen", text: `Je Turnier treten 9 Gegner an, die sich abwechseln (aus 28: 9 TradingView-Bots, 5 Bots, 5 Bank-Analysten, 5 Strategien, 4 Stärkste aus dem Härtetest). Alle bekommen dasselbe Geld und dieselben Depotgrößen wie Blacktrader, ${eur(RULES.fee)} Gebühr und KESt; wer kein Geld mehr hat, scheidet aus. Der S&P-500-ETF läuft nur zum Vergleich.` },
  { id: "G2", title: "Veränderliche Gegner", text: "Jeder Gegner hat faire Stellschrauben aus seiner veröffentlichten Methode. Vor jedem Turnier tritt sein Champion gegen neue Varianten an – der Beste spielt und bleibt Champion." },
  { id: "G3", title: "Nie gegen Blacktrader abgestimmt", text: "Ausgewählt wird auf eigenen Zeiträumen (3 Jahre, andere Startzeitpunkte) und nur nach dem eigenen Ergebnis. Die Auswertung zeigt, welche Variante gespielt hat." },
];
