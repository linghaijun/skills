/**
 * 虚拟滚动 / 固定列表格 —— 几何归位读取（返回 JSON 字符串，直接当 exprFile 跑）
 *
 * 用途: 表格有「固定列 + 主体区」两套 DOM 时，按 x 坐标猜列会全错
 *       （实测 fix-left 列与 body 列不共享坐标系，除首列外全读成 null）。
 *       正确做法: 取每个 cell 的 getBoundingClientRect()，按 top 聚成行、
 *       再按 left 就近归到表头列 —— 与 DOM 结构、虚拟滚动实现都无关。
 *
 * 用法:
 *   node cdp.mjs vtable-read.js
 *   node stage-shot.mjs --pre set-vtable.js --rects out.json    # 截图同时导几何
 *
 * 适配别的表格: 运行前设 window.__VTABLE_CFG（也可写个 --pre 脚本去设）:
 *   window.__VTABLE_CFG = { header: ".xxx-header-cell", cell: ".xxx-cell",
 *                           body: ".xxx-body", rowTol: 4, colTol: 40 };
 *   不设则用下面的默认值（Pacvue surely-table）。
 *
 * 依赖: 自拉 Chrome CDP（cdp.mjs 已默认开焦点模拟）
 * 最后跑通: 2026-10-09
 */
(() => {
  const CFG = (typeof window !== "undefined" && window.__VTABLE_CFG) || {};
  const SEL = {
    header: CFG.header || ".surely-table-header-cell",
    cell: CFG.cell || ".surely-table-cell",
    body: CFG.body || ".surely-table-body",
  };
  const ROW_TOL = CFG.rowTol || 4;   // 同一行的 top 容差(px)
  const COL_TOL = CFG.colTol || 40;  // 归列的 left 容差(px)，宁宽勿窄
  const WANT_IMG = CFG.withImg !== false;

  const tx = (e) => (e.textContent || "").trim().replace(/\s+/g, " ");
  const root = document.querySelector(SEL.body) || document;
  const hdr = [...document.querySelectorAll(SEL.header)]
    .map((c) => {
      const r = c.getBoundingClientRect();
      return { title: tx(c), left: Math.round(r.left), w: Math.round(r.width) };
    })
    .filter((h) => h.title)
    .sort((a, b) => a.left - b.left);
  if (!hdr.length) return JSON.stringify({ err: "no-header", selector: SEL.header });

  const cells = [...root.querySelectorAll(SEL.cell)].map((c) => {
    const r = c.getBoundingClientRect();
    const img = WANT_IMG ? c.querySelector("img") : null;
    return {
      top: Math.round(r.top),
      left: Math.round(r.left),
      t: tx(c),
      img: img ? img.getAttribute("src") : null,
    };
  }).filter((c) => c.t || c.img);

  // 按 top 聚行；固定列与主体区行高可能差 1~2px，所以要容差而不是相等
  const rowsMap = [];
  for (const c of cells) {
    let row = rowsMap.find((r) => Math.abs(r.top - c.top) < ROW_TOL);
    if (!row) { row = { top: c.top, cells: [] }; rowsMap.push(row); }
    row.cells.push(c);
  }
  rowsMap.sort((a, b) => a.top - b.top);

  const rows = rowsMap.map((r) => {
    const o = {};
    for (const c of r.cells) {
      let best = null, bd = 1e9;
      for (const h of hdr) {
        const d = Math.abs(h.left - c.left);
        if (d < bd) { bd = d; best = h; }
      }
      // 超出容差不硬塞：宁可留空也不要写进错误的列（错列比缺列更难发现）
      if (best && bd < COL_TOL && o[best.title] === undefined) o[best.title] = c.t || c.img;
    }
    return o;
  });
  return JSON.stringify({ cols: hdr.map((h) => h.title), rowCount: rows.length, rows }, null, 1);
})();
