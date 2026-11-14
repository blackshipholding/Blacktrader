# Aktien Welt – Tageskerzen (Stand 13.11.2026)

Quelle: Yahoo Finance über yfinance, `auto_adjust=False`, geladen am 14.11.2026 mit `aktien_welt_download.py` (Colab).
Spalten je Datei: `date, open, high, low, close (Rohkurs), adj_close (bereinigt um Splits + Dividenden), volume`.
Nichts aufgefüllt, nichts erfunden.

| Gruppe | Werte | geladen | fehlt bei Yahoo |
|---|---|---|---|
| Nasdaq100 (Wikipedia-Liste, Stand Okt. 2026) | 101 | 101 | – |
| SP500 (Wikipedia-Liste) | 503 | 503 | – |
| Europa (App-Liste STOCKS_EU_WIDE) | 153 | 152 | ROG.SW |
| AsienPazifik (App-Liste STOCKS_ASIA_WIDE) | 175 | 173 | 0011.HK, TATAMOTORS.NS |

**Achtung:** Im Repo liegen nur `kursdaten_SP500_teil1–4.zip` (433 Aktien, A… bis TFC). `teil5` (70 Aktien TGT…ZTS) fehlt noch.
Die 70 Werte sind aber in `kursdaten/uebersicht.csv` gelistet; 9 davon (Nasdaq-Mitglieder) stecken auch in `kursdaten_Nasdaq100.zip`; für die übrigen 61 gibt es nur die ältere Quelle (`daten/SP500_Schlusskurse_alle_Aktien.zip`, Schlusskurse bis 10.11.2026).

Auffälligkeiten (nicht verändert): 1COV.DE nur 18 Tage (Okt./Nov. 2026); bei einigen Hongkong-Werten an wenigen Tagen High < Low (Yahoo-Fehler).
Nur heutige Indexmitglieder → Überlebens-Verzerrung bei Tests.
