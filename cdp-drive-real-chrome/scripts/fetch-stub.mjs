// L0 构造证据的标准做法：CDP Fetch 拦截指定接口，fulfill 成给定响应或直接 fail；结束时 Fetch.disable + reload + 读回确认失效并留证。
//
//   CDP_TARGET=<id> node fetch-stub.mjs --pattern "*/api/progress/*" (--body resp.json [--status 200] | --fail Failed)
//                                       [--until <STOP 文件路径> | --ms 60000] [--check-url /api/progress/selftest] --log out.json
//     --pattern    Fetch.enable 的 urlPattern（通配 * ?），只拦这一类请求
//     --body       响应体文件（原样返回，Content-Type: application/json）；与 --fail 二选一
//     --fail       Network.ErrorReason（Failed / TimedOut / ConnectionRefused …），构造网络失败分支
//     --until      该文件出现即结束（主脚本做完操作后 touch 它）；不给则按 --ms 计时结束
//     --max        硬上限秒数，默认 600：--until 的文件迟迟不出现（主脚本崩了 / 忘了 touch）也会到点收尾，拦截不会无限挂着
//     Ctrl+C / SIGTERM：同样走收尾（Fetch.disable + reload + 读回），log 里记 endReason；再按一次强制退出
//     --check-url  可选：开拦截后在页面里 fetch 一次它做自检（必须拿到构造响应），结束 reload 后再 fetch 一次确认已失效
//     --log        落盘：每次命中的 URL / 时间 / 方式 + 开始结束自检结果（证据标「构造（CDP Fetch）」）
//
// 纪律（workflow playbook §4.2）：
//   - 构造帧的结论必须写「构造（CDP Fetch）」，不能单独支撑「通过」；真实样本仍要另找
//   - 结束后必须 Fetch.disable + 整页 reload，并留下「读回已失效」的证据（本脚本 log 里的 afterCheck）
//   - 一个拦截只服务一个场景；同一时间别和页面内存补丁（改 fetch/XHR）混用
// 为什么有它（CP-58118，2026-10-13）：AC-90/97 首帧与失败分支、AC-62/84 超时构造，各组各写一套 Fetch 拦截，口径不一、收尾不全被退回。
import { connect } from "./sconn.mjs";
import fs from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const pattern = arg("--pattern"); const bodyFile = arg("--body"); const failReason = arg("--fail");
const status = Number(arg("--status", 200)); const until = arg("--until"); const ms = Number(arg("--ms", 60000));
const checkUrl = arg("--check-url"); const logFile = arg("--log"); const maxMs = Number(arg("--max", 600)) * 1000;
if (!pattern || (!bodyFile && !failReason) || !logFile) {
  console.error("用法: node fetch-stub.mjs --pattern <urlPattern> (--body <file> | --fail <reason>) --log <out.json> [--until <file> | --ms N] [--max 600] [--check-url <url>]");
  process.exit(2);
}
const body = bodyFile ? fs.readFileSync(bodyFile) : null;
const c = await connect();
const log = { evidenceType: "构造（CDP Fetch）", pattern, mode: failReason ? "fail:" + failReason : "fulfill:" + status, startedAt: new Date().toISOString(), hits: [] };
const flush = () => fs.writeFileSync(logFile, JSON.stringify(log, null, 1));
// 信号收尾：收到 Ctrl+C / SIGTERM 时不直接退出，让下方 finally 执行 Fetch.disable + reload（否则拦截残留在页面上）
let stopSignal = null;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
  if (stopSignal) { console.error("second " + sig + ", force exit（拦截可能残留：手动 reload 该标签）"); process.exit(130); }
  stopSignal = sig; console.error(sig + " → 收尾中（Fetch.disable + reload）…");
});
c.on(async (m) => {
  if (m.method !== "Fetch.requestPaused") return;
  const p = m.params;
  try {
    if (failReason) await c.send("Fetch.failRequest", { requestId: p.requestId, errorReason: failReason });
    else await c.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: body.toString("base64") });
    log.hits.push({ at: new Date().toISOString(), method: p.request.method, url: p.request.url.replace(/^https?:\/\/[^/]+/, "") });
  } catch (e) { log.hits.push({ at: new Date().toISOString(), error: String(e) }); }
  flush();
});
const probe = (u) => c.ev(`fetch(${JSON.stringify(u)}).then(r => r.text().then(t => ({ status: r.status, head: t.slice(0, 200) }))).catch(e => ({ error: String(e) }))`);
try {
  await c.send("Fetch.enable", { patterns: [{ urlPattern: pattern, requestStage: "Request" }] });
  if (checkUrl) { log.selfCheck = await probe(checkUrl); log.hits = []; }
  flush();
  console.log("stub on " + pattern + (until ? "（等 " + until + " 出现）" : "（" + ms + "ms）") + "，硬上限 " + maxMs / 1000 + "s");
  const t0 = Date.now();
  while (!stopSignal && Date.now() - t0 < maxMs && (until ? !fs.existsSync(until) : Date.now() - t0 < ms)) await c.sleep(300);
  log.endReason = stopSignal ? "signal:" + stopSignal : Date.now() - t0 >= maxMs ? "max " + maxMs / 1000 + "s reached" : until ? "until-file" : "ms elapsed";
} finally {
  await c.send("Fetch.disable").catch((e) => { log.disableError = String(e); });
  await c.send("Page.reload", { ignoreCache: true }).catch(() => {});
  await c.sleep(6000);
  if (checkUrl) log.afterCheck = await probe(checkUrl).catch((e) => ({ error: String(e) }));
  log.endedAt = new Date().toISOString();
  log.cleared = "Fetch.disable + reload 已执行" + (checkUrl ? "；afterCheck 应为真实响应（非构造体）" : "；未给 --check-url，需另行读回确认");
  flush();
  console.log(JSON.stringify({ hits: log.hits.length, selfCheck: log.selfCheck, afterCheck: log.afterCheck }));
  c.close();
  process.exit(0);
}
