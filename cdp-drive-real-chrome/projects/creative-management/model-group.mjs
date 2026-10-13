// Ads 页：导出某个顶层分组行（及其子行、孙行）的**原始数值**（行模型 dataList，非展示串），给 groupby-model-check.py 对账
//
//   CDP_TARGET=<id> node model-group.mjs --key 7 --out model-key7.json
//
// 为什么读模型不读 DOM：surely-table 虚拟滚动只渲染约 20 行，展开 100+ 子行时 DOM 拿不全；
// 模型是数值原值，DOM 是格式化后的（缩写模式下 471.2K 对账必然 DIFF）。
// DOM 侧证据用 cells.mjs（完整数字模式）另取，两者互为印证。
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const KEY = arg("--key"); const OUT = arg("--out", `model-key${KEY}.json`);
const FIELDS = ["key", "dimensionLabel", "showAdType", "productLine", "campaignType", "currencySymbol", "impressions", "clicks", "spend", "sales", "orders", "saleUnits",
  "pdpv", "pdpvRate", "ctr", "cpc", "cpm", "roas", "videoViews", "videoFirstQuartileViews", "videoMidpointViews", "videoThirdQuartileViews", "videoCompleteViews",
  "secondViews", "video5SecondViews", "video6SecondViews", "videoFirstQuartileRate", "videoMidpointRate", "videoThirdQuartileRate", "videoCompleteRate",
  "costPerView", "costPer2SecondView", "costPer5SecondView", "costPer6SecondView"];
const attach = fs.readFileSync(new URL("./ads-table-attach.js", import.meta.url), "utf8");
const c = await connect();
if (!(await c.ev(attach))) { console.error("CreativeTable not found（不在 Ads 页？）"); process.exit(3); }
const d = await c.ev(`(() => { const F=${JSON.stringify(FIELDS)}; const row=o=>F.map(k=>k in o ? o[k] : undefined);
  const L=window.__ct.dataList; const top=L.find(o=>String(o.key)===${JSON.stringify(String(KEY))}); if(!top) return {err:'no-row', keys:L.map(o=>o.key)};
  const tab=[...document.querySelectorAll('.file-type-tab')].map(e=>e.textContent.trim()+(/active/.test(e.className)?'*':'')).find(t=>t.includes('*'))||null;
  return { tab, groupBy: window.__ct.groupByValue, fields:F, parent:row(top), kids:(top.children||[]).map(row), grand:(top.children||[]).map(k=>(k.children||[]).map(row)) }; })()`);
if (d.err) { console.error(JSON.stringify(d).slice(0, 400)); process.exit(4); }
fs.writeFileSync(OUT, JSON.stringify(d, null, 1));
console.log(JSON.stringify({ out: OUT, tab: d.tab, groupBy: d.groupBy, kids: d.kids.length })); c.close();
