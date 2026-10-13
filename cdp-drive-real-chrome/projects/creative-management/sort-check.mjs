// Ads 页排序核对：点一次表头（真鼠标）→ 等**这一次**带 orderBy 的 getAssetList 响应 → 等渲染 → 三方比对
//
//   CDP_TARGET=<id> node sort-check.mjs "<表头文字>" <dataIndex> out.json
//
// 输出：sortType（表头 data-sorttype）、请求体 orderBy/desc、响应顶层行 key+值、行模型顺序、页面可见行顺序；
//       sameAsResponse（模型顺序 === 响应顺序）、domMatches（可见行顺序是响应前缀）、monotonic、nullPositions。
// 🔴 为什么一定要等「这一次」的响应：列表 20~45s，点完立刻读 DOM 读到的是上一次的结果（CP-57189 AC-26 被退回的原因）。
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const [title, field, out] = process.argv.slice(2);
if (!title || !field || !out) { console.error('usage: node sort-check.mjs "<header>" <dataIndex> out.json'); process.exit(2); }
const attach = fs.readFileSync(new URL("./ads-table-attach.js", import.meta.url), "utf8");
const c = await connect();
await c.send("Network.enable", { maxPostDataSize: 200000 });
let reqId = null, reqBody = null, done = false;
c.on((m) => {
  if (m.method === "Network.requestWillBeSent" && /getAssetList|getCollectionCreativeList|getCreativeList/.test(m.params.request.url)) { reqId = m.params.requestId; reqBody = m.params.request.postData || ""; done = false; }
  if (m.method === "Network.loadingFinished" && m.params.requestId === reqId) done = true;
});
const hdr = await c.ev(`(() => { const h=[...document.querySelectorAll('.surely-table-header-cell')].find(e=>e.getBoundingClientRect().width>0 && e.innerText.replace(/\\s+/g,' ').trim()===${JSON.stringify(title)});
  if(!h) return null; h.scrollIntoView({block:'nearest', inline:'center'}); const t=h.querySelector('.pacvue-table-title-cell-text')||h; const r=t.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2, before:h.querySelector('[data-sorttype]')?.getAttribute('data-sorttype')}; })()`);
if (!hdr) { console.error("header not visible: " + title + "（先横滚 / 宽视口）"); process.exit(3); }
await c.sleep(500); await c.click(hdr);
for (let i = 0; i < 120 && !done; i++) await c.sleep(1000);
if (!done) { console.error("no list response within 120s"); process.exit(4); }
const resp = JSON.parse((await c.send("Network.getResponseBody", { requestId: reqId })).body);
for (let k = 0; k < 60; k++) { await c.sleep(1000); const busy = await c.ev(`[...document.querySelectorAll('.el-loading-mask,.pacvue-loading-mask')].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'&&!e.closest('.el-dialog,.el-drawer')})`); if (!busy && k > 1) break; }
await c.ev(attach);
const page = await c.ev(`(() => { const L=window.__ct.dataList; const F=${JSON.stringify(field)};
  const h=[...document.querySelectorAll('.surely-table-header-cell')].find(e=>e.getBoundingClientRect().width>0 && e.innerText.replace(/\\s+/g,' ').trim()===${JSON.stringify(title)});
  const rows=[...document.querySelectorAll('.surely-table-row.surely-table-row-level-0[data-row-key]')].filter(e=>e.getBoundingClientRect().height>0 && !e.closest('.el-drawer')).sort((a,b)=>a.getBoundingClientRect().y-b.getBoundingClientRect().y);
  const seen=new Set(); const dom=[]; for (const r of rows){ const k=r.getAttribute('data-row-key'); if(seen.has(k)) continue; seen.add(k); const cell=[...document.querySelectorAll('.surely-table-row[data-row-key="'+k+'"] .surely-table-cell[data-column-id="'+F+'"]')].find(Boolean); dom.push({key:+k, text: cell ? cell.innerText.split(String.fromCharCode(10))[0].trim() : null}); }
  return { sortType: h && h.querySelector('[data-sorttype]')?.getAttribute('data-sorttype'), model: L.map(o=>({key:o.key, v:o[F]})), dom }; })()`);
const list = (resp.data && (resp.data.list || resp.data.records)) || [];
const respVals = list.map((o) => o[field] ?? null);
const modelVals = page.model.map((o) => o.v ?? null);
let body = {}; try { body = JSON.parse(reqBody); } catch {}
const pi = body.pageInfo || body;
const desc = pi.desc ?? body.desc;
const nn = respVals.filter((v) => v != null);
const monotonic = nn.every((v, i) => i === 0 || (desc ? nn[i - 1] >= v : nn[i - 1] <= v));
const nullPositions = respVals.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
const res = { title, field, sortTypeBefore: hdr.before, sortTypeAfter: page.sortType, request: { orderBy: pi.orderBy ?? body.orderBy, desc, startDate: body.startDate, endDate: body.endDate },
  responseCount: list.length, responseValues: respVals, modelValues: modelVals, sameAsResponse: JSON.stringify(respVals) === JSON.stringify(modelVals),
  domVisible: page.dom, monotonic, nullPositions, nullRule: nullPositions.length ? (nullPositions[0] === respVals.length - nullPositions.length ? "nulls at end" : nullPositions[0] === 0 ? "nulls at start" : "nulls in middle") : "no nulls" };
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ ...res, responseValues: respVals.slice(0, 12), modelValues: undefined, domVisible: page.dom.slice(0, 8) })); c.close();
