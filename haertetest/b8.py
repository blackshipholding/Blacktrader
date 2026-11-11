# B8 genau wie in src/lib/trainer/hardtest.ts (b8Hardtest), auf den Härtetest-Kunden ab 10.000 €.
# Aufruf: b8.py <dir> <basis-prefix> <kandidat-prefix> [teil: 0=alles 1=nur 1. Hälfte 2=nur 2. Hälfte]
import json,sys,bisect,datetime
d,base,cand=sys.argv[1:4]; part=int(sys.argv[4]) if len(sys.argv)>4 else 0
r=json.load(open(f"{d}/result.json")); caps=r["caps"]; K=len(caps); wc=r["capDist"]
utc=lambda s:int(datetime.datetime.strptime(s,"%Y-%m-%d").replace(tzinfo=datetime.timezone.utc).timestamp())
spx=[c for c in json.load(open(f"{d}/data/_SPX.json")) if c[0]>=utc("1988-01-01")]
cal=[c[0] for c in spx]; cl=[c[4] for c in spx]; N=len(cal)
at=lambda t: bisect.bisect_left(cal,t)
reg=[0]*N; s200=sum(cl[:200])
for i in range(200,N):
    s200+=cl[i]-cl[i-200]; m=s200/200; rr=cl[i]/cl[i-100]-1
    reg[i]=1 if cl[i]>m and rr>0.05 else -1 if cl[i]<m and rr<-0.05 else 0
pre=[0]
for x in reg: pre.append(pre[-1]+(x==-1))
starts=list(range(at(utc("1990-01-01")),at(utc("2021-11-10"))+1,5))
def end(w0):
    dt=datetime.datetime.fromtimestamp(cal[w0],datetime.timezone.utc); dt=dt.replace(year=dt.year+5) if not(dt.month==2 and dt.day==29) else dt.replace(year=dt.year+5,day=28)
    return min(at(int(dt.timestamp())),N-1)
bear=[(pre[end(w)+1]-pre[w])/(end(w)-w+1)>=0.15 for w in starts]
def stats(fn):
    j=json.load(open(f"{d}/cells/{fn}.json")); e=j["end"]; br=j["broke"]; W=len(e)//K; assert W==len(starts),(W,len(starts))
    g=[]
    for k,c in enumerate(caps):
        if c<10000: continue
        for w in range(W):
            if (part==1 and w>=W/2) or (part==2 and w<W/2): continue
            v=e[w*K+k]; g.append(((v/c)**0.2-1 if v>0 else -1, wc[k], w, br[w*K+k]))
    n=sum(x[1] for x in g); A=lambda L:(sum(a*b for a,b,*_ in L)/sum(b for _,b,*_ in L)) if L else 0
    o=sorted(g); acc=s5=0
    for a,b,*_ in o:
        if acc>=0.05*n: break
        t=min(b,0.05*n-acc); s5+=a*t; acc+=t
    return dict(avg=A(g),h1=A([x for x in g if x[2]<W/2]),h2=A([x for x in g if x[2]>=W/2]),bear=A([x for x in g if bear[x[2]]]),loss=sum(x[1] for x in g if x[0]<0)/n,worst5=s5/acc,broke=sum(x[1] for x in g if x[3])/n)
b,c=stats(f"{base}_f_P7"),stats(f"{cand}_f_P7")
P=lambda x:f"{100*x:.2f}"
ok=[]
def chk(name,good,txt): ok.append(good); print(f" {'✓' if good else '✗'} {name}: {txt}")
chk("mind. +0,2 Punkte p. a.",c["avg"]>=b["avg"]+0.002,f'{P(b["avg"])} → {P(c["avg"])}')
if part==0: chk("beide Zeithälften",c["h1"]>=b["h1"] and c["h2"]>=b["h2"],f'{P(b["h1"])}/{P(b["h2"])} → {P(c["h1"])}/{P(c["h2"])}')
chk("bärische Zeiträume",c["bear"]>=b["bear"],f'{P(b["bear"])} → {P(c["bear"])}')
chk("nicht mehr Verlust-Kunden",c["loss"]<=b["loss"],f'{P(b["loss"])} → {P(c["loss"])}')
chk("schlechteste 5 %",c["worst5"]>=b["worst5"],f'{P(b["worst5"])} → {P(c["worst5"])}')
chk("nicht mehr ausgeschieden",c["broke"]<=b["broke"],f'{P(b["broke"])} → {P(c["broke"])}')
dr=[(stats(f"{base}_d{k}_P7")["avg"],stats(f"{cand}_d{k}_P7")["avg"]) for k in range(1,6)]
chk("Ausfall mind. 4 von 5",sum(q>p for p,q in dr)>=4,f'{sum(q>p for p,q in dr)}/5 '+" ".join(f"{P(p)}→{P(q)}" for p,q in dr))
sb,sc=stats(f"{base}_st_P7"),stats(f"{cand}_st_P7")
chk("Kosten-Prüfung (Ø)",sc["avg"]>=sb["avg"],f'{P(sb["avg"])} → {P(sc["avg"])}')
print(" B8:", "BESTANDEN" if all(ok) else "NICHT bestanden")
print(f' [Zusatz, nicht Teil von B8] Kosten-Prüfung: Verlust-Kunden {P(sb["loss"])} → {P(sc["loss"])} | schlechteste 5 % {P(sb["worst5"])} → {P(sc["worst5"])} {"✓" if sc["worst5"]>=sb["worst5"] else "✗"} | bärisch {P(sb["bear"])} → {P(sc["bear"])}')
