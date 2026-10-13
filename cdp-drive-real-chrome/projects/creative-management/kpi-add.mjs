// Ads 页 KPI 卡片区：「+」卡片 → Custom Metrics 弹框池子里真实点击指标 → Apply（全程真鼠标，不调组件方法）
//
//   CDP_TARGET=<id> node kpi-add.mjs "Views at 25%" [--shot-dir <dir>]
//
// 输出：before / after 的卡片文本与 localStorage 里 showList（证明真的落盘了）。
// 🔴 不要用组件方法 updateShowList 注入勾选 —— 那是「构造」，证据验收会按「证据不实」退回（CP-57189 AC-11/13 实测被退）。
import { connect } from "../../scripts/conn.mjs";
const metric = process.argv[2]; const i = process.argv.indexOf("--shot-dir"); const dir = i > 0 ? process.argv[i + 1] : null;
if (!metric) { console.error('usage: node kpi-add.mjs "<metric label>"'); process.exit(2); }
const c = await connect();
const cards = () => c.ev(`[...document.querySelectorAll('.card-item')].filter(e=>e.offsetParent).map(e=>e.innerText.replace(/\\s+/g,' ').trim()).filter(Boolean)`);
const store = () => c.ev(`(() => { const k=Object.keys(localStorage).find(k=>/creative_performance_panel_showList_/.test(k)); return k ? {key:k, value:JSON.parse(localStorage[k])} : null; })()`);
const before = { cards: await cards(), store: await store() };
await c.ev("window.scrollTo(0,0)");
const add = await c.ev(`(() => { const e=[...document.querySelectorAll('.card-item')].filter(e=>e.offsetParent).find(e=>!e.innerText.trim()); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
if (!add) { console.error("找不到「+」卡片"); process.exit(3); }
await c.click(add); await c.sleep(2000);
const item = await c.ev(`(() => { const e=[...document.querySelectorAll('.pacvue-dialog span, .pacvue-dialog div')].find(e=>e.getBoundingClientRect().width>0 && e.textContent.trim()===${JSON.stringify(metric)}); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
if (!item) { console.error("弹框池子里没有该指标：" + metric); process.exit(4); }
await c.click(item); await c.sleep(1200);
if (dir) await c.shot(`${dir}/kpi-add-dialog-selected.png`);
const ap = await c.ev(`(() => { const b=[...document.querySelectorAll('.pacvue-dialog button')].find(b=>b.innerText.trim()==='Apply' && b.getBoundingClientRect().width>0); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
await c.click(ap); await c.sleep(3000);
const after = { cards: await cards(), store: await store() };
console.log(JSON.stringify({ metric, before, after }, null, 1)); c.close();
