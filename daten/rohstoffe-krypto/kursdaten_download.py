#!/usr/bin/env python3
"""
Kursdaten-Downloader: Rohstoff-Futures (Front-Month) und Kryptowährungen als Tageskerzen.

Ausgabe-Spalten immer genau: date, open, high, low, close, volume
  - date im Format YYYY-MM-DD
  - keine Lücken gefüllt, keine Prozentwerte
  - eine Datei pro Symbol + eine Sammeldatei mit Spalte "symbol" + uebersicht.csv

Installation (einmalig):
    pip install yfinance pandas requests

Aufruf:
    python kursdaten_download.py                 # alles (Rohstoffe + Krypto)
    python kursdaten_download.py --nur rohstoffe
    python kursdaten_download.py --nur krypto
    python kursdaten_download.py --kraken-ordner "C:/Downloads/Kraken_OHLCVT"   # zusätzlich Kraken-ZIP auswerten

Optionale kostenlose Schlüssel (als Umgebungsvariable setzen):
    STOOQ_APIKEY            -> Gold/Silber-Spotpreis von stooq (Schlüssel per Captcha auf stooq.com)
    CRYPTOCOMPARE_API_KEY   -> längste Krypto-Historie (kostenloses Konto auf cryptocompare.com)

Quellen und Bedingungen stehen in LIESMICH.md.
"""
import argparse, io, os, sys, time
from datetime import datetime, timezone

import pandas as pd
import requests

AUS = "kursdaten"            # Ausgabeordner
PAUSE = 1.5                  # Sekunden zwischen Anfragen (schont die Server, vermeidet Sperren)
UA = {"User-Agent": "Mozilla/5.0 (kursdaten_download.py; private Nutzung)"}
SPALTEN = ["date", "open", "high", "low", "close", "volume"]

# ---------------------------------------------------------------------------
# 1) ROHSTOFFE: Name -> (Yahoo-Ticker-Kandidaten, Börse, Einheit/Währung)
#    Yahoo "=F" = fortlaufende Front-Month-Reihe, NICHT rollierend bereinigt.
# ---------------------------------------------------------------------------
ROHSTOFFE = {
    "Gold":             (["GC=F"],  "COMEX", "USD je Feinunze"),
    "Silber":           (["SI=F"],  "COMEX", "USD je Feinunze"),
    "Platin":           (["PL=F"],  "NYMEX", "USD je Feinunze"),
    "Palladium":        (["PA=F"],  "NYMEX", "USD je Feinunze"),
    "Kupfer":           (["HG=F"],  "COMEX", "USD je Pfund"),
    "Aluminium":        (["ALI=F"], "COMEX", "USD je Tonne"),
    "WTI_Oel":          (["CL=F"],  "NYMEX", "USD je Barrel"),
    "Brent_Oel":        (["BZ=F"],  "NYMEX", "USD je Barrel"),
    "Erdgas_HenryHub":  (["NG=F"],  "NYMEX", "USD je MMBtu"),
    "Benzin_RBOB":      (["RB=F"],  "NYMEX", "USD je Gallone"),
    "Heizoel":          (["HO=F"],  "NYMEX", "USD je Gallone"),
    "Mais":             (["ZC=F"],  "CBOT",  "US-Cent je Scheffel"),
    "Weizen":           (["ZW=F"],  "CBOT",  "US-Cent je Scheffel"),
    "Sojabohnen":       (["ZS=F"],  "CBOT",  "US-Cent je Scheffel"),
    "Sojaoel":          (["ZL=F"],  "CBOT",  "US-Cent je Pfund"),
    "Sojaschrot":       (["ZM=F"],  "CBOT",  "USD je Short-Ton"),
    "Hafer":            (["ZO=F"],  "CBOT",  "US-Cent je Scheffel"),
    "Reis":             (["ZR=F"],  "CBOT",  "USD je Zentner (cwt)"),
    "Kaffee":           (["KC=F"],  "ICE US", "US-Cent je Pfund"),
    "Zucker":           (["SB=F"],  "ICE US", "US-Cent je Pfund"),
    "Kakao":            (["CC=F"],  "ICE US", "USD je Tonne"),
    "Baumwolle":        (["CT=F"],  "ICE US", "US-Cent je Pfund"),
    "Orangensaft":      (["OJ=F"],  "ICE US", "US-Cent je Pfund"),
    "Lebendrind":       (["LE=F"],  "CME",   "US-Cent je Pfund"),
    "Mastrind":         (["GF=F"],  "CME",   "US-Cent je Pfund"),
    "Magerschwein":     (["HE=F"],  "CME",   "US-Cent je Pfund"),
    "Holz":             (["LBR=F", "LBS=F"], "CME", "USD je 1000 Board-Fuß"),
    "Milch_ClassIII":   (["DC=F"],  "CME",   "USD je Zentner (cwt)"),
    # Zusätzlich
    "Kohle_Rotterdam":  (["MTF=F"], "ICE/NYMEX", "USD je Tonne"),
    "Uran":             (["UX=F"],  "COMEX", "USD je Pfund U3O8"),
    "Eisenerz_62Fe":    (["TIO=F"], "COMEX", "USD je Tonne"),
    "Ethanol":          (["CU=F"],  "NYMEX", "USD je Gallone"),
}
# Spotpreise (stooq, kostenloser Schlüssel nötig). Yahoo-Spot als Ersatz, falls vorhanden.
SPOT = {
    "Gold_Spot":   ("xauusd", ["XAUUSD=X"], "USD je Feinunze"),
    "Silber_Spot": ("xagusd", ["XAGUSD=X"], "USD je Feinunze"),
}

# ---------------------------------------------------------------------------
# 2) KRYPTO: Symbol -> Yahoo-Kandidaten (Yahoo hängt bei Namensgleichheit Zahlen an)
#    Alle Coins mit Handel seit spätestens ca. 2020 (>= 6 Jahre Historie).
# ---------------------------------------------------------------------------
KRYPTO = {
    "BTC": ["BTC-USD"], "ETH": ["ETH-USD"], "XRP": ["XRP-USD"], "LTC": ["LTC-USD"],
    "XLM": ["XLM-USD"], "DOGE": ["DOGE-USD"], "DASH": ["DASH-USD"], "XMR": ["XMR-USD"],
    "ETC": ["ETC-USD"], "ZEC": ["ZEC-USD"], "BCH": ["BCH-USD"], "ADA": ["ADA-USD"],
    "TRX": ["TRX-USD"], "BNB": ["BNB-USD"], "EOS": ["EOS-USD"], "NEO": ["NEO-USD"],
    "IOTA": ["IOTA-USD", "MIOTA-USD"], "LINK": ["LINK-USD"], "VET": ["VET-USD"],
    "QTUM": ["QTUM-USD"], "XTZ": ["XTZ-USD"], "ATOM": ["ATOM-USD", "ATOM1-USD"],
    "ALGO": ["ALGO-USD"], "DOT": ["DOT-USD", "DOT1-USD", "DOT6636-USD"],
    "SOL": ["SOL-USD", "SOL1-USD", "SOL16116-USD"], "AVAX": ["AVAX-USD", "AVAX5805-USD"],
    "UNI": ["UNI-USD", "UNI7083-USD", "UNI1-USD", "UNI3-USD"],
    # weitere mit mindestens ~6 Jahren Historie
    "BSV": ["BSV-USD"], "XEM": ["XEM-USD"], "WAVES": ["WAVES-USD"], "DCR": ["DCR-USD"],
    "DGB": ["DGB-USD"], "SC": ["SC-USD"], "ZIL": ["ZIL-USD"], "ICX": ["ICX-USD"],
    "ONT": ["ONT-USD"], "BAT": ["BAT-USD"], "ZRX": ["ZRX-USD"], "OMG": ["OMG-USD"],
    "LSK": ["LSK-USD"], "STEEM": ["STEEM-USD"], "XVG": ["XVG-USD"], "RVN": ["RVN-USD"],
    "NANO": ["XNO-USD", "NANO-USD"], "HBAR": ["HBAR-USD"], "THETA": ["THETA-USD"],
    "MKR": ["MKR-USD"], "SNX": ["SNX-USD"], "AAVE": ["AAVE-USD", "AAVE7278-USD"],
    "COMP": ["COMP-USD", "COMP5692-USD"], "YFI": ["YFI-USD"], "KSM": ["KSM-USD"],
    "FIL": ["FIL-USD"], "NEAR": ["NEAR-USD"], "CRO": ["CRO-USD"], "LEO": ["LEO-USD"],
    "OKB": ["OKB-USD"], "KCS": ["KCS-USD"], "HT": ["HT-USD", "HTX-USD"],
    "ENJ": ["ENJ-USD"], "MANA": ["MANA-USD"], "CHZ": ["CHZ-USD"], "ONE": ["ONE-USD", "ONE1-USD"],
    "FTM": ["FTM-USD", "S-USD"], "MATIC": ["MATIC-USD", "POL-USD"], "EGLD": ["EGLD-USD"],
    "XDC": ["XDC-USD"], "QNT": ["QNT-USD"], "KAVA": ["KAVA-USD"], "CELO": ["CELO-USD"],
    "BTG": ["BTG-USD"],
}

# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------
def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def normalisieren(df: pd.DataFrame) -> pd.DataFrame:
    """Auf genau date,open,high,low,close,volume bringen. Nichts auffüllen."""
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=SPALTEN)
    d = df.copy()
    if isinstance(d.columns, pd.MultiIndex):           # yfinance liefert teils MultiIndex
        d.columns = [c[0] for c in d.columns]
    d.columns = [str(c).strip().lower() for c in d.columns]
    if "date" not in d.columns:
        d = d.reset_index()
        d.columns = [str(c).strip().lower() for c in d.columns]
        d = d.rename(columns={"index": "date", "datetime": "date"})
    dt = d["date"]
    if not pd.api.types.is_datetime64_any_dtype(dt):
        dt = pd.to_datetime(dt, errors="coerce", utc=False)
    if getattr(dt.dt, "tz", None) is not None:
        dt = dt.dt.tz_localize(None)        # Handelstag in der Zeitzone der Börse behalten
    d["date"] = dt.dt.strftime("%Y-%m-%d")
    for c in SPALTEN[1:]:
        if c not in d.columns:
            d[c] = pd.NA
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d = d[SPALTEN].dropna(subset=["date"])
    d = d.dropna(subset=["open", "high", "low", "close"], how="all")
    d = d[d["close"].notna() & (d["close"] > 0)]
    d = d.drop_duplicates(subset="date", keep="last").sort_values("date").reset_index(drop=True)
    return d


def speichern(df, ordner, name):
    os.makedirs(ordner, exist_ok=True)
    pfad = os.path.join(ordner, f"{name}.csv")
    df.to_csv(pfad, index=False, float_format="%.10g")
    return pfad


def get(url, params=None, versuche=4):
    for i in range(versuche):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=60)
            if r.status_code == 429:
                warte = 30 * (i + 1)
                log(f"  Zu viele Anfragen (429) – warte {warte}s")
                time.sleep(warte); continue
            return r
        except requests.RequestException as e:
            log(f"  Netzwerkfehler: {e} – neuer Versuch")
            time.sleep(10 * (i + 1))
    return None

# ---------------------------------------------------------------------------
# Quellen
# ---------------------------------------------------------------------------
def yahoo(ticker):
    """Yahoo Finance über yfinance, gesamte Historie, unbereinigt (auto_adjust=False)."""
    import yfinance as yf
    for i in range(4):
        try:
            df = yf.Ticker(ticker).history(period="max", interval="1d", auto_adjust=False, actions=False)
            time.sleep(PAUSE)
            return normalisieren(df)
        except Exception as e:
            msg = str(e)
            if "Rate" in msg or "429" in msg or "Too Many" in msg:
                warte = 60 * (i + 1)
                log(f"  Yahoo drosselt – warte {warte}s"); time.sleep(warte); continue
            log(f"  Yahoo-Fehler {ticker}: {msg[:120]}")
            return normalisieren(None)
    return normalisieren(None)


def yahoo_erster_treffer(kandidaten):
    for t in kandidaten:
        df = yahoo(t)
        if len(df):
            return t, df
    return (kandidaten[0] if kandidaten else ""), normalisieren(None)


def stooq(symbol):
    key = os.environ.get("STOOQ_APIKEY", "").strip()
    if not key:
        return normalisieren(None), "kein STOOQ_APIKEY gesetzt"
    r = get("https://stooq.com/q/d/l/", {"s": symbol, "i": "d", "apikey": key})
    time.sleep(PAUSE)
    if r is None or r.status_code != 200 or not r.text.lower().startswith(("date", "data")):
        return normalisieren(None), "stooq lieferte keine CSV (Schlüssel/Tageslimit prüfen)"
    d = pd.read_csv(io.StringIO(r.text))
    d.columns = ["date", "open", "high", "low", "close"] + (["volume"] if len(d.columns) > 5 else [])
    return normalisieren(d), ""


def bitstamp_paare():
    r = get("https://www.bitstamp.net/api/v2/trading-pairs-info/")
    if r is None or r.status_code != 200:
        return set()
    return {p["url_symbol"] for p in r.json() if p.get("url_symbol", "").endswith("usd")}


def bitstamp(paar):
    """Bitstamp OHLC, 1000 Tage je Anfrage, ab 2011. Volumen in USD = Basisvolumen x Schlusskurs (Näherung)."""
    zeilen, start = [], int(datetime(2011, 1, 1, tzinfo=timezone.utc).timestamp())
    jetzt = int(time.time())
    while start < jetzt:
        r = get(f"https://www.bitstamp.net/api/v2/ohlc/{paar}/",
                {"step": 86400, "limit": 1000, "start": start, "exclude_current_candle": "true"})
        time.sleep(PAUSE)
        if r is None or r.status_code != 200:
            break
        ohlc = r.json().get("data", {}).get("ohlc", [])
        if not ohlc:
            start += 1000 * 86400; continue
        zeilen += ohlc
        letzter = max(int(x["timestamp"]) for x in ohlc)
        if letzter + 86400 <= start:
            break
        start = letzter + 86400
    if not zeilen:
        return normalisieren(None)
    d = pd.DataFrame(zeilen)
    d["date"] = pd.to_datetime(d["timestamp"].astype(int), unit="s", utc=True)
    for c in ["open", "high", "low", "close", "volume"]:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d["volume"] = d["volume"] * d["close"]
    d = d[d["volume"] > 0]                      # Tage ohne Handel nicht als Kerze
    return normalisieren(d)


def cryptocompare(sym):
    """CryptoCompare/CoinDesk aggregierter Index (CCCAGG), ab 2010. Volumen = volumeto (USD)."""
    key = os.environ.get("CRYPTOCOMPARE_API_KEY", "").strip()
    if not key:
        return normalisieren(None)
    zeilen, to_ts = [], None
    for _ in range(20):                         # 20 x 2000 Tage reicht für jede Historie
        p = {"fsym": sym, "tsym": "USD", "limit": 2000, "api_key": key}
        if to_ts:
            p["toTs"] = to_ts
        r = get("https://min-api.cryptocompare.com/data/v2/histoday", p)
        time.sleep(PAUSE)
        if r is None or r.status_code != 200 or r.json().get("Response") != "Success":
            break
        data = r.json()["Data"]["Data"]
        data = [x for x in data if (x.get("volumeto") or 0) > 0 or (x.get("close") or 0) > 0]
        if not data:
            break
        zeilen = data + zeilen
        erster = min(x["time"] for x in data)
        if to_ts is not None and erster >= to_ts:
            break
        to_ts = erster - 86400
    if not zeilen:
        return normalisieren(None)
    d = pd.DataFrame(zeilen)
    d = d[(d["open"] > 0) | (d["close"] > 0)]
    d = d[(d["volumeto"] > 0)]                  # vor dem ersten Handel liefert die API Nullen
    d["date"] = pd.to_datetime(d["time"], unit="s", utc=True)
    d["volume"] = d["volumeto"]
    return normalisieren(d)


def kraken_ordner(ordner):
    """Entpackte Kraken-OHLCVT-Dateien (<PAAR>_1440.csv) einlesen. Volumen USD = Basisvolumen x Schluss."""
    erg = {}
    if not ordner or not os.path.isdir(ordner):
        return erg
    for wurzel, _, dateien in os.walk(ordner):
        for f in dateien:
            if not f.endswith("_1440.csv"):
                continue
            paar = f[:-9].upper()                 # z.B. XBTUSD, ETHUSD, XDGUSD
            if not paar.endswith("USD") or paar.endswith(("USDT", "USDC")):
                continue
            basis = paar[:-3]
            if basis.endswith("Z") and len(basis) == 5:  # Altform XXBTZUSD -> XXBT
                basis = basis[:-1]
            basis = {"XBT": "BTC", "XXBT": "BTC", "XETH": "ETH", "XXRP": "XRP", "XLTC": "LTC",
                     "XXLM": "XLM", "XXDG": "DOGE", "XDG": "DOGE", "XXMR": "XMR", "XETC": "ETC",
                     "XZEC": "ZEC"}.get(basis, basis)
            try:
                d = pd.read_csv(os.path.join(wurzel, f), header=None,
                                names=["ts", "open", "high", "low", "close", "volume", "trades"])
            except Exception:
                continue
            d["date"] = pd.to_datetime(d["ts"], unit="s", utc=True)
            d["volume"] = d["volume"] * d["close"]
            n = normalisieren(d)
            if basis not in erg or len(n) > len(erg[basis]):
                erg[basis] = n
    return erg

# ---------------------------------------------------------------------------
# Abläufe
# ---------------------------------------------------------------------------
def info(symbol, name, quelle, ticker, df, waehrung, bereinigt, hinweis=""):
    return {"symbol": symbol, "name": name, "quelle": quelle, "ticker": ticker,
            "erster_tag": df["date"].iloc[0] if len(df) else "", "letzter_tag": df["date"].iloc[-1] if len(df) else "",
            "zeilen": len(df), "waehrung_einheit": waehrung, "rollierend_bereinigt": bereinigt, "hinweis": hinweis}


def lauf_rohstoffe():
    ordner = os.path.join(AUS, "rohstoffe")
    uebersicht, alle = [], []
    for name, (kand, boerse, einheit) in ROHSTOFFE.items():
        log(f"Rohstoff {name} …")
        ticker, df = yahoo_erster_treffer(kand)
        if len(df):
            speichern(df, ordner, name); alle.append(df.assign(symbol=name))
        uebersicht.append(info(name, f"{name} ({boerse})", "Yahoo Finance (yfinance)", ticker, df, einheit,
                               "nein – Front-Month verkettet, Sprünge am Rolltag",
                               "" if len(df) else "keine Daten erhalten"))
    for name, (stq, ykand, einheit) in SPOT.items():
        log(f"Spot {name} …")
        df, grund = stooq(stq); quelle, ticker = "stooq", stq
        if not len(df):
            ticker, df = yahoo_erster_treffer(ykand); quelle = "Yahoo Finance (yfinance)"
        if len(df):
            speichern(df, ordner, name); alle.append(df.assign(symbol=name))
        uebersicht.append(info(name, name, quelle, ticker, df, einheit, "entfällt (Spotpreis)",
                               grund if not len(df) else ""))
    if alle:
        pd.concat(alle)[["symbol"] + SPALTEN].to_csv(os.path.join(AUS, "rohstoffe_alle.csv"), index=False, float_format="%.10g")
    return uebersicht


def lauf_krypto(kraken_dir=None):
    ordner_q = os.path.join(AUS, "krypto_je_quelle")
    ordner = os.path.join(AUS, "krypto")
    uebersicht, alle = [], []
    log("Bitstamp-Paare abfragen …")
    bs = bitstamp_paare()
    kr = kraken_ordner(kraken_dir)
    if kraken_dir:
        log(f"Kraken-Ordner: {len(kr)} USD-Paare gefunden")
    for sym, ykand in KRYPTO.items():
        log(f"Krypto {sym} …")
        kandidaten = []
        ticker, df = yahoo_erster_treffer(ykand)
        if len(df):
            kandidaten.append(("Yahoo Finance", ticker, df)); speichern(df, os.path.join(ordner_q, "yahoo"), sym)
        paar = f"{sym.lower()}usd"
        if paar in bs:
            df = bitstamp(paar)
            if len(df):
                kandidaten.append(("Bitstamp", paar, df)); speichern(df, os.path.join(ordner_q, "bitstamp"), sym)
        df = cryptocompare(sym)
        if len(df):
            kandidaten.append(("CryptoCompare (CCCAGG)", f"{sym}/USD", df)); speichern(df, os.path.join(ordner_q, "cryptocompare"), sym)
        if sym in kr and len(kr[sym]):
            kandidaten.append(("Kraken (ZIP)", f"{sym}USD", kr[sym])); speichern(kr[sym], os.path.join(ordner_q, "kraken"), sym)
        # beste Quelle = früheste Historie (bei Gleichstand: mehr Zeilen). Keine Vermischung von Quellen.
        if kandidaten:
            q, t, best = sorted(kandidaten, key=lambda k: (k[2]["date"].iloc[0], -len(k[2])))[0]
            speichern(best, ordner, sym); alle.append(best.assign(symbol=sym))
            andere = "; ".join(f"{k[0]} ab {k[2]['date'].iloc[0]}" for k in kandidaten if k[0] != q)
            uebersicht.append(info(sym, sym, q, t, best, "USD", "entfällt", f"weitere: {andere}" if andere else ""))
        else:
            uebersicht.append(info(sym, sym, "-", "", normalisieren(None), "USD", "entfällt", "keine Daten erhalten"))
    if alle:
        pd.concat(alle)[["symbol"] + SPALTEN].to_csv(os.path.join(AUS, "krypto_alle.csv"), index=False, float_format="%.10g")
    return uebersicht


def main():
    global AUS
    ap = argparse.ArgumentParser(description="Rohstoff- und Krypto-Tageskerzen herunterladen")
    ap.add_argument("--nur", choices=["rohstoffe", "krypto"], help="nur einen Teil laden")
    ap.add_argument("--kraken-ordner", help="Ordner mit entpackten Kraken-OHLCVT-CSV-Dateien")
    ap.add_argument("--ausgabe", default="kursdaten", help="Ausgabeordner (Standard: kursdaten)")
    a = ap.parse_args()
    AUS = a.ausgabe
    os.makedirs(AUS, exist_ok=True)
    u = []
    if a.nur in (None, "rohstoffe"):
        u += lauf_rohstoffe()
    if a.nur in (None, "krypto"):
        u += lauf_krypto(a.kraken_ordner)
    pd.DataFrame(u).to_csv(os.path.join(AUS, "uebersicht.csv"), index=False)
    ok = sum(1 for x in u if x["zeilen"])
    log(f"Fertig: {ok} von {len(u)} Reihen geladen. Siehe {AUS}/uebersicht.csv")


if __name__ == "__main__":
    main()
