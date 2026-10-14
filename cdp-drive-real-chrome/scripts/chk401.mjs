// L0 开测前登录态自检：reload 当前标签，收集匹配接口的 HTTP 状态码；出现 401/403 立即判「未登录」并以退出码 2 结束。
//
//   CDP_TARGET=<targetId> node chk401.mjs [--match <正则>] [--wait <ms>] [--out <file.json>]
//     --match  只统计 URL 命中该正则的响应（默认 "/api/|-local/"，本项目可用 "creative-local"）
//     --wait   reload 后等待多久收集响应（默认 12000）
//     --out    结果落盘（可作为进场检查证据）；不给只打印
//   退出码：0 = 有业务响应且无 401/403；2 = 出现 401/403（未登录 / 登录过期）；3 = 一个业务响应都没收到（多半停在登录页或服务没起）
//
// 只读：只 reload 页面、只读响应状态码，不读响应体、不碰请求头与凭据。
// 为什么有它（CP-58118，2026-10-13）：一个子 agent 在 Chrome 登录态过期后空跑整组，截图全部作废。
// 子 agent brief 必含「开测先跑 chk401，退出码非 0 立即停下汇报」（workflow playbook §12）。
import { connect } from "./sconn.mjs";
import fs from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const re = new RegExp(arg("--match", "/api/|-local/"));
const wait = Number(arg("--wait", 12000));
const out = arg("--out", null);

const c = await connect();
const responses = {};
await c.send("Network.enable");
c.on((m) => {
  if (m.method === "Network.responseReceived" && re.test(m.params.response.url)) {
    const u = m.params.response.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    responses[u] = m.params.response.status;
  }
});
await c.send("Page.reload", { ignoreCache: true });
await c.sleep(wait);
const href = await c.ev("location.href").catch(() => null);
const bad = Object.entries(responses).filter(([, s]) => s === 401 || s === 403);
const o = { at: new Date().toISOString(), href, match: String(re), responses, unauthorized: bad.map(([u, s]) => u + " " + s),
  verdict: bad.length ? "未登录/登录过期" : Object.keys(responses).length ? "已登录" : "无业务响应（停在登录页或服务未起）" };
if (out) fs.writeFileSync(out, JSON.stringify(o, null, 1));
console.log(JSON.stringify(o));
c.close();
process.exit(bad.length ? 2 : Object.keys(responses).length ? 0 : 3);
