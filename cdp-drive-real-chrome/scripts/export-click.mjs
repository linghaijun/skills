// 放大视口 → 定位表格导出图标（i.pacvue-download-wrap）→ 真鼠标点击 → 抓导出请求与落盘文件
import fs from "node:fs";

const PORT = 9222;
const DL_DIR = "C:\\Users\\HaijunLing\\IdeaProjects\\creative-management-all\\.workbuddy\\tmp\\downloads";
fs.mkdirSync(DL_DIR, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && String(t.url).includes("CreativeManagement"));
if (!page) { console.error("no page"); process.exit(3); }

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
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout " + method)); } }, timeout);
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
