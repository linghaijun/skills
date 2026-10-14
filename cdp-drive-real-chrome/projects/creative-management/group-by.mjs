// Ads 页 Group by：点开下拉 → 点选项（真实鼠标）→ 等加载 → **读回 groupByValue 校验**
//   CDP_TARGET=<id> node group-by.mjs "Asset - Ad Type - Ad"
// 选项（Video）：Asset - Ad / Asset - Ad Type - Ad / Ad；Image 另有 Asset Group - …
// 🔴 别在宽视口（CDP_VIEWPORT=wide）下用：弹出层坐标会算错，选项叠在一点、点了不生效（SCRIPTS.md 坑 26）
// 🔴 Group by 记忆存 localStorage（userid_<uid>_groupBy__CreativePage，同实例各标签共享）
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
import { makeBusyGone, waitBusyGone } from "./wait-lib.mjs";
const want = process.argv[2]; const c = await connect();
const busyGone = makeBusyGone(c);
const label = () => c.ev(`(() => { window.scrollTo(0,0); const e=[...document.querySelectorAll('span')].find(e=>e.childElementCount===0 && /^(Asset|Ad|Asset Group)( - .*)?$/.test(e.textContent.trim()) && e.getBoundingClientRect().width>0 && !e.closest('.surely-table,.pacvue-table-title-cell')); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {t:e.textContent.trim(), x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
const cur = await label(); if (!cur) { console.error("group-by control not found"); process.exit(3); }
if (cur.t === want) { console.log("already", want); c.close(); process.exit(0); }
let opt = null;
for (let attempt = 0; attempt < 3 && !opt; attempt++) {   // 下拉偶发没打开：重点一次
  await c.click(await label()); await c.sleep(1200);
  opt = await c.ev(`(() => { const e=[...document.querySelectorAll('.pacvue-dropdown-itemLi')].find(e=>e.getBoundingClientRect().width>0 && e.textContent.trim()===${JSON.stringify(want)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
}
if (!opt) { console.error("option not found: " + want); process.exit(4); }
await c.click(opt);
await waitBusyGone(c, busyGone, { minTicks: 4, label: "group-by" });
await c.ev(fs.readFileSync(new URL("./ads-table-attach.js", import.meta.url), "utf8"));
const gv = await c.ev(`window.__ct && window.__ct.groupByValue`);
console.log(JSON.stringify({ from: cur.t, to: want, groupByValue: gv })); c.close();
