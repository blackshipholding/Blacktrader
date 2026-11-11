# Übergabe an das Team – Blacktrader

Stand: 11.11.2026. Live-Version: https://blacktrader.vercel.app

## Getrennt arbeiten (Wunsch des Nutzers)

Das Team arbeitet in einer **eigenen Kopie**. Die Live-App des Nutzers (https://blacktrader.vercel.app, Repository `herrkronos/blacktrader`) bleibt davon unberührt.

1. Den Inhalt der ZIP-Datei in ein **eigenes, neues GitHub-Repository** des Teams hochladen:
   ```bash
   git init && git add -A && git commit -m "Start"
   git remote add origin <eigenes Repository>
   git push -u origin main
   ```
2. In Claude Code (claude.ai/code) dieses **eigene** Repository auswählen.
3. Wer eine Test-Version im Netz will, legt ein **eigenes Vercel-Projekt** an. Das Tageslimit des Nutzers ist davon nicht betroffen.
4. **Nicht** in `herrkronos/blacktrader` pushen und nicht mit dem Vercel-Projekt des Nutzers verbinden.
5. Gute Änderungen gehen als Vorschlag an den Nutzer. Er entscheidet, was in seine App übernommen wird.
6. **`CLAUDE.md` zuerst lesen.** Dort stehen alle festen Regeln und Wünsche des Nutzers, und Claude Code lädt die Datei automatisch. Der Hinweis dort, nur auf den Branch `claude/black-ship-trading-app-a74mmo` zu pushen, gilt nur für die App des Nutzers. Im eigenen Repository des Teams gilt er nicht.

## Lokal starten

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # Vitest
npx next build  # Produktions-Build
```

Es gibt weder Login noch Datenbank. Alle Nutzerdaten liegen im Browser (localStorage) und lassen sich unter Mehr → Backups exportieren und importieren.

## Aufbau (kurz)

| Ordner | Inhalt |
|---|---|
| `src/app` | Seiten: Übersicht, Chancen, Watchlist, Depot, Mehr, Regelwerk; API-Routen für Kurse, Trainer und Push |
| `src/lib/analysis` | Elliott-Wellen, Blau/Grün/Rot-Zonen, Punkte, KESt |
| `src/lib/client` | Scanner, Depot-Konto, Order-Zettel, Langfrist-Positionen, Nachkauf |
| `src/lib/trainer` | Turnier, 15 Gegner, Lernen, Regelwerk |
| `src/lib/store` | Datenspeicher im Browser |
| `src/components` | Oberfläche |
| `tests` | Unit-Tests |

Ausführliche Beschreibung: `DOKUMENTATION.md`.

Die Härtetest-Skripte lagen nur im temporären Arbeitsordner und sind **nicht** im Repository. Die Ergebnisse stehen in `CLAUDE.md`.

## Vercel

Projekt mit dem GitHub-Repository verbinden. Framework: Next.js. Server-Region: `fra1` (siehe `vercel.json`).

Umgebungsvariablen, alle optional; die App läuft auch ohne sie:

| Variable | Wofür |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push-Meldungen. Das Team erzeugt **eigene** Schlüssel, z. B. mit `npx web-push generate-vapid-keys`. |
| `KV_REST_API_URL`/`_TOKEN` oder `UPSTASH_REDIS_REST_URL`/`_TOKEN` | Speicher für Trainer-Ergebnisse und Push-Abos (eigenes Upstash/Vercel KV) |
| `CRON_SECRET`, `TRAINER_ADMIN_TOKEN` | Schutz für Cron und Trainer-Verwaltung: eigene, zufällige Werte |

Die Schlüssel des Nutzers werden **nicht** weitergegeben.
