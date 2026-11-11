import json,sys
d=sys.argv[1]; ids=sys.argv[2].split(","); r=json.load(open(f"{d}/result.json")); st={s["id"]:s for s in r["strategies"]}
caps=r["caps"]; K=len(caps); wcap=r["capDist"]
P=lambda x:f"{100*x:5.1f}"
win=None
def ge10(i):
    e=json.load(open(f"{d}/cells/f_{i}.json"))["end"]; W=len(e)//K; s=n=l=0; worst=1
    for k,c in enumerate(caps):
        if c<10000: continue
        for w in range(W):
            g=(e[w*K+k]/c)**0.2-1 if e[w*K+k]>0 else -1; s+=g*wcap[k]; n+=wcap[k]; l+=(g<0)*wcap[k]; worst=min(worst,g)
    return s/n,l/n,worst
for i in ids:
    s=st[i];t=s["total"];sc=s["byScen"];g,l,w=ge10(i)
    print(f'{i:5} ab10k {P(g)} Verl {P(l)} schlecht {P(w)} | alle {P(t["avg"])} | H1 {P(sc["Start 1990–2005"]["avg"])} H2 {P(sc["Start 2006–2021"]["avg"])} | bär {P(sc["bärisch"]["avg"])} Bank {P(sc["Bankenkrise 2007–09"]["avg"])} Dot {P(sc["Dotcom-Blase 2000–02"]["avg"])} Cor {P(sc["Corona 2020"]["avg"])} | Tr {t["trades"]:.0f} | {s["name"]}')
