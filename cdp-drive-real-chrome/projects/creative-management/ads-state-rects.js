// Ads 页「页面状态」证据的框坐标（截图像素）：Video / 平台页签、Group by、日期、Total 文案 + loading 遮罩数
// 🔴 loading > 0 或 Total 与列表响应对不上 = 中间态，不许截图当证据（实测：切页签 / reload 后旧列表的 Total 5116 残留了数秒）
// 输出喂 L0 annotate.py --rects（旧包装 annotate-rects.py 亦可）；键 total / video / amazon / groupby / date_box（平台页签只取了 Amazon，换平台改 txt(e) === "…"）
(() => { const d = devicePixelRatio; const R = e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(v => Math.round(v * d)); };
 const vis = e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
 const leaves = [...document.querySelectorAll("span,div,a,input")].filter(e => (e.childElementCount === 0 || e.tagName === "INPUT") && vis(e));
 const txt = e => e.tagName === "INPUT" ? e.value : e.textContent.trim();
 const pt = [...document.querySelectorAll("span.page-total")].find(vis); const tot = pt && ([...pt.children].find(c => /Total/.test(c.textContent)) || pt);
 const vid = leaves.find(e => txt(e) === "Video" && e.getBoundingClientRect().top > 250);
 const amz = leaves.find(e => txt(e) === "Amazon" && e.getBoundingClientRect().top > 250);
 const gb = leaves.find(e => txt(e) === "Ad" && e.getBoundingClientRect().left > 1550 && e.getBoundingClientRect().top > 400 && e.getBoundingClientRect().top < 560);
 const dt = leaves.find(e => /^\d{2}\/\d{2}\/\d{4}\s*~\s*\d{2}\/\d{2}\/\d{4}$/.test(txt(e)));
 const load = [...document.querySelectorAll(".el-loading-mask")].filter(e => vis(e) && getComputedStyle(e).display !== "none").length;
 const o = { total_text: tot && tot.textContent.trim(), loading: load, date_text: dt && txt(dt), groupby_text: gb && txt(gb) };
 if (tot) o.total = R(tot); if (vid) o.video = R(vid.parentElement); if (amz) o.amazon = R(amz.parentElement); if (gb) o.groupby = R(gb.parentElement); if (dt) o.date_box = R(dt);
 return JSON.stringify(o); })()
