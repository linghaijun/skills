// 直连 Chrome DevTools Protocol 的小工具，绕开 agent-browser CLI 的卡死问题。
// 用法:
//   node cdp.mjs <exprFile>               执行 JS，打印结果
//   node cdp.mjs <exprFile> --shot        执行 JS 后截图（默认 cdp-shot.png，用 --out 改）
//   node cdp.mjs <exprFile> --realclick   exprFile 返回 Element/selector 字符串，用真鼠标点击它（先滚进视口 + 遮挡检查：被挡住退出码 5，加 --force 照点）
//   node cdp.mjs <exprFile> --download    设下载目录后执行 JS（用于触发导出；完整导出验证用 export-target.mjs）
//
// 下载目录：--dl-dir <dir> > 环境变量 CDP_DL_DIR > <系统临时目录>/cdp-downloads（2026-10-13 起不再写死本机仓库路径）
//
// 并行/多账号（每个实例一个端口 + 一个独立 user-data-dir，登录态才隔离）:
//   --port <n>        连哪个 Chrome 实例，默认 9222，也可用环境变量 CDP_PORT
//   --match <substr>  选哪个 page target（按 URL 子串匹配），默认 CDP_MATCH 或 localhost（与 conn.mjs 统一；匹配不到报错，不再退回第一个 page）
//   --index <n>       匹配到多个时取第 n 个（从 0 起）。⚠️ /json/list 的顺序随标签激活而变，并行时别用它
//   --target <id>     🔴 并行首选：按 targetId 精确锁定（也可用环境变量 CDP_TARGET）；给了就不看 --match/--index，找不到直接报错
//   --list            只列出当前实例的所有 page target（含 targetId）后退出
//   --out <path>      截图输出路径；并行时务必区分，否则互相覆盖
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickPage } from "./conn.mjs";

function flag(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes(name);

const PORT = Number(flag("--port", process.env.CDP_PORT || 9222));
const MATCH = flag("--match", process.env.CDP_MATCH || "localhost");
const INDEX = Number(flag("--index", 0));
const TARGET = flag("--target", process.env.CDP_TARGET || "");
const OUT = flag("--out", "cdp-shot.png");
const DL_DIR = path.resolve(flag("--dl-dir", process.env.CDP_DL_DIR || path.join(os.tmpdir(), "cdp-downloads")));

const LIST_ONLY = has("--list");
const exprFile = process.argv[2];
const mode = process.argv[3] || "";
if (!LIST_ONLY && (!exprFile || exprFile.startsWith("--"))) {
  console.error("usage: node cdp.mjs <exprFile> [--shot|--realclick|--download] [--port N] [--target ID] [--match S] [--index N] [--out P] [--dl-dir D]");
  console.error("       node cdp.mjs --list [--port N]      # 只列出该实例的 page target");
  process.exit(2);
}
// --list 时不读表达式文件（argv[2] 此时是 "--list"，读它必然 ENOENT）
const expression = LIST_ONLY ? "" : fs.readFileSync(exprFile, "utf8");

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = targets.filter((t) => t.type === "page");

if (LIST_ONLY) {
  console.log(`[cdp] port ${PORT} 共 ${pages.length} 个 page target:`);
  pages.forEach((t, i) => console.log(`  [${i}] ${t.id}  ${t.url}`));
  process.exit(0);
}

// --target（或 CDP_TARGET）优先：并行时每个分组只认自己登记的 targetId，找不到就报错，绝不退回去连别的标签
// 目标解析与 conn.mjs 共用 pickPage（唯一实现）
let page;
try { page = pickPage(pages, { target: TARGET, match: MATCH, index: INDEX }); }
catch (e) { console.error(`${e.message} (port=${PORT}); 用 --list 看有哪些`); process.exit(3); }
console.error(`[cdp] port=${PORT} target[${INDEX}]: ${page.url}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});

function send(method, params = {}, timeout = 60000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, timeout).unref();
  });
}

await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});

await send("Runtime.enable");
await send("Page.enable");
// 焦点模拟必须与后续 evaluate/click 同连接；跨连接无效（见 SKILL.md）
try {
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
} catch (e) {
  console.error("[cdp] setFocusEmulationEnabled skipped: " + String(e).slice(0, 120));
}

if (mode === "--realclick") {
  // 2026-10-14：改走 conn.mjs 的 clickEl（滚进视口 + 遮挡检查；被挡住退出码 5，--force 照点），不再各写一份
  ws.close();
  const { connect } = await import("./conn.mjs");
  const c = await connect({ port: PORT, target: page.id });
  try {
    const r = await c.clickEl(expression.trim().replace(/;\s*$/, ""), { force: has("--force") });
    console.error("[cdp] realclick " + JSON.stringify(r));
  } catch (e) {
    console.error("[cdp] " + e.message);
    c.close();
    process.exit(e.code === "occluded" ? 5 : 4);
  }
  c.close();
  process.exit(0);
} else {
  if (mode === "--download") {
    fs.mkdirSync(DL_DIR, { recursive: true });
    await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL_DIR });
    console.error(`[cdp] download dir -> ${DL_DIR}`);
  }
  const result = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  console.log(JSON.stringify(result, null, 2));
  if (mode === "--shot") {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
    console.error(`[cdp] screenshot -> ${OUT}`);
  }
}

ws.close();
process.exit(0);
