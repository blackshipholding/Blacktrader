# Härtetest Shipmaster 0.1 (11.11.2026) – gesichert

Die Skripte des großen Härtetests, mit dem **Shipmaster 0.1** (= Variante S9) ausgewählt wurde.
Sie laufen NICHT in der App und werden nicht mit gebaut (in `tsconfig.json` ausgeschlossen).

- `prep.py` – Nutzerdaten (CSV der 503 S&P-Aktien + S&P-500-Index) in JSON je Wert umwandeln (`data/`)
- `gen.ts` – Blacktraders Signale je Aktie mit genau dem App-Code, nur Vergangenheit (`sig/`)
- `sim.ts` – Kunden-Simulation (1.606 Starts 1990–2021 × 40 Depotgrößen, 100 × 1 Mio. Kunden, je 5 Jahre,
  7,90 €/Order, 27,5 % KESt) für alle Varianten S0–S14
- `report.py` – Auswertung, `result.json` – Ergebnis vom 11.11.2026
- `timing.ts` – Zeitmessung

Die Pfade zeigen noch auf den damaligen Arbeitsordner und müssen vor einem neuen Lauf angepasst werden.
Die Kursdaten (CSV/ZIP vom Nutzer, ~190 MB) sind nicht im Repository – für einen neuen Lauf neu hochladen.

Ergebnis (ab 10.000 €): S9 = Shipmaster 0.1 13,9 % p. a., 1,9 % Kunden mit Verlust, beide Zeithälften besser
als alle Alternativen. Details in `CLAUDE.md` und `DOKUMENTATION.md`.

**Regel des Nutzers:** Jede Änderung, die Shipmaster 0.1, Blacktraders Analyse/Handel oder diesen Härtetest
beeinflusst, erst mit dem Nutzer besprechen.

## Dividenden-Szenario (12.11.2026, nur Messung)
`sim_div.ts` = `sim.ts` + Umschalter `DIV` (0 = bereinigte Kurse wie bisher, 1 = echte Kurse + Dividenden, 2 = echte Kurse ohne Dividende).
Die echten Kurse werden aus den dividenden-bereinigten Kursen und der Dividendenliste des Nutzers (`SP500_Dividenden_alle_Zahlungen.csv`,
je heutiger Aktie) rückwärts rekonstruiert (Probe: Apple 1980 = 0,1283 USD wie Yahoo). Aufruf: `SIG=sigP7 POS=A ONLY=P7 DIV=1 tsx sim_div.ts`.
Dividenden fließen beim Schließen der Position in den Gewinn (KESt 27,5 % mit Verlusttopf).
