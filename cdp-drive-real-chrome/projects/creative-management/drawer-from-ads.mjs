// Ads 页：对 data-row-key=<key> 的素材行点「Asset Detail」（真鼠标）→ 抽屉切 Ad Performance → 等加载 → 读抽屉表格指定列
//
//   CDP_TARGET=<id> node drawer-from-ads.mjs <rowKey> out.json "Ad,Video Views,25% Video View Rate,Cost Per View,PDPV"
//
// 输出：抽屉标题区文本、日期、表头、每行指定列的文本，以及截图像素矩形（D_<列名> = 该列全部可见单元格外接框，date / tab）
// 抽屉组件与 Library / Dashboard 入口是同一个：@creativehub/components/AssetLibrary/DetailDrawer/index.vue（CreativeTable.vue 引用）
// 抽屉 Ad Performance 的列由抽屉自己的 Custom Column 决定（localStorage `__lastSearchColumn__CreativePerformanceDetail`），要读的列必须已勾选
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
import { makeBusyGone, waitBusyGone } from "./wait-lib.mjs";
const [rowKey, out, colsArg] = process.argv.slice(2); const want = colsArg.split(",");
const c = await connect();
// 这个脚本历史上「遮罩判定不排除抽屉」→ 用 overlay:true 对齐
const busyGone = makeBusyGone(c, { overlay: true, key: "__drawerTick" });
const drawerOpen = await c.ev(`!![...document.querySelectorAll('.el-drawer')].find(e=>e.getBoundingClientRect().width>0)`);
if (!drawerOpen) {
await c.ev(`window.__rk=${JSON.stringify(String(rowKey))}`);
await c.ev(fs.readFileSync(new URL("./row-to-top.js", import.meta.url), "utf8"));
const act = await c.ev(`(() => { const parts=[...document.querySelectorAll('.surely-table-row[data-row-key="${rowKey}"]')].filter(e=>e.getBoundingClientRect().height>0 && !e.closest('.el-drawer'));
  const cell=parts.map(p=>p.querySelector('.surely-table-cell[data-column-id="pacActionlist"]')).find(Boolean); const ic=cell && cell.querySelector('.el-icon'); if(!ic) return null; const r=ic.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
if (!act) { console.error("Asset Detail icon not found on row " + rowKey); process.exit(3); }
await c.click(act);
// 等抽屉出现：旧写法 30×1s 固定轮询；现在自适应轮询（出现即返回）
await c.waitFor("!![...document.querySelectorAll('.el-drawer')].find(e=>e.getBoundingClientRect().width>0)",
  { total: 30000, min: 200, max: 500, label: "drawer-open" })
  .catch(() => console.error("⚠ 抽屉 30s 内没出现，继续按旧行为往下走"));
await c.sleep(1500);
} // 抽屉已开着就直接复用（再点行操作会落在遮罩上）
// 抽屉会记住上次的页签：已经在 Ad Performance（有 Metrics 选择器）就不点
// 抽屉是异步组件，打开后内容要几秒才渲染 —— 轮询等页签出现（实测固定等 1.5s 不够）
let tab = null;
for (let k = 0; k < 20 && !tab; k++) { await c.sleep(1000); tab = await c.ev(`(() => { const d=[...document.querySelectorAll('.el-drawer')].find(e=>e.getBoundingClientRect().width>0); if(!d) return null;
  // 以激活页签判断（右上角 Metrics 选择器在 Basic Infomation 页也显示，不能当依据 —— 实测误判过）
  const active=[...d.querySelectorAll('.el-tabs__item.is-active')].find(e=>e.getBoundingClientRect().width>0);
  const already=!!active && active.textContent.trim()==='Ad Performance';
  if (already) return {already:true};
  const t=[...d.querySelectorAll('.el-tabs__item')].find(e=>e.textContent.trim()==='Ad Performance' && e.getBoundingClientRect().width>0); if(!t) return null; const r=t.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`); }
if (!tab) { console.error("Ad Performance tab not found"); process.exit(4); }
if (!tab.already) await c.click(tab);
await waitBusyGone(c, busyGone, { minTicks: 4, label: "drawer-from-ads" });
await c.sleep(1500);
// 抽屉表格列多，新增列在右侧外：横向滚到最右（DRAWER_HX=<px> 指定位置）再读与导矩形
await c.ev(`(() => { const d=[...document.querySelectorAll('.el-drawer')].find(e=>e.getBoundingClientRect().width>0); [...d.querySelectorAll('.surely-table-body, .surely-table-center-viewport')].forEach(e=>{ e.scrollLeft=${process.env.DRAWER_HX ?? "e.scrollWidth"}; e.dispatchEvent(new Event('scroll')); }); return 1; })()`);
await c.sleep(1500);
const r = await c.ev(`(() => { const s=devicePixelRatio; const d=[...document.querySelectorAll('.el-drawer')].find(e=>e.getBoundingClientRect().width>0); const want=${JSON.stringify(want)};
  const norm=e=>e.innerText.replace(/\\s+/g,' ').trim(); const R=b=>[b.x*s,b.y*s,b.right*s,b.bottom*s].map(Math.round);
  const hdrs=[...d.querySelectorAll('.surely-table-header-cell')].filter(e=>e.getBoundingClientRect().width>0);
  const headers=hdrs.map(norm); const rows=[...d.querySelectorAll('.surely-table-row[data-row-key]')].filter(e=>e.getBoundingClientRect().height>0);
  const byKey={}; rows.forEach(r=>{ const k=r.getAttribute('data-row-key'); (byKey[k]||(byKey[k]=[])).push(r); });
  const out=[], rects={};
  for (const [k, parts] of Object.entries(byKey)) { const row={key:k}; const cells=parts.flatMap(p=>[...p.querySelectorAll('.surely-table-cell')]).filter(e=>e.getBoundingClientRect().width>0);
    for (const w of want) { const h=hdrs.find(x=>norm(x)===w); if(!h) continue; const hx=h.getBoundingClientRect(); const cell=cells.find(cc=>{const b=cc.getBoundingClientRect(); return Math.abs(b.x-hx.x)<6 && Math.abs(b.right-hx.right)<6;});
      if(!cell) continue; row[w]=norm(cell); const b=cell.getBoundingClientRect(); const lab='D_'+w; const o=rects[lab]; const n=R(b); rects[lab]=o?[Math.min(o[0],n[0]),Math.min(o[1],n[1]),Math.max(o[2],n[2]),Math.max(o[3],n[3])]:n; }
    out.push(row); }
  const date=[...d.querySelectorAll('.reportrange-text')].find(e=>e.getBoundingClientRect().width>0); if(date) rects.date=R(date.getBoundingClientRect());
  return { title: d.innerText.split(String.fromCharCode(10)).slice(0,4).join(' | '), date: date && date.textContent.trim(), headers, rows: out, rects }; })()`);
fs.writeFileSync(out, JSON.stringify(r, null, 1)); fs.writeFileSync(out.replace(/\.json$/, ".rects.json"), JSON.stringify(r.rects));
console.log(JSON.stringify({ title: r.title, date: r.date, rows: r.rows })); c.close();
