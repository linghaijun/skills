# 用法: python dom-check.py dom.json  —— 页面展示值（完整数字）口径下复核：次数=Σ、比率=Σ/Σ、单价=Σ花费/Σ播放
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))['rows']; keys = list(d); P = d[keys[0]]; K = [d[k] for k in keys[1:]]
n = lambda s: None if s in (None, '', '--') else float(s.replace('$', '').replace(',', '').replace('%', ''))
S = lambda c: sum(n(k[c]) for k in K if n(k.get(c)) is not None)
print('父行 key=%s，子行 %d 个（页面展示值，完整数字模式）' % (keys[0], len(K)))
for c in ['videoViews', 'videoFirstQuartileViews', 'video6SecondViews', 'spend']:
    print('%-26s 父=%-12s Σ子=%-12s %s' % (c, P[c], round(S(c), 2), 'OK' if abs(n(P[c]) - S(c)) < 0.006 else 'DIFF'))
rs = [n(k['videoFirstQuartileRate']) for k in K]; ss = S('videoFirstQuartileViews') / S('videoViews') * 100
print('%-26s 父=%-12s Σ分子/Σ分母=%.2f%%  子行均值=%.2f%%  -> %s' % ('videoFirstQuartileRate', P['videoFirstQuartileRate'], ss, sum(rs) / len(rs), 'OK(重算)' if abs(n(P['videoFirstQuartileRate']) - round(ss, 2)) < 0.006 else 'DIFF'))
cs = [n(k['costPerView']) for k in K]; cc = S('spend') / S('videoViews')
print('%-26s 父=%-12s Σ花费/Σ播放=$%.2f  子行均值=$%.2f  -> %s' % ('costPerView', P['costPerView'], cc, sum(cs) / len(cs), 'OK(重算)' if abs(n(P['costPerView']) - round(cc, 2)) < 0.006 else 'DIFF'))
