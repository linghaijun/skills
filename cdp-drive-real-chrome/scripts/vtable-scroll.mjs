// 虚拟滚动表格的全量行收集：逐屏滚动 + 几何归位 + 按行内容去重。
// 为什么需要它：vtable-read.js / CDP 的 DOM 读法只能拿到**当前渲染**的行；
//   虚拟滚动只渲染可视区，分页/滚动验证必须靠本脚本收全量（否则「后 20 行有没有这条」无从判断）。
//
// 用法:
//   node vtable-scroll.mjs --port 9222 --match localhost:3001 --out rows.json [--max-rows 500]
//
// 参数:
//   --port <n>      CDP 端口，默认 9222
//   --target <id>   指定页面；不给则用 --match
//   --match <sub>   按 URL 子串选 target
//   --out <path>    落盘 JSON（必填，否则行数多时上下文爆掉）
//   --max-rows <n>  收集到 N 行就停，默认 500，防止无限滚动页跑飞
//   --hold <ms>     每屏滚动后等待，默认 260（虚拟滚动的懒加载渲染需要时间）
//   --cell <css>    单元格选择器，默认含 surely-table / el-table-v2
//   --hdr <css>     表头选择器
//   --body <css>    滚动容器选择器
//
// 输出结构: { total, truncated, scroller, screens, rows: [ {表头: 文本, ...} ] }
//
// 坑（本脚本已内建应对，但要知道）：
//  1. 去重按「整行 JSON」而非行号 —— 滚动后行会复用 DOM，索引不稳定。
//  2. 滚动容器不一定是 body：优先取 scrollHeight 明显大于 clientHeight 且 overflowY 是 auto/scroll 的最近祖先。
//  3. 步长别小于行高，否则会跳过整屏数据（漏行，且不报错 —— 最危险的一种漏）。
import fs from "node:fs";

function flag(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const PORT = Number(flag("--port", 9222));
const MATCH = flag("--match", "");
const OUT = flag("--out", "");
const MAX = Number(flag("--max-rows", 500));
const HOLD = Number(flag("--hold", 260));

if (!OUT) {
  console.error("MISSING --out");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = targets.filter((t) => t.type === "page");
let page;
const TARGET = flag("--target", "");
if (TARGET) {
  page = pages.find((t) => t.id === TARGET);
  if (!page) {
    console.error("TARGET_NOT_FOUND", TARGET);
    process.exit(2);
  }
} else {
  page = (MATCH ? pages.find((t) => String(t.url).includes(MATCH)) : null) || pages[0];
}
if (!page) {
  console.error("NO_PAGE_TARGET");
  process.exit(3);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 1;
const pend = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
});
const send = (method, params = {}, timeout = 60000) =>
  new Promise((resolve, reject) => {
    const i = id++;
    pend.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pend.has(i)) {
        pend.delete(i);
        reject(new Error("timeout " + method));
      }
    }, timeout);
  });

await new Promise((r, j) => {
  ws.addEventListener("open", r, { once: true });
  ws.addEventListener("error", j, { once: true });
});
try {
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
} catch {}

// 整个采集逻辑在页面里跑（含 await），一次性返回，避免逐屏往返。
const expr = `(async () => {
  const MAX = ${MAX}, HOLD = ${HOLD};
  const D_CELL = ${JSON.stringify(flag("--cell", ".surely-table-cell, .el-table-v2__row-cell"))};
  const D_HDR = ${JSON.stringify(flag("--hdr", ".surely-table-header-cell, .el-table-v2__header-cell"))};
  const D_BODY = ${JSON.stringify(flag("--body", ".surely-table-body, .el-table-v2__body"))};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tx = (e) => (e.textContent || "").trim().replace(/\\s+/g, " ");
  const R = (e) => e.getBoundingClientRect();

  const CELL_SEL = D_CELL, HDR_SEL = D_HDR, BODY_SEL = D_BODY;
  const has = (s) => s && s.indexOf(",") < 0 && s.charAt(0) !== ".";
  const pick = (primary, alt, label) => {
    const a = document.querySelector(primary);
    if (a) return a;
    const b = alt ? document.querySelector(alt) : null;
    if (b) return b;
    // 宁可失败也不要静默选中页面上别的东西 —— 隐藏的 0x0 残留节点会产出「看起来有数据其实是别的组件」
    return JSON.stringify({ __err: "no-table: " + label + " 未命中。若该页面用别的组件库，用 --cell/--hdr/--body 显式指定。" });
  };
  const hdrEls = [...document.querySelectorAll(HDR_SEL)]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((c) => ({ title: tx(c), left: R(c).left }))
    .filter((h) => h.title)
    .sort((a, b) => a.left - b.left);
  const body = pick(BODY_SEL, "", "body");
  if (typeof body === "string") return body;
  if (!document.querySelectorAll(CELL_SEL).length) {
    return JSON.stringify({ __err: "no-cells: cell 选择器未命中任何元素。" });
  }

  // 找最近的可滚动祖先
  let sc = body;
  {
    let cur = body;
    while (cur && cur !== document.body) {
      const st = getComputedStyle(cur);
      if (cur.scrollHeight - cur.clientHeight > 40 && /auto|scroll/.test(st.overflowY)) { sc = cur; break; }
      cur = cur.parentElement;
    }
    if (sc === body && body.scrollHeight - body.clientHeight > 40) sc = body;
  }

  const readOnce = () => {
    const cells = [...body.querySelectorAll(CELL_SEL)]
      .map((c) => { const r = R(c); return { top: r.top, left: r.left, t: tx(c) }; })
      .filter((c) => c.t);
    const groups = [];
    for (const c of cells) {
      let g = groups.find((x) => Math.abs(x.top - c.top) < 4);
      if (!g) { g = { top: c.top, cells: [] }; groups.push(g); }
      g.cells.push(c);
    }
    groups.sort((a, b) => a.top - b.top);
    return groups.map((g) => {
      const o = {};
      for (const c of g.cells) {
        let best = null, bd = 1e9;
        for (const h of hdrEls) { const d = Math.abs(h.left - c.left); if (d < bd) { bd = d; best = h; } }
        // 超容差留空，不硬塞 —— 错列比缺列更难发现
        if (best && bd < 40 && o[best.title] === undefined) o[best.title] = c.t;
      }
      return o;
    });
  };

  const seen = new Set();
  const all = [];
  const push = (rows) => {
    for (const r of rows) {
      if (!Object.keys(r).length) continue;
      const k = JSON.stringify(r);
      if (!seen.has(k)) { seen.add(k); all.push(r); }
    }
  };

  const startTop = sc.scrollTop;
  push(readOnce());
  const maxScroll = sc.scrollHeight;
  let screens = 0;

  // 用「当前可视高度」当步长，保证不会跳过整屏
  const step = Math.max(120, Math.floor(sc.clientHeight * 0.7));
  for (let y = 0; y <= maxScroll + step && all.length < MAX; y += step) {
    sc.scrollTop = y;
  screens++;
    await sleep(HOLD);
    push(readOnce());
    if (sc.scrollTop === y && y > 0) break; // 到底了
  }
  sc.scrollTop = startTop;

  return JSON.stringify({
    scroller: String(sc.className || sc.tagName || "").slice(0, 80),
    step, maxScroll, screens,
    total: all.length,
    truncated: all.length >= MAX,
    hdrCount: hdrEls.length,
    rows: all,
  });
})()`;

const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
if (r.exceptionDetails) {
  console.error("EVAL_THROW " + JSON.stringify(r.exceptionDetails).slice(0, 500));
  process.exit(3);
}
const payload = r.result?.value;
if (!payload) {
  console.error("EMPTY_RESULT");
  process.exit(3);
}
try {
  const probe = JSON.parse(payload);
  if (probe && probe.__err) {
    console.error("PAGE_ERROR " + probe.__err);
    process.exit(3);
  }
} catch {}
fs.writeFileSync(OUT, payload, "utf8");
const d = JSON.parse(payload);
console.log(
  JSON.stringify(
    {
      out: OUT,
      scroller: d.scroller,
      step: d.step,
      screens: d.screens,
      hdrCount: d.hdrCount,
      total: d.total,
      truncated: d.truncated,
      sample: d.rows.slice(0, 3),
    },
    null,
    1
  )
);
try {
  ws.close();
} catch {}
process.exit(0);