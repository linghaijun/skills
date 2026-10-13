// 叶子行：comparePerformance[m] 与 (cur - prev)/prev*100 反算比对（prev 来自 comparePeriodValues）
(() => { const M = window.__metrics || ['videoViews','pdpv','impressions']; const res = {}; const bad = [];
 const walk = (o) => { const kids = o.children || []; if (!kids.length && o.comparePeriodValues && o.comparePerformance) for (const m of M) { const cur = o[m], prev = o.comparePeriodValues[m], got = o.comparePerformance[m];
     const r = res[m] ||= { checked: 0, ok: 0, prevZeroOrNull: 0, samples: [] };
     if (prev == null || prev === 0 || cur == null) { r.prevZeroOrNull++; continue; }
     const exp = Math.round(((cur - prev) / prev) * 10000) / 100; r.checked++; if (Math.abs(exp - got) <= 0.011) r.ok++; else bad.push({ key: o.key, m, cur, prev, got, exp });
     if (r.samples.length < 3) r.samples.push({ key: o.key, cur, prev, got, exp }); }
   kids.forEach(walk); };
 window.__ct.dataList.forEach(walk); return { window: 'cur ' + (document.querySelector('.reportrange-text')?.textContent.trim() || '?') + ' / compare 见同目录请求记录（compareStartDate/EndDate）', res, badN: bad.length, bad: bad.slice(0, 10) }; })()
