// ⛔ DEPRECATED（2026-10-13）：新用法一律 export-target.mjs（锁 CDP_TARGET、--dir 落盘、记录请求 / 状态码 / content-disposition）。
//    本文件只为旧命令不失效而保留：它会设 1920x1080 视口覆盖、按全局选择器找第一个 i.pacvue-download-wrap（可能命中顶栏下载中心），
//    且不给 CDP_TARGET 时连「第一个 URL 含 CreativeManagement 的标签」—— 并行时会点到别人的窗口。
//
// 放大视口 → 定位表格导出图标（i.pacvue-download-wrap）→ 真鼠标点击 → 抓导出请求与落盘文件
//   [CDP_TARGET=<id>] [CDP_PORT=9222] node export-click.mjs [--dir <落盘目录>]
//   落盘目录：--dir > CDP_DL_DIR > <系统临时目录>/cdp-downloads（原写死本机仓库 .workbuddy/tmp/downloads，已去掉）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pickPage } from "./conn.mjs";

const argDir = (() => { const i = process.argv.indexOf("--dir"); return i >= 0 ? process.argv[i + 1] : null; })();
const PORT = Number(process.env.CDP_PORT || 9222);
const DL_DIR = path.resolve(argDir || process.env.CDP_DL_DIR || path.join(os.tmpdir(), "cdp-downloads"));
fs.mkdirSync(DL_DIR, { recursive: true });
console.error("[deprecated] export-click.mjs → 请改用 export-target.mjs；download dir = " + DL_DIR);

const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");
let page;
try { page = pickPage(targets, { match: process.env.CDP_MATCH || "CreativeManagement" }); } catch (e) { console.error("no page: " + e.message); process.exit(3); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const reqs = [];

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    return;
  }
  if (m.method === "Network.requestWillBeSent") {
    const u = m.params?.request?.url || "";
    if (/creative\//i.test(u)) reqs.push({ method: m.params.request.method, url: u.replace(/^https?:\/\/[^/]+/, ""), postData: m.params.request.postData });
  }
  if (m.method === "Network.responseReceived") {
    const u = m.params?.response?.url || "";
    if (/creative\//i.test(u)) {
      const h = m.params.response.headers || {};
      reqs.push({ respUrl: u.replace(/^https?:\/\/[^/]+/, ""), status: m.params.response.status, disposition: h["content-disposition"] || h["Content-Disposition"] || null });
    }
  }
});

function send(method, params = {}, timeout = 180000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout " + method)); } }, timeout).unref();
  });
}

await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
await send("Network.enable");
await send("Runtime.enable");
await send("Page.enable");
await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL_DIR });
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
console.error("[run] viewport -> 1920x1080");

const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true })).result?.value;

await new Promise((r) => setTimeout(r, 2500));

const info = JSON.parse(await ev(`(async () => {
  const icon = document.querySelector("i.pacvue-download-wrap");
  if (!icon) return JSON.stringify({err: "no icon"});
  icon.scrollIntoView({ block: "center" });
  await new Promise(r => setTimeout(r, 1200));
  const r = icon.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return JSON.stringify({
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    viewport: [innerWidth, innerHeight],
    cx, cy,
    hitTag: hit ? hit.tagName + "." + String(hit.className || "").slice(0, 70) : null,
    hitIsIcon: hit === icon
  });
})()`));
console.error("[run] info: " + JSON.stringify(info));
if (!info.rect || !info.rect[2]) { console.error("[run] zero size, abort"); process.exit(4); }

const before = new Set(fs.readdirSync(DL_DIR));
for (const [type, extra] of [["mouseMoved", {}], ["mousePressed", { buttons: 1 }], ["mouseReleased", { buttons: 0 }]]) {
  await send("Input.dispatchMouseEvent", { type, x: info.cx, y: info.cy, button: "left", clickCount: 1, ...extra });
  await new Promise((r) => setTimeout(r, 150));
}
console.error("[run] clicked at " + Math.round(info.cx) + "," + Math.round(info.cy));

const deadline = Date.now() + 10 * 60 * 1000;
let files = [];
let firstReqAt = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  if (!firstReqAt && reqs.length) firstReqAt = new Date().toISOString();
  files = fs.readdirSync(DL_DIR).filter((f) => !before.has(f));
  const busy = files.some((f) => f.endsWith(".crdownload"));
  if (files.length && !busy) { await new Promise((r) => setTimeout(r, 3000)); break; }
}
console.log(JSON.stringify({ viewport: info.viewport, clickedAt: [Math.round(info.cx), Math.round(info.cy)], firstReqAt, reqs, files }, null, 2));
ws.close();
process.exit(0);
