# Kerzen aus Schlusskursen bauen (O = Vortagesschluss, H/L = max/min von O und C), Volumen neutral (1e6),
# offensichtliche Datenfehler bereinigen. Ausgabe: je Aktie JSON [[t,o,h,l,c,v],...] (t = Unix-Sekunden), Index ebenso.
import csv, json, sys, datetime, os
src, idx, out = sys.argv[1], sys.argv[2], sys.argv[3]
ts = lambda d: int(datetime.datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc).timestamp())
r = csv.reader(open(src)); hdr = next(r); tick = hdr[1:]; rows = list(r)
series = {t: [] for t in tick}
for row in rows:
    for i, v in enumerate(row[1:]):
        if v != "": series[tick[i]].append([row[0], float(v)])
fixes = []
def spike(t, day):  # Ein-Tages-Ausreißer: Wert durch Mittel der Nachbarn ersetzen
    s = series[t]
    for k in range(1, len(s) - 1):
        if s[k][0] == day:
            fixes.append(f"{t} {day}: {s[k][1]} -> Nachbarmittel"); s[k][1] = (s[k-1][1] + s[k+1][1]) / 2
def rescale_before(t, day):  # dauerhafter Sprung (falsche Bereinigung): alles davor angleichen
    s = series[t]
    for k in range(1, len(s)):
        if s[k][0] == day:
            f = s[k][1] / s[k-1][1]
            for j in range(k): s[j][1] *= f
            fixes.append(f"{t} vor {day}: x{f:.3f}")
# WMT 1974: zwei Wochen auf halbem Kurs und zurück (Datenfehler)
s = series["WMT"]
for k in range(len(s)):
    if "1974-12-06" <= s[k][0] <= "1974-12-17": s[k][1] *= 0.005 / 0.0024
fixes.append("WMT 06.–17.12.1974: auf Kursniveau davor/danach angehoben")
spike("DECK", "1998-10-13")
rescale_before("TSCO", "1994-02-18")
rescale_before("DHR", "2016-07-05")
os.makedirs(out, exist_ok=True)
meta = {}
for t, s in series.items():
    if len(s) < 300: continue
    c = []; prev = None
    for d, x in s:
        o = prev if prev is not None else x
        c.append([ts(d), round(o, 6), round(max(o, x), 6), round(min(o, x), 6), round(x, 6), 1e6]); prev = x
    json.dump(c, open(f"{out}/{t}.json", "w"), separators=(",", ":"))
    meta[t] = [s[0][0], s[-1][0], len(s)]
# Index: echte Kerzen ab 1962, davor O=H=L=C; Volumen echt
ic = []
for row in csv.DictReader(open(idx)):
    ic.append([ts(row["Date"]), float(row["Open"]), float(row["High"]), float(row["Low"]), float(row["Close"]), float(row["Volume"] or 0)])
json.dump(ic, open(f"{out}/_SPX.json", "w"), separators=(",", ":"))
json.dump({"meta": meta, "fixes": fixes}, open(f"{out}/_meta.json", "w"), ensure_ascii=False, indent=0)
print(len(meta), "Aktien mit >=300 Tagen;", *fixes, sep="\n")
