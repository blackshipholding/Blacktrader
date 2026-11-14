# Kursdaten S&P 500 (Stand 10.11.2026)

Nur Daten – kein App-Code. Erstellt am 14.11.2026 aus öffentlichen Datensätzen (Yahoo-Finance-Historie, stooq, Kaggle), Überschneidungen gegeneinander geprüft.

| Datei | Inhalt |
|---|---|
| `SP500_Index_Tagesdaten_1927-2026.csv` | S&P-500-Index, 24.832 Handelstage 30.12.1927–09.11.2026: Date, Open, High, Low, Close, Volume. Vor 1962 nur Schlusskurse (O=H=L=C). Nicht bereinigt (Index). |
| `SP500_Schlusskurse_alle_Aktien.zip` | Eine CSV: Zeilen = Handelstage 1962–10.11.2026, Spalten = 503 heutige S&P-500-Aktien, Tagesschlusskurse in USD. **Um Splits UND Dividenden bereinigt** (wie Yahoo „Adj Close“). Leer = noch nicht gehandelt. DAL ab 25.04.2007, NVR ab 01.10.1993 (alte Aktien vor Insolvenz entfernt). |
| `SP500_Aktien_Uebersicht.csv` | Je Aktie: Name, Sektor, Zeitraum, Handelstage, Quellen, Prüfergebnis, korrigierte Werte. |
| `SP500_Dividenden_alle_Zahlungen.csv` | 48.408 Dividenden von 419 Firmen, 1962–10.11.2026: Ex-Datum, Betrag je **heutiger** Aktie (split-bereinigt, USD), ab 2015 Rendite je Zahlung, Hinweis bei Sonderzahlungen/Abspaltungen. |
| `SP500_Dividenden_alle_Firmen.xlsx` | Dieselben Dividenden als Excel: Übersicht je Firma, Jahressummen, alle Zahlungen, Info. |

Grenzen: nur heutige Indexmitglieder (Überlebens-Verzerrung); Abspaltungen sind bei Yahoo teils als Kurslücke/Dividende enthalten (z. B. DHR 05.07.2016).

## Rohstoffe und Krypto (Ordner `rohstoffe-krypto/`)

Noch keine Kursdateien, sondern das Download-Skript `kursdaten_download.py` und die Quellenübersicht `LIESMICH.md`
(32 Rohstoff-Futures + Gold-/Silber-Spot, 71 Coins; Spalten date, open, high, low, close, volume).
Die Kursquellen (Yahoo, stooq, Bitstamp, CryptoCompare, Kraken) sind aus der Cloud-Umgebung gesperrt –
das Skript muss auf einem Rechner mit Internet laufen. Ergebnisse danach in diesen Ordner legen.
