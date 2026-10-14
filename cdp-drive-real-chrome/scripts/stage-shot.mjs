// 布景 → 执行前置 JS → 等 → 截图 → 导单元格几何。一次连接做完，截图与几何同帧。
// 用途: 标注脚本（annotate.py / compose.py）要的是「精确单元格矩形」，
//       肉眼量坐标必错；本脚本用 --rects 导出后端算出的真值。
// 用法:
//   CDP_TARGET=<id> node stage-shot.mjs --out shot.png [--rects rects.json]      （或 --target <id>；二者都不给直接报错，不猜窗口）
//   node stage-shot.mjs --target <pageTargetId> --out shot.png [--rects rects.json]
//                       [--pre prep.js] [--w 1700] [--h 1100] [--wait 1500]
//                       [--sel <css>] [--text <str>]
//   --pre  脚本里可用 "__SEL__" / "__TEXT__" 占位符（自动替换成 --sel/--text 的 JSON 字符串）
//   --rects 额外导出 {vw,vh,hdr,rows[{y,cells:[{col,t,x,y,w,h}]}]}，供标注定位
//
// 依赖: 自拉 Chrome CDP；node 18+（用内置 fetch/WebSocket）
// 注意: 设视口后本脚本会打印 innerWidth 供核对 —— 本机实测 DeviceMetricsOverride
//       偶尔不生效，别默认「设了就是宽了」。
// 最后跑通: 2026-10-09
import fs from "node:fs";
import { connect, cliTargetOpts } from "./conn.mjs";

const flag = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const TARGET = flag("--target", "") || process.env.CDP_TARGET || "";
const OUT = flag("--out", "cdp-shot.png");
const PRE = flag("--pre", "");
const RECTS = flag("--rects", "");
const SEL = flag("--sel", "");
const TEXT = flag("--text", "");
const W = Number(flag("--w", 1700));
const H = Number(flag("--h", 1100));
const WAIT = Number(flag("--wait", 1500));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!TARGET) {
  console.error("usage: [CDP_TARGET=<id>] node stage-shot.mjs [--target <pageTargetId>] --out shot.png [--pre f.js] [--rects r.json]");
  console.error("提示: node cdp.mjs --list --port <n> 先拿 target id");
  process.exit(2);
}

// 连接统一走 conn.mjs（目标 = --target 实参 > CDP_TARGET；焦点模拟已在同一连接开启）
let c;
try { c = await connect({ ...cliTargetOpts(), target: TARGET }); } catch (e) { console.error("TARGET_NOT_FOUND: " + e.message); process.exit(2); }
const send = c.send;
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await sleep(900);

const ev = async (expr) => {
  const r = await send("Runtime.evaluate", {
    expression: `(async () => { return await (${expr}); })()`,
    awaitPromise: true, returnByValue: true, userGesture: true,
  }, 60000); // --pre 前置脚本可能在页面里等加载，沿用原 60s
  if (r.exceptionDetails) throw new Error("EVAL_THROW " + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result?.value;
};

const dims = await ev("({vw: innerWidth, vh: innerHeight})");
console.log("[viewport]", JSON.stringify(dims), dims.vw !== W ? "⚠️ 与请求不一致，DeviceMetrics 可能未生效" : "");

if (PRE) {
  let src = fs.readFileSync(PRE, "utf8");
  src = src.replaceAll('"__SEL__"', JSON.stringify(SEL)).replaceAll('"__TEXT__"', JSON.stringify(TEXT));
  console.log("[pre]", JSON.stringify(await ev(src)));
  await sleep(WAIT);
}

await c.shot(OUT, { captureBeyondViewport: false });
console.log("[shot]", OUT, fs.statSync(OUT).size, "bytes");

// 几何导出：表头按 x 排序，单元格按 top 聚行、按 left 就近归列（固定列/主体区两套 DOM 也准）
const RECT_EXPR = `(() => {
  const CFG = (typeof window !== "undefined" && window.__VTABLE_CFG) || {};
  const HS = CFG.header || ".surely-table-header-cell";
  const CS = CFG.cell || ".surely-table-cell";
  const BS = CFG.body || ".surely-table-body";
  const tx = (e) => (e.textContent || "").trim().replace(/\\s+/g, " ");
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const hdr = [...document.querySelectorAll(HS)].map(c => ({ title: tx(c), ...R(c) })).filter(h => h.title).sort((a, b) => a.x - b.x);
  const root = document.querySelector(BS) || document;
  const cells = [...root.querySelectorAll(CS)].map(c => ({ t: tx(c), ...R(c) })).filter(c => c.t);
  const rows = [];
  for (const c of cells) {
    let row = rows.find(r => Math.abs(r.y - c.y) < 4);
    if (!row) { row = { y: c.y, cells: [] }; rows.push(row); }
    row.cells.push(c);
  }
  rows.sort((a, b) => a.y - b.y);
  const out = rows.map(r => {
    const o = { y: r.y, cells: [] };
    for (const c of r.cells) {
      let best = null, bd = 1e9;
      for (const h of hdr) { const d = Math.abs(h.x - c.x); if (d < bd) { bd = d; best = h; } }
      if (best && bd < 40) o.cells.push({ col: best.title, t: c.t, x: c.x, y: c.y, w: c.w, h: c.h });
    }
    return o;
  });
  return JSON.stringify({ vw: innerWidth, vh: innerHeight, hdr, rows: out }, null, 1);
})()`;

const rects = await ev(RECT_EXPR);
if (RECTS && rects) { fs.writeFileSync(RECTS, rects, "utf8"); console.log("[rects]", RECTS, "rows=" + (JSON.parse(rects).rows.length)); }
c.close();
process.exit(0);
