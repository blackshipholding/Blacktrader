# Black Ship Holding – Blacktrader

Web-App für Watchlist, Echtzeit-Überwachung und regelbasierte Analyse (Elliott-Wellen 60 %, Fundamental/News 20 %, Volumen/RSI 20 %) mit Papier-Trade-Journal und Backtest.
Der Analyst heißt **Blacktrader**: Er rechnet die Zeiträume im Hintergrund und zeigt je Wert **genau einen Einstieg** – Blau (langfristig), Grün (Trade), Rot (Short, nur bei bärischem Gesamtmarkt) oder Gelb (abwarten); alte Einstiege werden grau.
Der Trainer lässt Blacktrader in einem Turnier gegen 9 andere Bots antreten (10 Teilnehmer): 50 Versuche à 5 Jahre echte Zeit (5.000 € Start, 500 € je Trade, 27,5 % KESt, wer kein Geld mehr hat scheidet aus) in bullischen, neutralen, bärischen und gemischten Zeiträumen; Blacktrader lernt zwischen den Runden und speichert Verbesserungen sofort. Das Journal heißt jetzt **Depot**.
Ausführliche Beschreibung: **[DOKUMENTATION.md](DOKUMENTATION.md)**.
**Kein Login, keine Registrierung, keine Zahlungsmittel.** Alle Daten liegen lokal im Browser (localStorage) und lassen sich als JSON exportieren und importieren.

> Keine Anlageberatung. Analysen können falsch sein. Handel auf eigenes Risiko.

## Start

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # Unit-Tests (Vitest)
npm run build      # Produktions-Build
```

**Hintergrund:** Lege das Wappen als `public/background.jpg` ab. Es wird fixiert, zentriert und mit „contain“ dargestellt. Ohne Datei bleibt der Hintergrund schwarz.

**Vercel:** Repository importieren, Framework „Next.js“, keine Umgebungsvariablen nötig. `vercel.json` legt die Server-Region auf Frankfurt (`fra1`) fest, damit Binance und europäische Kursdaten erreichbar sind.

## Datenquellen (alle kostenlos, ohne Key)

| Zweck | Quelle | Hinweis |
|---|---|---|
| Aktien/ETF-Kerzen & Kurse | Yahoo Finance (inoffiziell) | Polling 15–60 s, je nach Börse ~15 min verzögert |
| Fundamentaldaten Aktien | Yahoo quoteSummary (Cookie/Crumb) | inoffiziell, kann sich ändern → optional Finnhub/Alpha Vantage |
| ISIN → Ticker | Yahoo-Suche, Fallback OpenFIGI | ISIN-Prüfziffer wird lokal validiert |
| Krypto-Kerzen & Live-Kurse | Binance REST + WebSocket | Fallback: Polling bzw. Yahoo `BTC-USD` |
| Krypto-Fundamentaldaten | CoinGecko | Marktkapitalisierung, Angebot, Entwicklungsaktivität |
| News (72 h) | Yahoo-Finance-RSS, Google-News-RSS | Sentiment per Lexikon (DE/EN) mit Quellenlink |

Optional in den Einstellungen (lokal gespeichert): Finnhub, Alpha Vantage, OpenFIGI und ein LLM-Key (Anthropic/OpenAI) zum Ausformulieren der Begründungen.

**Wichtig für Vercel:** Die Binance-REST-API blockiert US-Server-IPs (HTTP 451). Die Proxy-Route versucht zuerst `data-api.binance.vision` und fällt danach auf Yahoo (`BTC-USD`) zurück. Der Live-WebSocket läuft direkt im Browser des Nutzers und ist davon nicht betroffen.

## Architektur

```
src/lib/analysis/   reine, getestete Analyse-Module
  isin.ts           ISIN-Validierung (Luhn)
  indicators.ts     RSI (Wilder), ATR, OBV, rel. Volumen, Volume Profile, Divergenzen
  zigzag.ts         Swing-Erkennung mit ATR-Schwelle
  elliott/          Muster (Impuls, Diagonalen, Zigzag, Flats, Dreiecke, W-X-Y, W-X-Y-X-Z),
                    harte Regeln, Fibonacci-Passung, Ranking, Ziele und Invalidierung
  fundamental.ts    Kennzahlen-Score + News-Sentiment
  volume.ts         Volumen/RSI-Score
  score.ts          Gewichtung, Signalstufen, Trade-Plan, Veto („lieber kein Trade“)
  persona.ts        regelbasierte Begründungstexte im Stil von Blacktrader
  bestEntry.ts      ein Einstieg pro Wert (Blau/Grün/Gelb), Marktlage, Sektor-Regel, Verlauf
  promotion.ts      Hochstufung Grün → Blau, Stop nur nachziehen
  backtest.ts       EchoChart: Walk-Forward-Backtest ohne Blick in die Zukunft
src/lib/data/       Server: Provider, Cache, Drosselung, Rate-Limit
src/app/api/        Proxy-Routen (resolve, candles, quote, fundamentals, news, llm)
src/lib/client/     Live-Kurse (WebSocket/Polling), Alarme, Trade-Verfolgung
src/lib/store/      lokaler Speicher + Export/Import
```

### Score-Logik
`Gesamt = 0,6 × Elliott + 0,2 × Fundamental/News + 0,2 × Volumen/RSI` (in den Einstellungen änderbar).
Signalstufen: ≥ 72 Starker Kauf, ≥ 58 Kauf, ≤ 42 Verkauf, ≤ 28 Starker Verkauf, sonst Neutral.
Ein Signal wird auf **Neutral/kein Trade** gesetzt, wenn die Wellenzählung unsicher ist, die Alternativzählung fast gleich stark in die Gegenrichtung zeigt, das Chance-Risiko-Verhältnis unter 1,5 liegt oder Elliott der Gesamtrichtung widerspricht.

## Messung mit echten Kursdaten

`scripts/evaluate.ts` lässt den Analysten (EchoChart-Logik) über echte historische Kursreihen laufen und teilt jede Reihe in
Entwicklung (erste 60 %) und unabhängige Prüfung (letzte 40 %). Regeln werden nur anhand der Entwicklungsdaten gewählt.

```bash
DATA_DIR=<ordner mit SPY_D.csv, GOOG.csv, EURUSD.csv, xau2016_5m.csv> npx tsx scripts/evaluate.ts
DATA_DIR=... GRID=1 npx tsx scripts/evaluate.ts   # Filter-Kombinationen (nur Entwicklungsdaten)
```

Stand der Messung auf Prüfdaten (letzte 40 %, vom Analysten nie gesehen):

| Methode | Trades | Treffer | Gewinnfaktor |
|---|---|---|---|
| Elliott-Sofort-Einstieg (alt) | 145 | 16 % | 0,51 |
| + Trendfilter + Stop ≥ 2 ATR | 138 | 35 % | 0,66 |
| Zielzonen-Einstieg, Ausstieg bei Ziel 1 | 383 | 36 % | 1,18 |
| **Zielzonen + Gewinne laufen lassen (aktuell)** | **283** | **34 %** | **1,67** |

Zielzonen (`src/lib/analysis/zones.ts`): im Trend die letzte Welle A→B, Limit-Einstieg bei 61,8 % Korrektur
(Zone bis 78,6 %), Stop jenseits von A, Ziel 1 = B + 27,2 %. Ab Ziel 1 Stop auf Einstieg und mit 4 × ATR nachziehen. `ZONE='{...}'` bzw. `ZONEGRID=1` für Messungen.

### Langfristiger Einstieg (blau)

`src/lib/analysis/longterm.ts`: Nach einer großen Aufwärtswelle (Welle 1 nach einem Boden oder Impuls mit höherem Hoch,
ZigZag 6 × ATR, mind. 8 ATR) wird der Bereich 61,8–88,6 % Korrektur (Welle 2) berechnet. Einstieg in drei Teilen
(Oberkante, Mitte, Unterkante), **kein fester Stop** – ungültig bei Schlusskurs unter dem Wellenstart. Teilausstieg oder
Stop gibt es nur bei geänderter Zählung (`assessLongTerm`): Welle 5 fertig mit nachlassendem Momentum → Hälfte verkaufen,
Stop unter Welle 4; Alternativszenario wahrscheinlicher → im Gewinn Hälfte verkaufen + Stop auf Einstieg, sonst Stop unter
das letzte Tief. Messung über die Vergangenheit (nur Kerzen bis zum jeweiligen Zeitpunkt): EchoChart bzw.
`LONGTERM=1 npx tsx scripts/evaluate.ts`. Erste Messung auf den vorhandenen Daten (S&P 500, Google, Gold 2016):
30 Bereiche, 13 erfolgreich, 14 ungültig (≈ 48 %) – kleine Stichprobe.

Die frühere Kernposition (Welle 5 / Boden) wurde entfernt. Alte Kernpositionen im Journal bleiben erhalten und werden als „Langfristig“ angezeigt.

### Push-Nachrichten

Einstellungen → Push-Nachrichten. Benötigt Upstash for Redis (Schlüssel werden beim ersten Einschalten erzeugt und dort
gespeichert; alternativ `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` setzen). Die App schickt ihre offenen Trades
und die Watchlist an den eigenen Server; `/api/push/check` prüft sie und sendet: Einstieg erreicht, Stop/Ziel 1, Teil
gekauft, geänderte Zählung (Teilausstieg/Stop/Ausstieg) und neue langfristige Einstiegsbereiche der Watchlist (die erste
Prüfung merkt sich vorhandene Bereiche nur, damit keine Nachrichtenflut entsteht).

Vercel Hobby führt Cron-Jobs nur einmal täglich aus. Für häufigere Prüfungen einen kostenlosen Zeitplan-Dienst
(z. B. cron-job.org) alle 15–30 Minuten `GET https://<deine-app>/api/push/check` aufrufen lassen, mit Header
`Authorization: Bearer <CRON_SECRET>` (CRON_SECRET in Vercel setzen). iPhone: Push nur, wenn die App über
„Zum Home-Bildschirm“ installiert ist (ab iOS 16.4).

## Oberfläche (v2)

Bottom-Navigation: Übersicht · Chancen · Watchlist · Journal · Mehr (EchoChart, Einstellungen, Backups).
Signalfarben: Grün = Trade, Rot = Short, Blau = Langfristiger Einstieg, Orange = wartende Order.
Journal enthält nur selbst übernommene Papier-Trades; beim Update auf v2 wird vorher ein Backup im Browser angelegt
(Mehr → Backups). Zurück zum alten Stand: Branch `backup/vor-ui-umbau`.

## Trainer (Mehr → Trainer)

Der Trainer verbessert nur die **Anwendung** der Methode – die Strenge wird nie aufgeweicht.

- **Fest** (`src/lib/analysis/locked-config.ts`, eingefroren, `tests/locked.test.ts` schlägt bei Änderung fehl): Elliott-Grundregeln und Muster, Stop-/Ziel-Logik, Chance-Risiko ≥ 1,5, Nachziehen, Wartezeit, Horizonte, Farben, **Grenzen der Gewichtung** (Elliott ≥ 60 %, Fundamental/News ≥ 10 %, Volumen/RSI ≥ 10 %, Summe 100 %) und die **Annahmeregeln** (≥ 200 Signale, Signale/Monat höchstens −40 %, Profit-Faktor und max. Rückgang nicht schlechter).
- **Lernbar** (`src/lib/analysis/params.ts`, je Anlageklasse × Horizont): ZigZag-/Pivot-Empfindlichkeit (`elliottDegrees`, `zoneAtrMult`), Ranking alternativer Zählungen, Fibonacci-Toleranz, RSI-/Volumen-Schwellen, Divergenz-Frische, Gewichtung (in den festen Grenzen), Kennzahl-/News-Gewichte. **Nur strenger** (nie zurück): Mindest-Signalstärke, Wellen-Bestätigung (`elliottAgreement`), Welle-5-Filter, Bestätigung durch die übergeordnete Zeitebene, Gewinnsicherung bei Wellen-5-Ende (`wave5Exit`). Standardwerte = bisheriges Verhalten (`tests/golden.test.ts`).
- **Walk-Forward** (`src/lib/trainer/walkforward.ts`): Je Parametersatz ein Backtest über die Lernzeit (jedes Signal sieht nur Kerzen bis zu seinem Zeitpunkt). Für Fold k wird NUR mit Trades gewählt, die vor dem Prüfbeginn abgeschlossen sind; gemessen wird auf dem folgenden, unbekannten Bereich. Die letzten 12 Monate bleiben gesperrt (einmaliger Abschlusstest je Version).
- **Speichern nur, wenn besser:** Nach jeder Sitzung/jedem Bereich alt gegen neu auf unbekannten Daten. Meldung „Verbessert: 61,2 % → 63,8 % – gespeichert“ oder „Keine Verbesserung (60,9 %) – alter Stand bleibt“. Jede Version ist gespeichert und kann wiederhergestellt werden.
- **Trainer-Ansicht:** Ziel 70 % und aktueller Stand je Anlageklasse (Aktien · Krypto · Rohstoffe), Trainingsdauer (15 Min bis 8 Std) mit Start/Stopp, Ladebalken mit Restzeit und eine kurze Ergebnis-Meldung. Versionen, Verlauf und Details bleiben im Hintergrund (`/api/trainer`). Das Training läuft im Web Worker für die gewählte Klasse. Der Bildschirm bleibt an (Wake Lock), der Fortschritt bleibt nach dem Neuladen erhalten. Ergebnisse gehen an `/api/trainer/propose`. Der Server prüft Grenzen, Strenge-Regeln und Ausgangsstand erneut. Die Messwerte selbst kommen aus dem Browser – deshalb `TRAINER_ADMIN_TOKEN` setzen, damit nur du Ergebnisse speichern kannst.
- **Nachtlauf:** Vercel Cron (`vercel.json`, täglich 02:17 UTC) → `/api/trainer/cron`, je Lauf ~48 s, setzt die Arbeit fort. Zusätzlich wird das Signal-Protokoll ausgewertet.
- **Gewichtung in den Einstellungen:** „Automatisch (Trainer)“ oder „Manuell“ – drei Regler, dieselben festen Grenzen, Anzeige der zuletzt gelernten Gewichtung.
- **Wissensbasis:** `knowledge/elliott.md` (Regeln, Richtlinien, Muster → prüfbare Regeln im Code), `knowledge/analyst-principles.md` (Wie/Warum/Wann).
- **Getrennte Speicherung:** Jede Anlageklasse × Horizont hat einen eigenen Schlüssel (`trainer:aktien:kurz` … `trainer:rohstoffe:lang`) mit gelernten Werten, aktuellem/vorherigem Stand und Versionen (`src/lib/trainer/cells.ts`, `cellStore.ts`). Schreiben nur unter einer Sperre je Zelle (lesen → prüfen → ein SET). Zusätzlich lokale Kopie je Zelle im Browser; je Zelle gilt der jüngere Stand.
- **Sofort speichern:** Sobald im Training ein Stand auf unbekannten Daten besser ist (alle Strenge-Regeln), wird er sofort gespeichert (Server + lokal), nicht erst am Ende der Sitzung.
- **Zonen-Quote wie HKCM (Hauptmaß, Ziel 70 %):** Eine Zone zählt als Erfolg, wenn der Kurs eintaucht, vor der Unterkante dreht und oben aus der Zone herausläuft (Short gespiegelt); gescheitert, wenn er vorher über die Unterkante hinausläuft; nicht erreichte Zonen zählen nicht (`src/lib/analysis/zoneOutcome.ts`). Lernen und „nur speichern, wenn besser“ richten sich nach der Zonen-Quote; Profit-Faktor, Drawdown, Signalmenge (−40 %) und mind. 200 Zonen gelten weiter. Die Trade-Quote (Ziel 1 erreicht) wird zusätzlich angezeigt. Erste interne Messung der bestehenden Zonen auf unbekannten Testdaten: 87 Zonen, 64,4 % Erfolg.
- **EchoChart (einfach):** Wert oder ganze Gruppe (Alle Aktien/Krypto/Rohstoffe), Zeitraum, Rückblick → eine große Zahl „Zonen-Quote“ (wie HKCM gezählt), Aufteilung Kauf/Short/Kernposition, Chart mit allen Zonen (✓/✗), Details zum Aufklappen (`src/lib/analysis/echoZones.ts`). Jede Messung wird still für den Trainer aufbewahrt (`/api/trainer/echo`, auch im Export).
- **Messprotokoll und Export:** Je Klasse × Horizont wird jede bewertete Zone der Prüfdaten gespeichert (`trainer:<klasse>:<horizont>:protokoll`, `/api/trainer/protocol?cell=…`). „Ergebnisse exportieren“ im Trainer bzw. `/api/trainer/export` liefert alles als JSON.
- **Speicher:** In Vercel unter Storage „Upstash for Redis“ verbinden (`KV_REST_API_URL`/`KV_REST_API_TOKEN`). Optional `CRON_SECRET`, `TRAINER_ADMIN_TOKEN`.
- Offline-Messung: `DATA_DIR=<ordner> BUDGET_S=120 npx tsx scripts/train.ts`.
