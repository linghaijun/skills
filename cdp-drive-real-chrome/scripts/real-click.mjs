// 真鼠标点击：按「选择器 + 可见文本」定位元素中心，派发 CDP 真实鼠标事件。
// 与 cdp.mjs --realclick 的区别：那个要你先写一个 expr 文件返回元素，本脚本直接给选择器。
//   —— 页签/下拉项这类「有稳定 class + 短文本」的元素，用本脚本最省事。
//
// 用法:
//   node real-click.mjs --sel ".platform-tab__btn" --text "Walmart" [--target <id>]
//   node real-click.mjs --sel "button" --text "Search" --nth 1 --after 30000
//   node real-click.mjs --sel ".x" --text "Y" --list      # 只列出候选，不点（排查选择器）
//
// 参数:
//   --port <n>     CDP 端口，默认 9222
//   --target <id>  页面 target id；不给则用 --match 匹配
//   --match <sub>  按 URL 子串选 target，默认取第一个 page
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

function flag(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const has = (n) => process.argv.includes(n);

const PORT = Number(flag("--port", 9222));
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

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let page;
const TARGET = flag("--target", "");
if (TARGET) {
  page = targets.find((t) => t.id === TARGET);
  if (!page) {
    console.error("TARGET_NOT_FOUND", TARGET);
    process.exit(2);
  }
} else {
  const MATCH = flag("--match", "");
  const pages = targets.filter((t) => t.type === "page");
  page = (MATCH ? pages.find((t) => String(t.url).includes(MATCH)) : null) || pages[0];
  if (!page) {
    console.error("NO_PAGE_TARGET");
    process.exit(3);
  }
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

// 后台标签节流：页面不可见时定时器被压到 1/min，await sleep 会像卡死。必须在同一连接上开。
try {
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
} catch {}

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
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(OUT, Buffer.from(r.data, "base64"));
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
try {
  ws.close();
} catch {}
process.exit(0);