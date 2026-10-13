// 日期面板已打开且 Compare 已勾：在对比区（.compare-area）的日期输入框输入自定义对比期 → Enter → Apply → 等加载；
// 记录 getAssetList / getGroupPlatformCreativeTrend 请求体里的 start/end/compareStart/compareEnd（证明由 UI 下发）
//   CDP_TARGET=<id> CDP_VIEWPORT=wide node compare-custom.mjs "06/01/2026~06/30/2026" out.json
// 用途：对比期晚于当期这类「上一周期」给不出的组合（例：05 当期 vs 06 对比，取下降样本）
// 🔴 Compare 复选框 / 对比区在 2560 视口下宽度为 0，必须 CDP_VIEWPORT=wide
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const [range, out] = process.argv.slice(2); const c = await connect();
await c.send("Network.enable", { maxPostDataSize: 200000 }); const reqs = new Map();
c.on((m) => { if (m.method === "Network.requestWillBeSent" && /getAssetList|getGroupPlatformCreativeTrend|getCreativeList|getCollectionCreativeList/.test(m.params.request.url)) reqs.set(m.params.requestId, { url: m.params.request.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0], body: m.params.request.postData || "" });
  if (m.method === "Network.loadingFinished" && reqs.has(m.params.requestId)) reqs.get(m.params.requestId).done = true; });
const inp = await c.ev(`(() => { const a=document.querySelector('.compare-area'); const i=a && [...a.querySelectorAll('input')].find(i=>i.placeholder==='Start Date ~ End Date' && i.getBoundingClientRect().width>0); if(!i) return null; const r=i.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2, before:i.value}; })()`);
if (!inp) { console.error("compare-area input not found（面板没开 / Compare 没勾 / 视口不够宽）"); process.exit(3); }
await c.click(inp); await c.sleep(300);
await c.ev(`(() => { const i=document.activeElement; if(i && i.tagName==='INPUT') i.select(); return 1; })()`);
await c.send("Input.insertText", { text: range });
await c.key("Enter", "Enter", 13); await c.sleep(800);
const after = await c.ev(`[...document.querySelector('.compare-area').querySelectorAll('input')].find(i=>i.placeholder==='Start Date ~ End Date').value`);
const ap = await c.ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.getBoundingClientRect().width>0 && b.textContent.trim()==='Apply'); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
if (ap) await c.click(ap);
for (let k = 0; k < 180; k++) { await c.sleep(1000); const busy = await c.ev(`[...document.querySelectorAll(".el-loading-mask,.pacvue-loading-mask")].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=="none"&&!e.closest('.el-dialog,.el-drawer')})`); if (!busy && k > 3) break; }
const list = [...reqs.values()].map((r) => { let b = {}; try { b = JSON.parse(r.body); } catch {} return { url: r.url, startDate: b.startDate, endDate: b.endDate, compareStartDate: b.compareStartDate, compareEndDate: b.compareEndDate, done: !!r.done }; });
const res = { compareInputBefore: inp.before, compareInputAfter: after, applied: !!ap, range: await c.ev(`document.querySelector('.reportrange-text')?.textContent.trim()`), requests: list };
if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1)); console.log(JSON.stringify(res, null, 1)); c.close();
