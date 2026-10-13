// 用法: node setdate.mjs "05/01/2026~05/31/2026" out.json —— 记录切换过程中发出的 creative/ 请求（含请求体与响应摘要）
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const [range, outFile] = process.argv.slice(2); const c = await connect();
await c.send("Network.enable", { maxPostDataSize: 65536 }); const reqs = new Map();
c.on((m) => { if (m.method === "Network.requestWillBeSent" && /creative|performance|tag\//i.test(m.params.request.url) && !/\.(js|css|vue|ts)(\?|$)/.test(m.params.request.url)) reqs.set(m.params.requestId, { url: m.params.request.url.replace(/^https?:\/\/[^/]+/, ""), body: (m.params.request.postData || "").slice(0, 600) });
  if (m.method === "Network.loadingFinished" && reqs.has(m.params.requestId)) reqs.get(m.params.requestId).done = true; });
const key = async (k, code, vk) => { for (const t of ["keyDown", "keyUp"]) await c.send("Input.dispatchKeyEvent", { type: t, key: k, code, windowsVirtualKeyCode: vk }); };
const before = await c.ev(`document.querySelector('.reportrange-text').textContent.trim()`);
const p = await c.ev(`(() => { const e=document.querySelector('.reportrange-text'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
await c.sleep(1200);
const ok = await c.ev(`(() => { const i=[...document.querySelectorAll('input')].find(i=>i.placeholder==='Start Date ~ End Date' && i.offsetParent); if(!i) return false; i.focus(); i.select(); return true; })()`);
if (!ok) { console.log("date input not found"); process.exit(3); }
await c.send("Input.insertText", { text: range }); await key("Enter", "Enter", 13); await c.sleep(800);
const ap = await c.ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent && b.textContent.trim()==='Apply'); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
if (ap) for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: ap.x, y: ap.y, button: "left", clickCount: 1 });
for (let k = 0; k < 180; k++) { const busy = await c.ev(`[...document.querySelectorAll(".el-loading-mask,.pacvue-loading-mask,.ant-spin-spinning")].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=="none"})`); if (!busy && k > 3) break; await c.sleep(1000); } await c.sleep(1500);
for (const [id, r] of reqs) { if (!r.done) continue; try { const b = await c.send("Network.getResponseBody", { requestId: id }); r.resp = b.body.slice(0, 1500); } catch (e) { r.resp = "(n/a)"; } }
const after = await c.ev(`document.querySelector('.reportrange-text').textContent.trim()`);
fs.writeFileSync(outFile, JSON.stringify({ before, after, requests: [...reqs.values()] }, null, 1)); console.log(before, "->", after, "requests", reqs.size, [...reqs.values()].map(r => r.url.split("?")[0]).join(" , ")); c.close();
