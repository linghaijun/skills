// 同一连接内：日期面板 → 真实点击 Compare → 截图面板 → Apply；记录 creative/performance 请求体与响应（证明 compareStartDate 由 UI 下发）
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const E = process.argv[2]; const c = await connect();
const click = async (p) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 }); };
const shot = async (f) => { const s = await c.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(f, Buffer.from(s.data, "base64")); };
await c.send("Network.enable", { maxPostDataSize: 200000 }); const reqs = new Map();
c.on((m) => { if (m.method === "Network.requestWillBeSent" && /getAssetList|getGroupPlatformCreativeTrend/.test(m.params.request.url)) reqs.set(m.params.requestId, { url: m.params.request.url.replace(/^https?:\/\/[^/]+/, ""), body: m.params.request.postData || "" });
  if (m.method === "Network.loadingFinished" && reqs.has(m.params.requestId)) reqs.get(m.params.requestId).done = true; });
await c.ev("window.scrollTo(0,0)");
const open = await c.ev(`!![...document.querySelectorAll('.cus_checkout')].find(e=>e.getBoundingClientRect().width>0 && e.textContent.trim()==='Compare')`);
if (!open) { const d = await c.ev(`(() => { const e=document.querySelector('.reportrange-text'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`); await click(d); await c.sleep(1500); }
const cb = await c.ev(`(() => { const e=[...document.querySelectorAll('.cus_checkout')].find(e=>e.getBoundingClientRect().width>0 && e.textContent.trim()==='Compare'); const r=e.getBoundingClientRect(); return {x:r.x+10,y:r.y+r.height/2, checked: !!e.querySelector('input')?.checked}; })()`);
if (!cb.checked) { await click(cb); await c.sleep(1500); }
await shot(E + "/fix-r1-01-compare-panel.png");
const panel = await c.ev(`(() => { const p=[...document.querySelectorAll('.datepicker-container-left, .daterangepicker')].filter(e=>e.getBoundingClientRect().width>200).pop(); const root=p.closest('[class*=picker]')||p.parentElement; return root.innerText.split(String.fromCharCode(10)).map(s=>s.trim()).filter(s=>s && !/^[0-9\t ]+$/.test(s) && !/^Su/.test(s)); })()`);
const ap = await c.ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.getBoundingClientRect().width>0 && b.textContent.trim()==='Apply'); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
await click(ap);
for (let k = 0; k < 180; k++) { await c.sleep(1000); const busy = await c.ev(`[...document.querySelectorAll(".el-loading-mask,.pacvue-loading-mask")].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=="none"})`); if (!busy && k > 3) break; }
const out = []; for (const [id, r] of reqs) { let b = {}; try { b = JSON.parse(r.body); } catch {} let resp = null; try { resp = (await c.send("Network.getResponseBody", { requestId: id })).body; } catch {}
  out.push({ url: r.url.split("?")[0], startDate: b.startDate, endDate: b.endDate, compareStartDate: b.compareStartDate, compareEndDate: b.compareEndDate, isCompare: b.isCompare ?? b.compare, respLen: resp && resp.length, respHasComparePerformance: !!resp && /comparePerformance/.test(resp) }); }
fs.writeFileSync(E + "/fix-r1-02-compare-requests.json", JSON.stringify({ panel, requests: out }, null, 1)); console.log(JSON.stringify({ panel: panel.slice(0, 20), requests: out }, null, 1)); c.close();
