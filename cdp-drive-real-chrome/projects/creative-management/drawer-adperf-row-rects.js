// 素材详情抽屉 Ad Performance 表：逐行导出「Asset - Ad」格与 Ad Type 格的截图像素框（× dpr）+ 行文字 + 是否有 ID 行
// 键名 sb1_cell / sd2_type / dsp1_cell …（SB / SD Video、Streaming TV）；表格是 div 布局，不是 <table>，别用 th / tr 定位
// 截图前后各跑一次、cmp 一致才算同帧；输出直接喂 L0 annotate.py --rects（旧包装 annotate-rects.py 亦可；*_cell 右边界会跨进 Campaign 列，需要时裁到素材格宽度）
(() => {
  // 抽屉 Ad Performance 表：SD / SB 行的「Asset - Ad」格与 Ad Type 格，截图像素坐标（× dpr）
  const dpr = devicePixelRatio;
  const drawer = [...document.querySelectorAll(".el-drawer")].filter(d => d.getBoundingClientRect().width > 0).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
  if (!drawer) return "no drawer";
  const vis = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.bottom > 0 && b.top < innerHeight; };
  const leaves = [...drawer.querySelectorAll("a,span,div,td")].filter(e => e.childElementCount === 0 && vis(e));
  const cy = e => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; };
  const box = els => { const bs = els.map(e => e.getBoundingClientRect()); return [Math.min(...bs.map(b => b.left)), Math.min(...bs.map(b => b.top)), Math.max(...bs.map(b => b.right)), Math.max(...bs.map(b => b.bottom))].map(v => Math.round(v * dpr)); };
  const hdr = leaves.find(e => e.textContent.trim() === "Asset - Ad");
  const typeCells = leaves.filter(e => /^((SD|SB) - Video|Streaming TV)$/.test(e.textContent.trim()) && (!hdr || cy(e) > cy(hdr)));
  const out = {}; let nSD = 0, nSB = 0, nDSP = 0;
  for (const t of typeCells) {
    const tt = t.textContent.trim(); const kind = tt.startsWith("SD") ? "sd" : tt.startsWith("SB") ? "sb" : "dsp";
    const idx = kind === "sd" ? ++nSD : kind === "sb" ? ++nSB : ++nDSP;
    const imgs = [...drawer.querySelectorAll("img")].filter(i => vis(i) && Math.abs(cy(i) - cy(t)) < 35 && i.getBoundingClientRect().width > 40);
    const ad = leaves.filter(e => e !== t && Math.abs(cy(e) - cy(t)) < 35 && e.getBoundingClientRect().left < (imgs[0] ? imgs[0].getBoundingClientRect().right + 400 : 1100) && e.getBoundingClientRect().left > (imgs[0] ? imgs[0].getBoundingClientRect().left : 0));
    const adText = ad.filter(e => !/^((SD|SB) - Video|Streaming TV)$/.test(e.textContent.trim())).slice(0, 2);
    out[kind + idx + "_cell"] = box([...imgs.slice(0, 1), ...adText]);
    out[kind + idx + "_type"] = box([t]);
    out[kind + idx + "_text"] = adText.map(e => e.textContent.trim()).join(" ");
    const idLine = leaves.find(e => /^ID:?/.test(e.textContent.trim()) && Math.abs(cy(e) - cy(t)) < 35);
    out[kind + idx + "_hasIdLine"] = !!idLine;
  }
  const pg = [...drawer.querySelectorAll(".el-pager li.is-active")].map(e => e.textContent.trim());
  const total = leaves.find(e => /^Total \d+/.test(e.textContent.trim()));
  out.page = pg[0] || null; out.total = total ? total.textContent.trim() : null; out.dpr = dpr;
  return JSON.stringify(out);
})()
