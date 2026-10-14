// 一站式抓包 + 控制台采集：导航（或不导航）→ 收集 XHR/fetch/静态资源/console/异常 → 落盘。
// 为什么必须有它：agent-browser 的 `network requests` 在本机实测挂死，
//   内置浏览器的面板又太窄无法做交互型验证 → 「点完操作后接口返回了什么」只能靠 CDP 自己收。
//
// 用法:
//   CDP_TARGET=<id> node net-cap.mjs --out cap.json          # 并行：锁本组窗口
//   node net-cap.mjs --url http://localhost:3001/xxx --wait 40000 --out cap.json
//   node net-cap.mjs --out cap.json --match "/api/creative" --body-max 12000
//   node net-cap.mjs --out cap.json --no-bodies            # 只要 URL+状态码，不要响应体
//
// 参数:
//   --port <n>       CDP 端口，默认 CDP_PORT 或 9222
//   --target <id>    指定页面；不给则读 CDP_TARGET（🔴 并行时必须给其一）
//   --match <sub>    无 target 时按 URL 子串选 page，默认 CDP_MATCH 或 localhost；匹配不到报错（不再退回第一个 page）
//   --url <url>      先导航到该 URL；不给则就地采集（点完操作再跑这个模式）
//   --wait <ms>      采集时长，默认 40000（🔴 后端列表接口常需 20~42s，别设短）
//   --out <path>     落盘 JSON（必填）
//   --match-body <re>  只取响应体 URL 匹配该正则的请求；不给则取所有 json/text
//   --body-max <n>   单个响应体截断长度，默认 12000
//   --body-count <n> 最多取几个响应体，默认 12
//   --no-bodies      不取响应体（只要 URL/状态码时用，省时省内存）
//   --stdout-head <n> stdout 只回显前 N 个 body 的摘要，默认 3（别把大 body 灌进上下文）
//
// 输出: { reqs:[{url,status,type,mime}], hits:[...], bodies:[{url,status,len,body}],
//         console, exceptions, logEntries, failed }
//
// 坑（本脚本已内建应对）：
//  1. **别把 bodies 倒进上下文** —— 响应体动辄几十万字符，撑爆上下文且真正要看的只有几 KB。
//     本脚本落盘全量、stdout 只回摘要。
//  2. responseReceived 早于 loadingFinished，此时 getResponseBody 会失败 —— 所以在等待窗口结束后再取。
//  3. URL 去掉 origin 只留 path+query 前缀，便于跨环境对比；但要保留 status，否则「404 当成功读」很常见。
import fs from "node:fs";
import { connect, cliTargetOpts } from "./conn.mjs";

function flag(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const has = (n) => process.argv.includes(n);

const URL_ = flag("--url", "");
const WAIT = Number(flag("--wait", 40000));
const OUT = flag("--out", "");
const MATCH_BODY = flag("--match-body", "");
const BODY_MAX = Number(flag("--body-max", 12000));
const BODY_COUNT = Number(flag("--body-count", 12));
const NO_BODIES = has("--no-bodies");
const STDOUT_HEAD = Number(flag("--stdout-head", 3));

if (!OUT) {
  console.error("MISSING --out");
  process.exit(2);
}

const strip = (u) => String(u).replace(/^https?:\/\/[^/]+/, "");
const uniq = (a) => [...new Set(a)];
const bodyRe = MATCH_BODY ? new RegExp(MATCH_BODY) : /json|text|javascript/;

// 连接与目标解析统一走 conn.mjs：--target > CDP_TARGET > --match / CDP_MATCH（默认 localhost）；找不到直接报错
let c;
try { c = await connect(cliTargetOpts()); } catch (e) { console.error("NO_PAGE_TARGET " + e.message); process.exit(3); }
const page = c.page;
const send = c.send;

await send("Network.enable", {});
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");

const out = {
  pageUrl: URL_ || page.url,
  waitMs: WAIT,
  reqs: [],
  hits: [],
  bodies: [],
  console: [],
  exceptions: [],
  logEntries: [],
  failed: [],
};
const byId = new Map();

c.on((m) => {
  if (m.method === "Network.requestWillBeSent") {
    const r = m.params.request;
    byId.set(m.params.requestId, {
      url: r.url,
      method: r.method,
      postData: String(r.postData || "").slice(0, 2000),
    });
  } else if (m.method === "Network.responseReceived") {
    const r = m.params.response;
    const u = strip(r.url);
    // data: 内联 blob 不记 —— 它不是请求，只是实现细节，且体积巨大
    if (!u.startsWith("data:")) out.reqs.push({ url: u, status: r.status, type: m.params.type, mime: r.mimeType });
    if (bodyRe.test(r.url) && /json|text|javascript/.test(r.mimeType || "")) {
      out.hits.push({ requestId: m.params.requestId, url: strip(r.url), status: r.status });
    }
  } else if (m.method === "Network.loadingFailed") {
    out.failed.push({
      requestId: m.params.requestId,
      err: m.params.errorText,
      url: strip((byId.get(m.params.requestId) || {}).url || ""),
    });
  } else if (m.method === "Runtime.consoleAPICalled") {
    if (["error", "warning", "assert"].includes(m.params.type)) {
      out.console.push({
        type: m.params.type,
        args: (m.params.args || [])
          .map((a) => String(a.value ?? a.description ?? a.type))
          .join(" | ")
          .slice(0, 500),
      });
    }
  } else if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    out.exceptions.push({
      text: d.text,
      desc: String((d.exception && (d.exception.description || d.exception.value)) || "").slice(0, 800),
      url: d.url,
      line: d.lineNumber,
    });
  } else if (m.method === "Log.entryAdded") {
    const e = m.params.entry;
    if (e.level === "error" || e.level === "warning") {
      out.logEntries.push({ level: e.level, text: String(e.text).slice(0, 400), url: e.url });
    }
  }
});

if (URL_) await send("Page.navigate", { url: URL_ });
await new Promise((r) => setTimeout(r, WAIT));

if (!NO_BODIES) {
  for (const h of out.hits.slice(0, BODY_COUNT)) {
    try {
      const b = await send("Network.getResponseBody", { requestId: h.requestId });
      const body = b.body || "";
      out.bodies.push({ url: h.url, status: h.status, len: body.length, body: body.slice(0, BODY_MAX) });
    } catch (e) {
      out.bodies.push({ url: h.url, status: h.status, err: String(e).slice(0, 140) });
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");

console.log(
  JSON.stringify(
    {
      out: OUT,
      pageUrl: out.pageUrl,
      waitMs: WAIT,
      nReqs: out.reqs.length,
      // 🔴 状态码分布先看：全 200 不代表对，要看目标接口是否真的 200 而不是 404/500
      statusDist: out.reqs.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}),
      // 只回「后端 API」：排掉 dev server 模块、静态资源、data: 内联大 blob。
      // 🔴 data:image/png;base64,... 必须排 —— 一张缩略图能塞几十万字符进上下文。
      apiCalls: uniq(
        out.reqs
          .map((r) => r.url)
          .filter((u) => !u.startsWith("data:"))
          .filter((u) => !/^\/(?:@fs|src|node_modules|@vite|@id|@react-refresh|__vite|favicon)/.test(u))
          .filter((u) => !/\.(?:js|mjs|css|scss|less|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|map)(?:\?|$)/i.test(u))
      )
        .slice(0, 40)
        .map((u) => `${(out.reqs.find((r) => r.url === u) || {}).status} ${u.split("?")[0]}`),
      failed: out.failed.map((f) => `${f.err} ${f.url.slice(0, 100)}`),
      exceptions: out.exceptions.slice(0, 6),
      console: out.console.slice(0, 8),
      logEntries: out.logEntries.slice(0, 8),
      bodyCount: out.bodies.length,
      bodiesHead: out.bodies.slice(0, STDOUT_HEAD).map((b) => ({
        url: b.url,
        status: b.status,
        len: b.len,
        err: b.err,
        head: String(b.body || "").slice(0, 300),
      })),
    },
    null,
    1
  )
);
c.close();
process.exit(0);