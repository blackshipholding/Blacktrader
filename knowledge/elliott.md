# Elliott-Wellen – Wissensbasis des Black-Ship-Analysten

In eigenen Worten zusammengefasst (keine Texte aus Büchern, Kursen oder Videos übernommen).
Jede Regel ist einer Stelle im Code zugeordnet. **Regeln** sind hart (eine Zählung, die sie verletzt, wird verworfen).
**Richtlinien** sind weich (sie verbessern oder verschlechtern nur die Bewertung einer Zählung).

## 1. Grundgedanke
- Märkte bewegen sich in Trendrichtung in fünf Teilbewegungen (Impuls) und gegen den Trend in drei (Korrektur).
- Jede Welle besteht wieder aus kleineren Wellen (Grade). Der Analyst zählt drei Grade gleichzeitig: fein, mittel, grob
  (`elliottDegrees`, ZigZag mit ATR-Faktor → `src/lib/analysis/elliott/index.ts`).
- Eine Zählung ist eine Hypothese. Es gibt immer ein Hauptszenario und mindestens eine Alternative.

## 2. Harte Regeln (Impuls) – fest in `locked-config.ts`, geprüft in `elliott/patterns.ts`
1. Welle 2 läuft nie unter den Startpunkt von Welle 1 (bzw. bei Abwärtsimpulsen nie darüber).
2. Welle 3 ist nie die kürzeste der Wellen 1, 3 und 5.
3. Welle 4 dringt nicht in den Kursbereich von Welle 1 ein – Ausnahme: Diagonalen.

## 3. Muster
| Muster | Aufbau | Merkmale | Code |
|---|---|---|---|
| Impuls | 5-3-5-3-5 | Regeln 1–3, meist eine verlängerte Welle (oft 3) | `impulse` |
| Führende Diagonale | 5-3-5-3-5 oder 3-3-3-3-3 | Welle 1 oder A, keilförmig, Überlappung 1/4 erlaubt | `leading-diagonal` |
| Endende Diagonale | 3-3-3-3-3 | Welle 5 oder C, keilförmig, Ende eines Trends | `ending-diagonal` |
| Zickzack | 5-3-5 (A-B-C) | scharfe Korrektur, B kurz (meist < 79 % von A) | `zigzag`, `double-zigzag`, `triple-zigzag` |
| Flat | 3-3-5 | B erreicht ≈ den Start von A; regulär / erweitert (B > 100 %) / laufend | `flat-regular`, `flat-expanded`, `flat-running` |
| Dreieck | 3-3-3-3-3 (A-E) | seitwärts, kontrahierend oder expandierend, meist Welle 4 oder B | `triangle-contracting`, `triangle-expanding` |
| Kombination | W-X-Y(-X-Z) | aneinandergereihte einfache Korrekturen | `combination-wxy`, `combination-wxyxz` |

## 4. Fibonacci-Beziehungen (Richtlinien, Toleranz lernbar: `fibToleranceScale`)
- Welle 2: tiefe Korrektur, typisch 50–78,6 % von Welle 1.
- Welle 3: typisch 161,8 % von Welle 1 (häufig 100–261,8 %).
- Welle 4: flachere Korrektur, typisch 23,6–38,2 % von Welle 3, selten tiefer als 50 %.
- Welle 5: typisch 61,8–100 % von Welle 1, oder 61,8 % der Strecke 1–3.
- Zickzack: C ≈ 100 % von A (oder 61,8 % / 161,8 %).
- Flat: B 90–105 % von A, C 100–165 % von A (erweitert: B bis 138 %, C bis 261,8 %).
- Dreieck: jede Teilwelle ≈ 61,8–80 % der vorigen.

## 5. Weitere Richtlinien
- **Alternation:** Sind Welle 2 und 4 verschieden (scharf gegen seitwärts, tief gegen flach), wird die Zählung wahrscheinlicher.
- **Verlängerung:** Meist ist genau eine Impulswelle verlängert, am häufigsten Welle 3 (an Aktienmärkten), bei Rohstoffen öfter Welle 5.
- **Kanäle:** Ein Impuls läuft oft in einem Kanal (Linie 0–2, parallel durch 1 bzw. 3). Welle 4 endet oft an der unteren Kanallinie.
- **Volumen:** In Welle 3 meist am höchsten, in Welle 5 oft schwächer (Erschöpfung).
- **Momentum (RSI):** In Welle 3 am stärksten. Eine neue Kursspitze in Welle 5 mit schwächerem RSI (Divergenz) deutet auf ein Ende hin.
- **Korrektur-Ziel:** Nach einem fertigen Impuls korrigiert der Markt oft in den Bereich der vorigen Welle 4.

## 6. Daraus abgeleitete prüfbare Regeln im Code
| Regel | Wirkung | Wo | lernbar? |
|---|---|---|---|
| Harte Impulsregeln 1–3 | Zählung verwerfen | `elliott/patterns.ts` | nein (fest) |
| Einstieg im Retracement 61,8–78,6 % der letzten Welle (Zielzone statt Einzelkurs) | Limit-Order in der Zone | `zones.ts` | nein (fest) |
| Stop jenseits des Wellenstarts (Invalidierung) | Risiko begrenzt | `zones.ts` | nein (fest) |
| Ziel 1 = Extension 127,2 % der Welle, danach Stop nachziehen | Gewinne laufen lassen | `zones.ts`, `zoneBacktest.ts` | nein (fest) |
| Wellenbild muss die Richtung stützen (Elliott-Teilscore ≥ 50 + x) | Signal verhindern | `analyze.ts` `elliottVetoes` | ja, nur strenger (`elliottAgreement`) |
| Kein Einstieg am Ende von Welle 5 (fertiger Impuls in Trade-Richtung oder RSI-Divergenz am Extrem) | Signal verhindern | `analyze.ts` | ja, nur ein (`wave5Filter`) |
| Übergeordnete Zeitebene darf nicht widersprechen | Signal verhindern | `analyze.ts` | ja, nur ein (`htfConfirm`) |
| Nach Ziel 1: Erschöpfung (neues Extrem + schwächerer RSI) → Gewinn sichern | früher Ausstieg im Gewinn | `indicators.ts` `exhaustionAt` | ja, nur ein (`wave5Exit`) |
| Ranking: Fibo-Passung vs. Kontext | Haupt-/Alternativszenario | `elliott/index.ts` | ja (`rankFibWeight`, `rankContextStrength`) |
| Empfindlichkeit der Pivot-Erkennung | welche Wellen gezählt werden | `elliott/index.ts`, `zones.ts` | ja (`elliottDegrees`, `zoneAtrMult`) |
