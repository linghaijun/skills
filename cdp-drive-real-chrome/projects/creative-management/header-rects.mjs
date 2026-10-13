// surely-table 表头按文字导出矩形（截图像素），供 annotate-legend.py 画框；顺带输出可见表头全集
//
//   CDP_TARGET=<id> node header-rects.mjs out.json "lab=表头1,表头2,…" ["lab2=…"]
//   每个 lab 取这些表头的外接框；表头文字按空白归一后精确匹配（「Video\nViews」= "Video Views"）
//   输出 { visible:[…可见表头…], rects:{lab:[x0,y0,x1,y1]}, missing:{lab:[没找到的表头]} }，并写 out.rects.json
// 🔴 missing 非空就别出图：说明有列没在视口里（先横滚 / 宽视口）或列名对不上 —— 这正是要验的东西
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const [out, ...specs] = process.argv.slice(2);
const want = Object.fromEntries(specs.map((s) => { const i = s.indexOf("="); return [s.slice(0, i), s.slice(i + 1).split(",")]; }));
const c = await connect();
const r = await c.ev(`(() => { const s=devicePixelRatio; const want=${JSON.stringify(want)};
  const cells=[...document.querySelectorAll('.surely-table-header-cell')].filter(e=>{const b=e.getBoundingClientRect(); return b.width>0 && b.height>0 && b.x>=0 && b.right<=innerWidth && !e.closest('.el-drawer,.el-dialog')});
  const norm=e=>e.innerText.replace(/\\s+/g,' ').trim(); const rects={}, missing={};
  for (const [lab, titles] of Object.entries(want)) { const hit=[], miss=[]; for (const t of titles) { const e=cells.find(x=>norm(x)===t); e ? hit.push(e.getBoundingClientRect()) : miss.push(t); }
    if (hit.length) rects[lab]=[Math.min(...hit.map(b=>b.x))*s, Math.min(...hit.map(b=>b.y))*s, Math.max(...hit.map(b=>b.right))*s, Math.max(...hit.map(b=>b.bottom))*s].map(Math.round);
    if (miss.length) missing[lab]=miss; }
  return { visible: cells.map(norm).filter(Boolean), rects, missing }; })()`);
fs.writeFileSync(out, JSON.stringify(r, null, 1)); fs.writeFileSync(out.replace(/\.json$/, ".rects.json"), JSON.stringify(r.rects));
console.log(JSON.stringify({ rects: r.rects, missing: r.missing })); c.close();
