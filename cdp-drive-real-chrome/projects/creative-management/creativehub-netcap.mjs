// Creative Hub（L1 页面层）：后台网络取证（不截图）。和驱动脚本并行跑，记录 /creative-local/ 下 async / ai-task / generation-log 请求。
//
//   CDP_TARGET=<id> node creativehub-netcap.mjs <outDir> <prefix> [--logdetail] [--max 600]
//     → <prefix>-net.json：method、url、HTTP 状态、请求体原文、响应体原文（每完成一条就落盘；不含任何请求头）
//     驱动脚本做完后 touch <outDir>/STOP 结束；--max 秒（默认 600）到点也结束；Ctrl+C / SIGTERM 同样走正常收尾。
//   --logdetail：结束时对本次出图提交（to-creative / to-image）的每个 jobId 只读 GET /ai/generation-log/{jobId}，
//                落 <prefix>-logdetail-<jobId>.json（requestJson 原文 + sellingPoint / concept 摘要 + authVia）。
//                🔴 鉴权：先在页面内直接发（credentials: include、不带任何头，令牌不经过 Node）；只有返回 401/403 时
//                才退回「复用页面自身最近一次 creative-local 请求的非标准头」—— 这些头只在 --logdetail 时记录、只在内存，
//                不落盘、不打印；产出 authVia 字段写明走的是哪条路（2026-10-13 安全整改，原实现无条件把整份请求头取到 Node）。
//
// 为什么有它：后端日志只在 IDEA 控制台，「发给 AI 的请求体」只能从前端请求 + generation-log 取证
// （requestJson 外层是数组，取 [0]；Generation Log 页只列成功记录 —— 见 PAGE-NOTES「AI 请求体取证」）。
// ⚠️ --logdetail 是脚本自己发的请求（不是驱动 UI 让应用发），与 playbook §4「想调接口就驱动 UI」相悖，
//    只在 UI 无入口（失败记录不在列表里）时用，并在 RESULT 写明「脚本只读 GET，鉴权方式见 authVia」。
// 来源：CP-58118 AC-74/76/94/98 第 6 轮 netcap6.mjs（2026-10-13）。
import { connect } from "../../scripts/sconn.mjs";
import fs from "node:fs";
import path from "node:path";

const [outDir, prefix] = process.argv.slice(2);
const logdetail = process.argv.includes("--logdetail");
const maxMs = Number((() => { const i = process.argv.indexOf("--max"); return i > 0 ? process.argv[i + 1] : 600; })()) * 1000;
if (!outDir || !prefix || outDir.startsWith("--")) { console.error("用法: node creativehub-netcap.mjs <outDir> <prefix> [--logdetail] [--max 600]"); process.exit(2); }
let stopSignal = null;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { if (stopSignal) process.exit(130); stopSignal = sig; console.error(sig + " → 收尾"); });
fs.mkdirSync(outDir, { recursive: true });
const c = await connect(); const reqs = new Map(); const net = []; let H = null;
// 兜底用的请求头：去掉浏览器标准头，只留业务 / 鉴权类；值只在内存，绝不写进任何产出或日志
const pickHdr = (h) => { const o = {}; for (const [k, v] of Object.entries(h || {})) if (!/^(content-length|content-type|host|origin|referer|accept|accept-encoding|accept-language|connection|cookie|sec-|user-agent)/i.test(k)) o[k] = v; return o; };
// generation-log 只读 GET：先在页面内直接发（令牌不经过 Node）；401/403 才退回复用页面请求头
const getLog = async (id) => {
  const url = "/creative-local/ai/generation-log/" + encodeURIComponent(id);
  const go = (hdr) => c.ev(`fetch(${JSON.stringify(url)}, { credentials: 'include'${hdr ? ", headers: " + JSON.stringify(hdr) : ""} }).then(r => r.text().then(t => ({ status: r.status, t })))`);
  const r = await go(null);
  if ((r.status === 401 || r.status === 403) && H && Object.keys(H).length) return { r: await go(H), authVia: "reused-page-request-headers(memory-only)" };
  return { r, authVia: "page-fetch-no-headers" };
};
await c.send("Network.enable", { maxPostDataSize: 262144 });
const save = () => fs.writeFileSync(path.join(outDir, prefix + "-net.json"), JSON.stringify(net, null, 1));
c.on(async (m) => {
  try {
    if (m.method === "Network.requestWillBeSent" && /creative-local\//.test(m.params.request.url)) {
      if (logdetail) H = pickHdr(m.params.request.headers); // 只在需要兜底时记，只在内存
      if (/(async|ai-task|generation-log)/.test(m.params.request.url)) reqs.set(m.params.requestId, { epochMs: Date.now(), local: new Date().toString(), method: m.params.request.method, url: m.params.request.url.replace(/^.*creative-local/, ""), post: m.params.request.postData });
    }
    if (m.method === "Network.responseReceived" && reqs.has(m.params.requestId)) reqs.get(m.params.requestId).status = m.params.response.status;
    if (m.method === "Network.loadingFinished" && reqs.has(m.params.requestId)) {
      const r = reqs.get(m.params.requestId); reqs.delete(m.params.requestId);
      try { r.body = (await c.send("Network.getResponseBody", { requestId: m.params.requestId })).body; } catch (e) { r.body = "ERR " + e.message; }
      r.doneEpochMs = Date.now(); net.push(r); save();
    }
  } catch (e) { console.log("netErr", String(e)); }
});
const STOP = path.join(outDir, "STOP");
console.log("netcap on", Date.now(), "（touch " + STOP + " 结束；硬上限 " + maxMs / 1000 + "s）");
const t0 = Date.now();
while (!stopSignal && Date.now() - t0 < maxMs && !fs.existsSync(STOP)) await c.sleep(300);
if (!fs.existsSync(STOP)) console.log("netcap end:", stopSignal ? "signal " + stopSignal : "max " + maxMs / 1000 + "s reached");
if (logdetail) {
  const jobs = [...new Set(net.filter((r) => r.method === "POST" && /to-creative|to-image/.test(r.url)).map((r) => { try { return JSON.parse(r.body).data.jobId; } catch (e) { return null; } }).filter(Boolean))];
  for (const id of jobs) {
    const { r, authVia } = await getLog(id);
    let j = null; try { j = JSON.parse(r.t); } catch (e) {}
    const d = j && j.data; let req = null; try { req = d && d.requestJson && JSON.parse(d.requestJson); } catch (e) { req = "unparsable"; }
    const first = Array.isArray(req) ? req[0] : req;
    const inner = first && typeof first === "object" ? (first.request || first) : null;
    const out = { at: new Date().toString(), note: "GET /ai/generation-log/{jobId}（只读；鉴权见 authVia，请求头未落盘）", jobId: id, httpStatus: r.status, authVia, code: j && j.code, msg: j && j.msg,
      status: d && d.status, timeCreated: d && d.timeCreated, failureReason: d && d.failureReason, generationSubtype: d && d.generationSubtype,
      requestJsonTopKeys: first && typeof first === "object" ? Object.keys(first) : null,
      pick: inner && typeof inner === "object" ? { sellingPoint: inner.sellingPoint, concept: inner.concept, styleType: inner.styleType, productDescriptionHead: (inner.productDescription || "").slice(0, 80) } : null,
      requestJsonRaw: d && d.requestJson };
    fs.writeFileSync(path.join(outDir, prefix + "-logdetail-" + id + ".json"), JSON.stringify(out, null, 1));
    console.log(JSON.stringify({ id, http: r.status, authVia, status: out.status, keys: out.requestJsonTopKeys, pick: out.pick, fail: out.failureReason }));
  }
}
c.close(); process.exit(0);
