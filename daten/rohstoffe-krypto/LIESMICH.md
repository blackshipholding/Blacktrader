# Kostenlose historische Kursdaten: Rohstoffe und Krypto

Stand der Recherche: 14.11.2026. Alle Quellen sind kostenlos, ohne Konto oder mit kostenlosem Konto/Schlüssel.
Das Skript `kursdaten_download.py` lädt alles automatisch und schreibt die **genauen** ersten und letzten Handelstage
jeder Reihe in `kursdaten/uebersicht.csv`. Die Startdaten unten sind Richtwerte („ca.“), wo ich sie nicht direkt prüfen konnte.

## Schnellstart

```
pip install yfinance pandas requests
python kursdaten_download.py
```

Ergebnis im Ordner `kursdaten/`:

| Datei | Inhalt |
|---|---|
| `rohstoffe/<Name>.csv` | eine Datei pro Rohstoff |
| `krypto/<SYMBOL>.csv` | eine Datei pro Coin, aus der Quelle mit der längsten Historie |
| `krypto_je_quelle/<quelle>/<SYMBOL>.csv` | dieselben Coins je Quelle, zum Vergleichen |
| `rohstoffe_alle.csv`, `krypto_alle.csv` | Sammeldateien mit Spalte `symbol` |
| `uebersicht.csv` | Quelle, Ticker, erster/letzter Tag, Zeilen, Währung/Einheit, ob rollierend bereinigt |

Spalten immer genau: `date, open, high, low, close, volume` (Datum `YYYY-MM-DD`). Fehlende Tage bleiben fehlend,
nichts wird aufgefüllt. Quellen werden **nicht** vermischt.

Optionale kostenlose Schlüssel (Umgebungsvariable vor dem Start setzen; Windows: `set NAME=wert`, Mac/Linux: `export NAME=wert`):

| Variable | Wofür | Wo holen |
|---|---|---|
| `STOOQ_APIKEY` | Gold-/Silber-Spot ab 1968+ | https://stooq.com/q/d/?s=xauusd&get_apikey (Captcha lösen, Schlüssel steht im CSV-Link) |
| `CRYPTOCOMPARE_API_KEY` | längste Krypto-Historie (BTC ab 2010) | https://min-api.cryptocompare.com/pricing („Get your free key“) |

Kraken (optional, sehr groß, ca. 5 × 2 GB): Dateien laden, zusammenfügen, entpacken, dann
`python kursdaten_download.py --kraken-ordner <Ordner>`.

---

## 1) Rohstoffe

**Quelle für alle Futures: Yahoo Finance über `yfinance`.** Der Download-Knopf auf der Yahoo-Webseite ist inzwischen
kostenpflichtig, die Bibliothek `yfinance` lädt die Daten aber weiterhin frei. Yahoo drosselt bei vielen Abfragen
(Fehler 429); das Skript wartet dann automatisch.

**Wichtig – nicht rollierend bereinigt:** Yahoos `=F`-Reihen verketten einfach den jeweils vordersten Kontrakt.
Am Rolltag springt der Kurs um den Preisunterschied zwischen altem und neuem Kontrakt (Contango/Backwardation).
Für Langfrist-Charts ist das meist unkritisch, für Backtests mit Rolltagen nicht. Echte rückwärts bereinigte
Reihen gibt es nur kostenpflichtig (z.B. CME DataMine, Barchart, Norgate).

| Rohstoff | Ticker | Börse | Einheit / Währung | Erster Tag (Yahoo) |
|---|---|---|---|---|
| Gold | GC=F | COMEX | USD je Feinunze | 30.08.2000 |
| Silber | SI=F | COMEX | USD je Feinunze | ca. Aug 2000 |
| Platin | PL=F | NYMEX | USD je Feinunze | ca. 2000 |
| Palladium | PA=F | NYMEX | USD je Feinunze | ca. 2000 |
| Kupfer | HG=F | COMEX | USD je Pfund | ca. Aug 2000 |
| Aluminium | ALI=F | COMEX | USD je Tonne | deutlich später, Lücken möglich |
| WTI-Öl | CL=F | NYMEX | USD je Barrel | ca. Aug 2000 |
| Brent-Öl | BZ=F | NYMEX | USD je Barrel | ca. 2007 |
| Erdgas (Henry Hub) | NG=F | NYMEX | USD je MMBtu | ca. Aug 2000 |
| Benzin (RBOB) | RB=F | NYMEX | USD je Gallone | ca. 2000 |
| Heizöl | HO=F | NYMEX | USD je Gallone | ca. 2000 |
| Mais | ZC=F | CBOT | US-Cent je Scheffel | ca. 2000 |
| Weizen | ZW=F | CBOT | US-Cent je Scheffel | ca. 2000 |
| Sojabohnen | ZS=F | CBOT | US-Cent je Scheffel | ca. 2000 |
| Sojaöl | ZL=F | CBOT | US-Cent je Pfund | ca. 2000 |
| Sojaschrot | ZM=F | CBOT | USD je Short-Ton | ca. 2000 |
| Hafer | ZO=F | CBOT | US-Cent je Scheffel | ca. 2000 |
| Reis | ZR=F | CBOT | USD je Zentner (cwt) | ca. 2000 |
| Kaffee | KC=F | ICE US | US-Cent je Pfund | ca. 2000 |
| Zucker | SB=F | ICE US | US-Cent je Pfund | ca. 2000 |
| Kakao | CC=F | ICE US | USD je Tonne | ca. 2000 |
| Baumwolle | CT=F | ICE US | US-Cent je Pfund | ca. 2000 |
| Orangensaft | OJ=F | ICE US | US-Cent je Pfund | ca. 2000 |
| Lebendrind | LE=F | CME | US-Cent je Pfund | ca. 2000 |
| Mastrind | GF=F | CME | US-Cent je Pfund | ca. 2000 |
| Magerschwein | HE=F | CME | US-Cent je Pfund | ca. 2000 |
| Holz | LBR=F (neu, ab 2022); alt LBS=F | CME | USD je 1000 Board-Fuß | LBR=F erst ab 2022 |
| Milch (Class III) | DC=F | CME | USD je Zentner (cwt) | später als 2000 |
| Kohle (Rotterdam) | MTF=F | ICE/NYMEX | USD je Tonne | kurz, Volumen oft 0 |
| Uran | UX=F | COMEX | USD je Pfund U3O8 | kurz, Volumen oft 0 |
| Eisenerz 62 % Fe | TIO=F | COMEX | USD je Tonne | kurz |
| Ethanol (Chicago) | CU=F | NYMEX | USD je Gallone | kurz |
| Raps | – | Euronext | EUR je Tonne | **keine kostenlose OHLC-Quelle gefunden** |
| Gold-Spot | xauusd (stooq) | Spot | USD je Feinunze | stooq: Jahrzehnte (Schlüssel nötig) |
| Silber-Spot | xagusd (stooq) | Spot | USD je Feinunze | stooq: Jahrzehnte (Schlüssel nötig) |

**Aktualität:** Yahoo-Tagesdaten gibt es bis zum letzten Handelstag, aktualisiert täglich (verzögerte Kurse).
stooq ebenfalls täglich; kostenloser Schlüssel per Captcha, mit Tageslimit für Abrufe.

**Gold-Spot:** Die frühere kostenlose LBMA-Goldreihe bei FRED (St. Louis Fed) wurde entfernt. Für Spot bleibt stooq
(Schlüssel) oder Yahoo `XAUUSD=X`, falls Yahoo sie liefert; das Skript probiert beides.

## 2) Krypto

| Quelle | Kosten / Zugang | Längste Historie | Volumen | Bis wann / Aktualisierung |
|---|---|---|---|---|
| **CryptoCompare (CoinDesk Data)** | kostenloser Schlüssel, 100.000 Abrufe/Monat, Quellenangabe verlangt | BTC ab ca. 17.07.2010, viele Altcoins ab Notierung (teils 2013/14) | USD (`volumeto`) | bis gestern, täglich |
| **Bitstamp API** | frei, ohne Konto | BTC/USD ab ca. Aug 2011; ETH, XRP, LTC, BCH u.a. ab Notierung bei Bitstamp | Basiswährung → Skript rechnet × Schlusskurs in USD um (Näherung) | bis gestern, laufend |
| **Kraken OHLCVT-ZIP** | frei, ohne Konto | BTC ab ca. Okt 2013, ETH ab ca. Aug 2015, viele Paare ab Notierung | Basiswährung → × Schluss in USD (Näherung) | Gesamtdatei bis 30.06.2026, danach Quartals-ZIPs (2026Q3 = bis 30.09.2026) |
| **Yahoo Finance (yfinance)** | frei, ohne Konto | BTC, LTC ab 17.09.2014; die meisten anderen ab 09.11.2017 oder ab Notierung | USD | bis gestern, täglich |
| Binance (data.binance.vision) | frei, ohne Konto | ab 15.08.2017 (Monatsdateien) | **USDT**, nicht USD | täglich (Folgetag ca. 10:00 UTC) |
| CoinGecko | kostenloser Schlüssel | **nur die letzten 365 Tage** kostenlos | USD | – (für lange Historie ungeeignet) |

**Längste kostenlose Historie:** CryptoCompare (mit Gratis-Schlüssel), danach Bitstamp (BTC) und Kraken. Ohne jeden
Schlüssel ist Bitstamp für BTC die beste Wahl (ab 2011), Kraken für ETH (ab 2015), Yahoo für die breite Masse ab 2017.
Das Skript nimmt pro Coin automatisch die Quelle mit dem frühesten Start und schreibt die anderen in `hinweis`.

Coins im Skript: BTC, ETH, XRP, LTC, XLM, DOGE, DASH, XMR, ETC, ZEC, BCH, ADA, TRX, BNB, EOS, NEO, IOTA, LINK, VET,
QTUM, XTZ, ATOM, ALGO, DOT, SOL, AVAX, UNI sowie BSV, XEM, WAVES, DCR, DGB, SC, ZIL, ICX, ONT, BAT, ZRX, OMG, LSK,
STEEM, XVG, RVN, NANO, HBAR, THETA, MKR, SNX, AAVE, COMP, YFI, KSM, FIL, NEAR, CRO, LEO, OKB, KCS, HT, ENJ, MANA, CHZ,
ONE, FTM, MATIC, EGLD, XDC, QNT, KAVA, CELO, BTG. Weitere lassen sich in der Liste `KRYPTO` im Skript ergänzen.

Hinweise: DOT, SOL, AVAX, UNI, AAVE, COMP, YFI, FIL, NEAR, KSM gibt es erst seit 2019/2020 – sie haben trotzdem ≥ 6 Jahre.
Coins, die umbenannt wurden (MATIC → POL, FTM → S, NANO → XNO), probiert das Skript unter beiden Namen.

## Direkte Links

- Kraken Gesamtdatei (5 Teile): https://assets.kraken.com/marketing/institutions/Kraken_OHLCVT_Full.zip.part00 bis …part04,
  Prüfsummen: https://assets.kraken.com/marketing/institutions/OHLCVT_Full_PARTS_SHA256SUMS.txt,
  Nachtrag: https://assets.kraken.com/marketing/institutions/Kraken_OHLCVT_2026Q3.zip
  Zusammenfügen: Windows `copy /b Kraken_OHLCVT_Full.zip.part00 + …part01 + …part02 + …part03 + …part04 Kraken_OHLCVT_Full.zip`, Mac/Linux `cat Kraken_OHLCVT_Full.zip.part* > Kraken_OHLCVT_Full.zip`
- Bitstamp Beispiel (BTC, 1000 Tage ab Aug 2011): https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&start=1313625600
- CryptoCompare Beispiel: https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=2000&api_key=DEIN_SCHLUESSEL
- Binance Beispiel: https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-2017-08.zip
- stooq CSV (nach Schlüssel): https://stooq.com/q/d/l/?s=xauusd&i=d&apikey=DEIN_SCHLUESSEL
- Yahoo Ansicht (Web-Download kostenpflichtig, Skript nutzt yfinance): https://finance.yahoo.com/quote/GC%3DF/history

## Rechtliches (kurz, keine Rechtsberatung)

Alle Quellen sind für private Nutzung frei abrufbar. Yahoo erlaubt keine kommerzielle Weiterverwendung ohne Lizenz;
CryptoCompare verlangt im Gratis-Tarif eine Quellenangabe. Wer die Daten in einer öffentlichen App weitergibt,
braucht in der Regel eine Lizenz des Anbieters. Das Skript wartet zwischen Abfragen (1,5 s) und bei Drosselung.
