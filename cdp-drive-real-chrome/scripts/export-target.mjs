// L0 导出（按 CDP_TARGET 锁标签，并行安全）：页面脚本给出导出按钮坐标 → 真鼠标点 → 等新文件落盘 → 记录请求 / 状态码 / content-disposition
//
//   CDP_TARGET=<id> node export-target.mjs --click page-btn.js --dir <落盘目录> [--url "download|export"] [--wait 180] [--out meta.json]
//
//   page-btn.js：页面表达式，返回导出按钮中心 {x,y}（CSS 像素）。例：Ads 页工具栏 `.el-icon.pacvue-download-wrap`（限定不在 drawer/dialog 内）
//   --dir：Page.setDownloadBehavior 目标目录（不存在就建）；以「点击前目录快照」为基线看增量，不按文件名猜
//   --url：要记录的请求 URL 正则（默认 download|export）
//
// 🔴 旧的 export-click.mjs 连「第一个 URL 含 CreativeManagement 的标签」，并行时会点到别人的窗口 —— 并行一律用本脚本。
// 🔴 导出 = 下载文件，需用户本轮明确授权（次数也要在授权范围内）。
import { connect } from "./conn.mjs"; import fs from "node:fs"; import path from "node:path";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const CLICK = arg("--click"); const DIR = path.resolve(arg("--dir", ".")); const URLRE = new RegExp(arg("--url", "download|export"), "i");
const WAIT = Number(arg("--wait", 180)); const OUT = arg("--out");
if (!CLICK) { console.error("need --click page-btn.js"); process.exit(2); }
fs.mkdirSync(DIR, { recursive: true });
const c = await connect();
await c.send("Network.enable", { maxPostDataSize: 200000 });
await c.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DIR });
const reqs = new Map();
c.on((m) => {
  if (m.method === "Network.requestWillBeSent" && URLRE.test(m.params.request.url)) reqs.set(m.params.requestId, { method: m.params.request.method, url: m.params.request.url.replace(/^https?:\/\/[^/]+/, ""), body: (m.params.request.postData || "").slice(0, 4000), t: new Date().toISOString() });
  if (m.method === "Network.responseReceived" && reqs.has(m.params.requestId)) { const h = m.params.response.headers || {}; Object.assign(reqs.get(m.params.requestId), { status: m.params.response.status, disposition: h["content-disposition"] || h["Content-Disposition"] || null }); }
});
const before = new Set(fs.readdirSync(DIR));
const p = await c.ev(fs.readFileSync(CLICK, "utf8"));
if (!p || p.x == null) { console.error("export button not found: " + JSON.stringify(p)); process.exit(3); }
await c.click(p);
let files = [];
for (let i = 0; i < WAIT; i++) {
  await c.sleep(1000);
  files = fs.readdirSync(DIR).filter((f) => !before.has(f));
  if (files.length && !files.some((f) => f.endsWith(".crdownload"))) break;
}
const meta = { clickedAt: p, dir: DIR, newFiles: files, requests: [...reqs.values()] };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta, null, 1)); c.close(); process.exit(files.length ? 0 : 1);
