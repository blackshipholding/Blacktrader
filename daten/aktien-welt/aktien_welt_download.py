# Tageskerzen (Yahoo Finance / yfinance) fuer: Nasdaq 100, Europa, Asien-Pazifik, S&P 500
# Spalten: date, open, high, low, close (Rohkurs), adj_close, volume. Nichts aufgefuellt, nichts erfunden.
# Colab:  %run Blacktrader/daten/aktien-welt/aktien_welt_download.py   danach  lade("Nasdaq100")  usw.
# trainer_werte.csv (Spalten gruppe, yahoo_ticker) vorher ueber das Ordner-Symbol hochladen.
import os, re, io, glob, time, shutil, zipfile, requests
import pandas as pd
import yfinance as yf

CSV_DATEI = "trainer_werte.csv"
ZIEL = "kursdaten"
PAKET = 20
PAUSE = 2
WARTEN_429 = [60, 120, 240, 480, 900]
MAX_ZIP_MB = 22
UA = {"User-Agent": "Mozilla/5.0 (privates Kursdaten-Skript)"}
SP = ["Gruppe", "Ticker", "Name", "erster Tag", "letzter Tag", "Zeilen", "Waehrung", "Fehlermeldung"]

GRUPPEN = {
    "Nasdaq100":    ("wiki", "https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies", 90, 115),
    "Europa":       ("csv", "Aktien_Europa"),
    "AsienPazifik": ("csv", "Aktien_Asien_Pazifik"),
    "SP500":        ("wiki", "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", 480, 520),
}


def dateiname(t):
    return re.sub(r"[^A-Za-z0-9._=-]", "_", t) + ".csv"


def wiki_liste(url, mn, mx):
    html = requests.get(url, headers=UA, timeout=30).text
    for tab in pd.read_html(io.StringIO(html)):
        tab.columns = [str(c[-1] if isinstance(c, tuple) else c).strip() for c in tab.columns]
        sp = next((c for c in ("Symbol", "Ticker") if c in tab.columns), None)
        if sp and mn <= len(tab) <= mx:
            nm = next((c for c in ("Security", "Company", "Name") if c in tab.columns), None)
            out = []
            for _, r in tab.iterrows():
                t = re.sub(r"\[.*?\]", "", str(r[sp])).strip()
                if t and t != "nan":
                    out.append((t.replace(".", "-"), str(r[nm]).strip() if nm else ""))
            return out
    raise RuntimeError(f"Mitglieder-Tabelle nicht gefunden: {url}")


def csv_liste(gruppe):
    pfad = CSV_DATEI if os.path.exists(CSV_DATEI) else "/content/" + CSV_DATEI
    if not os.path.exists(pfad):
        raise FileNotFoundError("trainer_werte.csv fehlt - bitte ueber das Ordner-Symbol hochladen")
    w = pd.read_csv(pfad)
    w.columns = [c.strip() for c in w.columns]
    t = w[w["gruppe"].astype(str).str.strip() == gruppe]["yahoo_ticker"].astype(str).str.strip()
    return [(x, "") for x in t if x and x.lower() != "nan"]


def ist_drosselung(e):
    s = f"{type(e).__name__} {e}"
    return "RateLimit" in s or "429" in s or "Too Many Requests" in s


def hole(t):
    for v in range(len(WARTEN_429) + 1):
        try:
            tk = yf.Ticker(t)
            try:
                df = tk.history(period="max", interval="1d", auto_adjust=False,
                                actions=False, raise_errors=True)
            except TypeError:
                df = tk.history(period="max", interval="1d", auto_adjust=False, actions=False)
            m = getattr(tk, "history_metadata", None) or {}
            name = m.get("longName") or m.get("shortName") or ""
            if df is None or df.empty:
                return None, m.get("currency", ""), name, "Yahoo liefert keine Daten"
            return df, m.get("currency", ""), name, ""
        except Exception as e:
            if ist_drosselung(e) and v < len(WARTEN_429):
                print(f"  429 Drosselung bei {t} - warte {WARTEN_429[v]} s ...")
                time.sleep(WARTEN_429[v])
                continue
            if ist_drosselung(e):
                return None, "", "", "429 Drosselung - spaeter nochmal laden"
            return None, "", "", f"{type(e).__name__}: {str(e)[:150]}"


def aufbereiten(df):
    d = pd.DataFrame({
        "date": df.index.strftime("%Y-%m-%d"),
        "open": df["Open"].values, "high": df["High"].values,
        "low": df["Low"].values, "close": df["Close"].values,
        "adj_close": df["Adj Close"].values if "Adj Close" in df else pd.NA,
        "volume": df["Volume"].values,
    })
    d = d.dropna(subset=["open", "high", "low", "close"], how="all")
    d = d.drop_duplicates(subset="date", keep="last").sort_values("date")
    d["volume"] = d["volume"].astype("Int64")
    return d


def lies_uebersicht():
    p = os.path.join(ZIEL, "uebersicht.csv")
    return pd.read_csv(p, dtype=str).fillna("") if os.path.exists(p) else pd.DataFrame(columns=SP)


def speichere(gruppe, zeilen):
    alt = lies_uebersicht()
    neu = pd.DataFrame(zeilen, columns=SP).astype(str)
    pd.concat([alt[alt["Gruppe"] != gruppe], neu]).to_csv(os.path.join(ZIEL, "uebersicht.csv"), index=False)
    neu.to_csv(os.path.join(ZIEL, gruppe, "uebersicht.csv"), index=False)


def packe(gruppe):
    for alt in glob.glob(f"kursdaten_{gruppe}*.zip"):
        os.remove(alt)
    ordner = os.path.join(ZIEL, gruppe)
    dateien = sorted(f for f in os.listdir(ordner) if f != "uebersicht.csv")
    teile, z = [], None
    for f in dateien:
        if z is None or os.path.getsize(teile[-1]) > MAX_ZIP_MB * 1e6:
            if z:
                z.close()
            teile.append(f"kursdaten_{gruppe}_teil{len(teile) + 1}.zip")
            z = zipfile.ZipFile(teile[-1], "w", zipfile.ZIP_DEFLATED)
            z.write(os.path.join(ordner, "uebersicht.csv"), f"{gruppe}/uebersicht.csv")
        z.write(os.path.join(ordner, f), f"{gruppe}/{f}")
    if z:
        z.close()
    if len(teile) == 1:
        os.rename(teile[0], f"kursdaten_{gruppe}.zip")
        teile = [f"kursdaten_{gruppe}.zip"]
    return teile


def lade(gruppe):
    art = GRUPPEN[gruppe]
    liste = wiki_liste(*art[1:]) if art[0] == "wiki" else csv_liste(art[1])
    seen = set()
    liste = [(t, n) for t, n in liste if not (t in seen or seen.add(t))]
    ordner = os.path.join(ZIEL, gruppe)
    os.makedirs(ordner, exist_ok=True)
    info = {}
    for _, r in lies_uebersicht().iterrows():
        if r["Zeilen"] not in ("", "0"):
            info.setdefault(r["Ticker"], {})[r["Gruppe"]] = r
    print(f"\n=== {gruppe}: {len(liste)} Ticker ===")
    zeilen = []
    for i in range(0, len(liste), PAKET):
        geladen = False
        for t, wname in liste[i:i + PAKET]:
            datei = dateiname(t)
            pfad = os.path.join(ordner, datei)
            quelle = gruppe if os.path.exists(pfad) else None
            if not quelle:
                for g in info.get(t, {}):
                    if os.path.exists(os.path.join(ZIEL, g, datei)):
                        shutil.copy(os.path.join(ZIEL, g, datei), pfad)
                        quelle = g
                        break
            if quelle:
                d = pd.read_csv(pfad)
                r = info.get(t, {}).get(quelle, {})
                hinweis = "" if quelle == gruppe else f"aus {quelle} uebernommen (nur einmal geladen)"
                zeilen.append([gruppe, t, wname or r.get("Name", ""), d["date"].iloc[0],
                               d["date"].iloc[-1], len(d), r.get("Waehrung", ""), hinweis])
                continue
            geladen = True
            df, wae, yname, fehler = hole(t)
            name = wname or yname
            if df is None:
                zeilen.append([gruppe, t, name, "", "", 0, wae, fehler])
                print(f"  FEHLT  {t}: {fehler}")
                continue
            d = aufbereiten(df)
            if d.empty:
                zeilen.append([gruppe, t, name, "", "", 0, wae, "nur leere Zeilen"])
                print(f"  FEHLT  {t}: nur leere Zeilen")
                continue
            d.to_csv(pfad, index=False)
            zeilen.append([gruppe, t, name, d["date"].iloc[0], d["date"].iloc[-1], len(d), wae, ""])
            print(f"  ok     {t}: {d['date'].iloc[0]} bis {d['date'].iloc[-1]}, {len(d)} Zeilen, {wae}")
        speichere(gruppe, zeilen)
        print(f"-- {min(i + PAKET, len(liste))}/{len(liste)} erledigt")
        if geladen:
            time.sleep(PAUSE)
    teile = packe(gruppe)
    u = pd.DataFrame(zeilen, columns=SP)
    fehlt = u[u["Zeilen"].astype(int) == 0]
    print(f"\n{gruppe}: {len(u) - len(fehlt)} von {len(u)} geladen. ZIP: {', '.join(teile)}")
    if len(fehlt):
        print("Yahoo liefert NICHT:")
        print(fehlt[["Ticker", "Name", "Fehlermeldung"]].to_string(index=False))
