// Ads / Tag 页「同环比 Compare」三合一（2026-10-13 由 compare-on / compare-off / compare-custom 合并；旧文件保留为一行转调，旧命令照常可用）
//
//   CDP_TARGET=<id> node compare.mjs on <outDir> [--prefix fix-r1-]
//       日期面板 → 真实勾 Compare → 截图面板 → Apply；记录 getAssetList / getGroupPlatformCreativeTrend 请求体（证明 compareStartDate 由 UI 下发）
//       产出 <outDir>/<prefix>01-compare-panel.png、<outDir>/<prefix>02-compare-requests.json（prefix 默认 fix-r1-，与旧 compare-on.mjs 文件名一致）
//       🔴 别再用挂钩 XHR 改写请求体的老办法（那是构造，不是 UI 下发）
//   CDP_TARGET=<id> node compare.mjs off
//       日期面板里若 Compare 已勾则真实点掉 → Apply → 等加载结束；输出 { wasChecked, compareCheckedAfter }
//   CDP_TARGET=<id> CDP_VIEWPORT=wide node compare.mjs custom "06/01/2026~06/30/2026" [out.json]
//       面板已开且 Compare 已勾：在对比区（.compare-area）输入自定义对比期 → Enter → Apply → 等加载；记录请求体 start/end/compareStart/compareEnd
//       用途：对比期晚于当期这类「上一周期」给不出的组合（例：05 当期 vs 06 对比，取下降样本）
//
// 🔴 Compare 复选框 / 对比区在 2560 视口下宽度为 0（面板底栏被收起）→ 开 / 关 / 自定义对比都用 CDP_VIEWPORT=wide
// 🔴 宽视口下别的弹出层（Group by 下拉）坐标会算错 —— 只在这里用宽视口，切分组回正常视口（README「本页实测的坑」5）
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";

const argv = process.argv.slice(2);
const mode = argv[0];
const pi = argv.indexOf("--prefix"); const PREFIX = pi >= 0 ? argv[pi + 1] : "fix-r1-";
const pos = argv.filter((a, i) => i > 0 && a !== "--prefix" && argv[i - 1] !== "--prefix");
if (!["on", "off", "custom"].includes(mode)) { console.error('usage: node compare.mjs on <outDir> [--prefix fix-r1-] | off | custom "<MM/DD/YYYY~MM/DD/YYYY>" [out.json]'); process.exit(2); }

const c = await connect();
const MASK = `[...document.querySelectorAll(".el-loading-mask,.pacvue-loading-mask")].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=="none"`;
const busy = (skipOverlay = true) => c.ev(MASK + (skipOverlay ? `&&!e.closest('.el-dialog,.el-drawer')` : "") + "})");
const waitIdle = async (skipOverlay) => { for (let k = 0; k < 180; k++) { await c.sleep(1000); if (!(await busy(skipOverlay)) && k > 3) break; } };
const CB = `[...document.querySelectorAll('.cus_checkout')].find(e=>e.getBoundingClientRect().width>0 && e.textContent.trim()==='Compare')`;
const openPanel = async () => {
  await c.ev("window.scrollTo(0,0)");
  if (!(await c.ev(`!!${CB}`))) { const d = await c.ev(`(() => { const e=document.querySelector('.reportrange-text'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`); await c.click(d); await c.sleep(1500); }
  return c.ev(`(() => { const e=${CB}; const r=e.getBoundingClientRect(); return {x:r.x+10,y:r.y+r.height/2, checked: !!e.querySelector('input')?.checked}; })()`);
};
const APPLY = `(() => { const b=[...document.querySelectorAll('button')].find(b=>b.getBoundingClientRect().width>0 && b.textContent.trim()==='Apply'); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`;
const capture = (re, splitQuery) => {
  const reqs = new Map();
  c.on((m) => {
    if (m.method === "Network.requestWillBeSent" && re.test(m.params.request.url)) { const u = m.params.request.url.replace(/^https?:\/\/[^/]+/, ""); reqs.set(m.params.requestId, { url: splitQuery ? u.split("?")[0] : u, body: m.params.request.postData || "" }); }
    if (m.method === "Network.loadingFinished" && reqs.has(m.params.requestId)) reqs.get(m.params.requestId).done = true;
  });
  return reqs;
};

if (mode === "on") {
  const E = pos[0];
  if (!E) { console.error("need <outDir>"); process.exit(2); }
  await c.send("Network.enable", { maxPostDataSize: 200000 });
  const reqs = capture(/getAssetList|getGroupPlatformCreativeTrend/, false);
  const cb = await openPanel();
  if (!cb.checked) { await c.click(cb); await c.sleep(1500); }
  await c.shot(`${E}/${PREFIX}01-compare-panel.png`);
  const panel = await c.ev(`(() => { const p=[...document.querySelectorAll('.datepicker-container-left, .daterangepicker')].filter(e=>e.getBoundingClientRect().width>200).pop(); const root=p.closest('[class*=picker]')||p.parentElement; return root.innerText.split(String.fromCharCode(10)).map(s=>s.trim()).filter(s=>s && !/^[0-9\\t ]+$/.test(s) && !/^Su/.test(s)); })()`);
  await c.click(await c.ev(APPLY));
  await waitIdle(false); // 与旧 compare-on.mjs 一致：遮罩判定不排除抽屉 / 弹框
  const out = [];
  for (const [id, r] of reqs) {
    let b = {}; try { b = JSON.parse(r.body); } catch {}
    let resp = null; try { resp = (await c.send("Network.getResponseBody", { requestId: id })).body; } catch {}
    out.push({ url: r.url.split("?")[0], startDate: b.startDate, endDate: b.endDate, compareStartDate: b.compareStartDate, compareEndDate: b.compareEndDate, isCompare: b.isCompare ?? b.compare, respLen: resp && resp.length, respHasComparePerformance: !!resp && /comparePerformance/.test(resp) });
  }
  fs.writeFileSync(`${E}/${PREFIX}02-compare-requests.json`, JSON.stringify({ panel, requests: out }, null, 1));
  console.log(JSON.stringify({ panel: panel.slice(0, 20), requests: out }, null, 1));
} else if (mode === "off") {
  const cb = await openPanel();
  if (cb.checked) { await c.click(cb); await c.sleep(1000); }
  await c.click(await c.ev(APPLY));
  await waitIdle(true);
  const after = await c.ev(`[...document.querySelectorAll('.cus_checkout')].find(e=>e.textContent.trim()==='Compare')?.querySelector('input')?.checked ?? null`);
  console.log(JSON.stringify({ wasChecked: cb.checked, compareCheckedAfter: after }));
} else {
  const [range, out] = pos;
  if (!range) { console.error('need "<MM/DD/YYYY~MM/DD/YYYY>"'); process.exit(2); }
  await c.send("Network.enable", { maxPostDataSize: 200000 });
  const reqs = capture(/getAssetList|getGroupPlatformCreativeTrend|getCreativeList|getCollectionCreativeList/, true);
  const inp = await c.ev(`(() => { const a=document.querySelector('.compare-area'); const i=a && [...a.querySelectorAll('input')].find(i=>i.placeholder==='Start Date ~ End Date' && i.getBoundingClientRect().width>0); if(!i) return null; const r=i.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2, before:i.value}; })()`);
  if (!inp) { console.error("compare-area input not found（面板没开 / Compare 没勾 / 视口不够宽）"); process.exit(3); }
  await c.click(inp); await c.sleep(300);
  await c.ev(`(() => { const i=document.activeElement; if(i && i.tagName==='INPUT') i.select(); return 1; })()`);
  await c.send("Input.insertText", { text: range });
  await c.key("Enter", "Enter", 13); await c.sleep(800);
  const after = await c.ev(`[...document.querySelector('.compare-area').querySelectorAll('input')].find(i=>i.placeholder==='Start Date ~ End Date').value`);
  const ap = await c.ev(APPLY);
  if (ap) await c.click(ap);
  await waitIdle(true);
  const list = [...reqs.values()].map((r) => { let b = {}; try { b = JSON.parse(r.body); } catch {} return { url: r.url, startDate: b.startDate, endDate: b.endDate, compareStartDate: b.compareStartDate, compareEndDate: b.compareEndDate, done: !!r.done }; });
  const res = { compareInputBefore: inp.before, compareInputAfter: after, applied: !!ap, range: await c.ev(`document.querySelector('.reportrange-text')?.textContent.trim()`), requests: list };
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
}
c.close();
