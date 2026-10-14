// 真鼠标点击：按「选择器 + 可见文本」定位元素中心，派发 CDP 真实鼠标事件。
// 三种真点击实现怎么选（权威说明见 references/SCRIPTS.md「三种点击」）：
//   - 本脚本：给「选择器 + 可见文本」，页签/下拉项这类「有稳定 class + 短文本」的元素最省事；--list 可先列候选
//   - cdp.mjs <expr.js> --realclick：expr 返回 Element，适合一次性的复杂定位
//   - L1 click-js.mjs <page.js>：page.js 返回 {x,y}，适合页面级脚本已算好坐标（如 full-number-toggle.js）
//
// 用法:
//   CDP_TARGET=<id> node real-click.mjs --sel ".platform-tab__btn" --text "Walmart"
//   node real-click.mjs --sel ".platform-tab__btn" --text "Walmart" [--target <id>]
//   node real-click.mjs --sel "button" --text "Search" --nth 1 --after 30000
//   node real-click.mjs --sel ".x" --text "Y" --list      # 只列出候选，不点（排查选择器）
//
// 参数:
//   --port <n>     CDP 端口，默认 CDP_PORT 或 9222
//   --target <id>  页面 target id；不给则读 CDP_TARGET（🔴 并行时必须二选一给）
//   --match <sub>  无 target 时按 URL 子串选 page，默认 CDP_MATCH 或 localhost；匹配不到报错
//   --sel <css>    必填，CSS 选择器
//   --text <str>   必填，元素可见文本（trim + 折叠空白后**全等**匹配）
//   --nth <n>      多个同名匹配时取第 n 个（从 0 起），默认 0
//   --dbl          双击
//   --after <ms>   点击后等待，默认 600
//   --list         列出该选择器下所有可见元素的文本后退出（不点）
//   --out <png>    点击后截图
//
// 为什么必须真鼠标事件：`el.click()` 只派发 JS 事件，很多组件（Popper/ElTooltip/拖拽）
// 监听的是 pointerdown/mousedown 或依赖坐标，JS click 静默无效 —— 表现为「点了没反应」。
import fs from "node:fs";
import { connect, cliTargetOpts } from "./conn.mjs";

function flag(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const has = (n) => process.argv.includes(n);

const SEL = flag("--sel", "");
const TEXT = flag("--text", "");
const NTH = Number(flag("--nth", 0));
const DBL = has("--dbl");
const AFTER = Number(flag("--after", 600));
const OUT = flag("--out", "");
const LIST = has("--list");

if (!SEL) {
  console.error("MISSING --sel");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 连接与目标解析统一走 conn.mjs：--target > CDP_TARGET > --match / CDP_MATCH（默认 localhost）；找不到直接报错，不再退回第一个 page
let c;
try { c = await connect(cliTargetOpts()); } catch (e) { console.error("NO_PAGE_TARGET " + e.message); process.exit(3); }
const send = c.send;
// 后台标签节流：conn.mjs 已在同一连接上开 setFocusEmulationEnabled

const ev = async (expr) => {
  const r = await send("Runtime.evaluate", {
    expression: `(() => { return (${expr}); })()`,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error("EVAL_THROW " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  }
  return r.result?.value;
};

const info = await ev(`(() => {
  const tx = (e) => (e.textContent || "").trim().replace(/\\s+/g, " ");
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const all = [...document.querySelectorAll(${JSON.stringify(SEL)})];
  const visible = all.filter(vis);
  if (${LIST ? "true" : "false"}) {
    return JSON.stringify({ mode: "list", total: all.length, visible: visible.map(tx).slice(0, 60) });
  }
  const hits = ${TEXT ? `visible.filter((e) => tx(e) === ${JSON.stringify(TEXT)})` : "visible"};
  if (!hits.length) {
    return JSON.stringify({ err: "not-found", selVisible: visible.map(tx).slice(0, 30), selAllCount: all.length });
  }
  const t = hits[${NTH}];
  if (!t) return JSON.stringify({ err: "nth-out-of-range", nth: ${NTH}, hits: hits.length });
  const r = t.getBoundingClientRect();
  return JSON.stringify({
    x: r.left + r.width / 2, y: r.top + r.height / 2,
    w: r.width, h: r.height,
    cls: String(t.className || "").slice(0, 160),
    tag: t.tagName,
    hits: hits.length,
  });
})()`);

const o = JSON.parse(info);
if (o.err) {
  console.error(info);
  process.exit(3);
}
if (o.mode === "list") {
  console.log(JSON.stringify(o, null, 1));
  process.exit(0);
}

const x = Math.round(o.x);
const y = Math.round(o.y);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", clickCount: 0 });
await sleep(200);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
await sleep(60);
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
if (DBL) {
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 2 });
  await sleep(60);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 2 });
}

if (OUT) {
  await c.shot(OUT, { captureBeyondViewport: false });
}

console.log(
  JSON.stringify({
    clicked: { x, y },
    tag: o.tag,
    hits: o.hits,
    nth: NTH,
    cls: o.cls,
    shot: OUT || null,
  })
);
await sleep(AFTER);
c.close();
process.exit(0);