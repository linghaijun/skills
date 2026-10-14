# -*- coding: utf-8 -*-
"""对 model-group.mjs 导出的行模型做父子/重算校验（原始数值，非展示串）。
用法: python groupby-model-check.py model-key8.json
"""
import json, sys

d = json.load(open(sys.argv[1], encoding="utf-8"))
F = d["fields"]
P = dict(zip(F, d["parent"]))
K = [dict(zip(F, r)) for r in d["kids"]]

def g(o, k):
    v = o.get(k)
    return None if v is None else v

print("分组: %s  维度=%s  子行=%d  label=%s" % (d["groupBy"], d["tab"], len(K), P.get("dimensionLabel")))
print()
ADD = ["impressions", "clicks", "spend", "sales", "pdpv", "videoViews", "videoFirstQuartileViews",
       "videoMidpointViews", "videoThirdQuartileViews", "videoCompleteViews", "secondViews",
       "video5SecondViews", "video6SecondViews"]
bad = 0
for k in ADD:
    pv = g(P, k)
    vs = [g(c, k) for c in K]
    seen = [v for v in vs if v is not None]
    s = sum(seen) if seen else None
    if pv is None and not seen:
        st = "OK(null)" if True else ""
        print("%-26s 父=%-16s 子求和=%-16s n=%-3d %s" % (k, None, None, 0, "OK(全空)"))
        continue
    ok = pv is not None and s is not None and abs(pv - s) <= max(1e-6, abs(s) * 1e-12)
    if pv is None and not seen: ok = True
    if not ok: bad += 1
    print("%-26s 父=%-16s 子求和=%-16s n=%-3d %s" % (k, pv, s, len(seen), "OK" if ok else "DIFF"))
print()
tot = lambda k: sum(v for v in (g(c, k) for c in K) if v is not None)
def avg(k):
    vs = [g(c, k) for c in K if g(c, k) is not None]
    return sum(vs) / len(vs) if vs else None
RAT = [("videoFirstQuartileRate", "videoFirstQuartileViews", "videoViews"),
       ("videoMidpointRate", "videoMidpointViews", "videoViews"),
       ("videoThirdQuartileRate", "videoThirdQuartileViews", "videoViews"),
       ("videoCompleteRate", "videoCompleteViews", "videoViews"),
       ("pdpvRate", "pdpv", "impressions"),
       ("ctr", "clicks", "impressions")]
print("%-24s %-14s %-18s %-18s" % ("列", "父行", "sum/sum 重算", "子行均值"))
for col, nu, de in RAT:
    den = tot(de)
    ss = (tot(nu) / den) * 100 if den else None
    print("%-24s %-14s %-18s %-18s" % (col, g(P, col), None if ss is None else round(ss, 6), None if avg(col) is None else round(avg(col), 6)))
for col, nu in [("costPerView", "videoViews"), ("costPer2SecondView", "secondViews"),
                ("costPer5SecondView", "video5SecondViews"), ("costPer6SecondView", "video6SecondViews")]:
    den = tot(nu)
    ss = tot("spend") / den if den else None
    print("%-24s %-14s %-18s %-18s" % (col, g(P, col), None if ss is None else round(ss, 6), None if avg(col) is None else round(avg(col), 6)))
print()
print("DELTA", [round(g(P, k) - tot(k), 6) if g(P, k) is not None else None for k in ["impressions", "spend", "videoViews"]])
print("DIFF count =", bad)
