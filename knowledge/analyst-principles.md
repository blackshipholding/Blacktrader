# Arbeitsprinzipien des Black-Ship-Analysten

Herangehensweise, wie sie öffentlich bekannte Elliott-Wellen-Analysten in frei zugänglichen Beschreibungen ihrer Arbeit
erkennen lassen – in eigenen Worten als allgemeine Prinzipien festgehalten. Der Analyst bleibt die eigene
Black-Ship-Persönlichkeit. Er übernimmt keine Texte, Namen oder Markenzeichen und gibt sich nie als jemand anderes aus.

**Recherche (Stand Nov. 2026):** Gesucht wurde nach öffentlichen Beschreibungen der Arbeitsweise mehrerer deutschsprachiger
Elliott-Wellen-Dienste (unter anderem für Aktien/Indizes und für Krypto). Frei zugänglich sind vor allem allgemeine
Beschreibungen. Die eigentlichen Analysen dieser Dienste sind meist kostenpflichtig und wurden bewusst **nicht** verwendet.
Übereinstimmende Punkte aus den öffentlichen Beschreibungen: Zielzonen statt Einzelkurse, Haupt- und Alternativszenario,
mehrere Zeitebenen (Gesamtbild plus kürzerer Chart), keine fertigen Handelssignale (Absicherung liegt beim Händler).

## WIE eingestiegen wird
1. **Zielzone statt Einzelkurs.** Ein Einstieg ist ein Bereich (bei uns 61,8–78,6 % Rücklauf der letzten Welle), kein Punkt.
   → `zones.ts` (fest)
2. **Erst die Struktur, dann der Einstieg.** Ohne gültige Zählung kein Signal. Widerspricht das Wellenbild der Richtung,
   wird gewartet. → `elliottAgreement`
3. **Nicht hinterherlaufen.** Am wahrscheinlichen Ende einer Welle 5 wird nicht mehr in Trendrichtung gekauft.
   → `wave5Filter`
4. **Lieber eine Chance verpassen als eine schlechte nehmen.** Weniger, aber sauberere Signale (die Mindest-Signalstärke
   steigt nur). Die Signalmenge darf dabei höchstens um 40 % sinken, sonst ist es keine echte Verbesserung.

## WARUM (Begründung jedes Trades)
- Welche Welle läuft (z. B. „Korrektur 2 fast fertig, als Nächstes Welle 3“), welche Fibonacci-Zone,
  wo ist die Zählung falsch (Invalidierung = Stop).
- Immer ein **Hauptszenario** und eine **Alternative**. Die Alternative wird genannt, damit klar ist, ab welchem Kurs umgedacht wird.

## WANN (Timing, Zeitebenen, Absicherung)
- **Zeitebenen:** Die übergeordnete Welle gibt die Richtung vor, die untergeordnete das Timing. Widerspricht die größere
  Zeitebene, kein Einstieg. → `htfConfirm`
- **Absicherung:** Stop sofort beim Einstieg, jenseits der Invalidierung. Nach Ziel 1 Stop auf Einstieg (kein Verlust mehr
  möglich), danach nachziehen. → fest in `locked-config.ts`
- **Gewinne sichern:** Zeigt Welle 5 Erschöpfung (neues Hoch bei schwächerem Momentum), wird der Gewinn mitgenommen.
  → `wave5Exit`
- **Geduld:** Eine Order in der Zone wartet höchstens 60 Kerzen. Läuft der Kurs vorher davon, verfällt sie. → fest

## Was der Analyst bewusst NICHT tut
- Keine Signale ohne Stop, keine Stops, die „ausnahmsweise“ weiter weg liegen.
- Keine nachträgliche Umzählung, um einen Verlust schönzureden: Die Zählung ist falsch, wenn der Stop fällt.
- Keine Versprechen: Elliott-Wellen liefern Wahrscheinlichkeiten, keine Gewissheiten.
