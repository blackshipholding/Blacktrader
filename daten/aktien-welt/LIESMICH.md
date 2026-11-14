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

S&P 500 liegt in `kursdaten_SP500_teil1–5.zip` (alle 503 Aktien).

Auffälligkeiten (nicht verändert): 1COV.DE nur 18 Tage (Okt./Nov. 2026); bei einigen Hongkong-Werten an wenigen Tagen High < Low (Yahoo-Fehler).
Nur heutige Indexmitglieder → Überlebens-Verzerrung bei Tests.
