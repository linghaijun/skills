// L0 可点元素编号清单 + 按编号真点击（移植 browser-use 的「元素编号 → 按编号点」做法，2026-10-14）
//
// 为什么要它：Pacvue 页面大多是 div 拼的，Vue @click 挂在普通 div 上，AX 树（ax-snap.mjs）里根本没有这些元素（坑 39），
// 以前只能现写 querySelector 表达式试两三轮。这里用 DevTools 的 getEventListeners()（Runtime.evaluate + includeCommandLineAPI）
// 直接认出挂了点击监听的元素，再按可见性 + 遮挡过滤，一次列出「现在能点的东西」。页面代码在 clickables-page.js（原样注入，坑 22）。
//
// 用法:
//   CDP_TARGET=<id> node clickables.mjs                         列出视口内能点的元素：[n] tag.class "文本" (x,y) 理由
//   node clickables.mjs --root ".pacvue-newfilter-wrapper"      只看某个容器（弹窗 / 抽屉 / 筛选条）
//   node clickables.mjs --text Search                           只列文本含 Search 的（不区分大小写）
//   node clickables.mjs --all                                   连视口外 / 被挡住的也列（标 covered=挡住它的元素）
//   node clickables.mjs --click 3                               点「上一次列出的」第 3 个（页面变了导致元素脱离 DOM 会报错，重列一次）
//   node clickables.mjs --text Search --click 0                 现列现点
//   --force（被挡住也点）  --max 200  --json（输出 JSON）  --out list.json（落盘，stdout 只回摘要）  --after 600（点完等待 ms）
//   --target / --port / --match / --index 同 conn.mjs
//
// 理由字段 why：tag / role:xxx / listener / tabindex / editable / pointer（含义见 clickables-page.js 头注释）。
// 点击走 conn.mjs 的 clickEl（滚进视口 + 遮挡检查），点完照常读回状态（坑 28）。
// 退出码：0 正常 / 2 参数错 / 3 找不到（root 不存在、编号越界、清单已失效）/ 4 被遮挡
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, cliTargetOpts } from "./conn.mjs";

const argv = process.argv;
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null && !String(argv[i + 1]).startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const ROOT = flag("--root", "");
const TEXT = flag("--text", "");
const ALL = has("--all");
const MAX = Number(flag("--max", 200));
const CLICK = flag("--click", null);
const FORCE = has("--force");
const JSON_OUT = has("--json");
const OUT = flag("--out", "");
const AFTER = Number(flag("--after", 600));
if (CLICK != null && !/^[0-9]+$/.test(CLICK)) { console.error("--click 要给编号（非负整数）"); process.exit(2); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE_JS = fs.readFileSync(path.join(HERE, "clickables-page.js"), "utf8");

let c;
try { c = await connect(cliTargetOpts()); } catch (e) { console.error("NO_PAGE_TARGET " + e.message); process.exit(3); }
const done = (code) => { c.close(); process.exit(code); };

const listFresh = CLICK == null || ROOT || TEXT || ALL;
let res = null;
if (listFresh) {
  const opt = { root: ROOT, text: TEXT, all: ALL, max: MAX };
  const r = await c.send("Runtime.evaluate", {
    // 必须包在块里：顶层 const 会留在页面的全局词法作用域，同一页面第二次列清单就报「__OPT has already been declared」（离线回归抓到）
    expression: `{ const __OPT = ${JSON.stringify(opt)};\n${PAGE_JS}\n}`,
    includeCommandLineAPI: true, returnByValue: true, awaitPromise: false,
  }, 60000).catch((e) => ({ err: e }));
  if (r.err) { console.error("clickables: " + r.err.message); done(3); }
  if (r.exceptionDetails) { console.error("clickables: 页面脚本异常 " + JSON.stringify(r.exceptionDetails).slice(0, 400)); done(3); }
  res = r.result.value;
  if (res.err) { console.error("clickables: " + JSON.stringify(res)); done(3); }
  if (!res.hasGEL) console.error("⚠ getEventListeners 不可用（includeCommandLineAPI 没生效？）→ 只按 tag / role / pointer 判定，div 上的 @click 可能漏");

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
    console.log(JSON.stringify({ out: OUT, listed: res.listed, covered: res.covered, scanned: res.scanned, truncated: res.truncated }));
  } else if (JSON_OUT) {
    console.log(JSON.stringify(res, null, 1));
  } else if (CLICK == null) {
    for (const it of res.items) {
      console.log(`[${it.i}] ${it.tag}${it.role ? " role=" + it.role : ""} "${it.text}" (${it.x},${it.y}) ${it.w}x${it.h}  ${it.why}${it.covered ? "  ✗ covered by " + it.covered : ""}`);
    }
    console.log(`-- ${res.listed} 个${res.truncated ? "（已截断，--max 调大或 --root / --text 缩小）" : ""}；扫描 ${res.scanned} 个元素，${res.covered} 个被遮挡${ALL ? "（已列出）" : "（未列出，--all 可看）"}；视口 ${res.viewport.w}x${res.viewport.h}`);
  }
}

if (CLICK != null) {
  const n = Number(CLICK);
  const it = await c.ev(`(() => { const a = window.__cdpClickables; if (!a) return { err: "no-list" }; const e = a[${n}]; if (!e) return { err: "out-of-range", len: a.length }; if (!e.isConnected) return { err: "stale" }; return { ok: true, text: String(e.innerText || e.value || e.getAttribute("aria-label") || "").trim().slice(0, 50) }; })()`);
  if (it.err) {
    const why = { "no-list": "这个页面还没列过清单（或已刷新）", "out-of-range": `编号越界（上次共 ${it.len} 个）`, stale: "上次清单里的元素已脱离 DOM（页面变了）" }[it.err];
    console.error(`clickables --click ${n}: ${why} → 先重新列一次`);
    done(3);
  }
  try {
    const r = await c.clickEl(`window.__cdpClickables[${n}]`, { force: FORCE });
    console.log(JSON.stringify({ clicked: n, text: it.text, x: r.x, y: r.y, scrolled: r.scrolled, hit: r.hit, forced: r.forced }));
  } catch (e) {
    console.error(JSON.stringify({ err: e.code || "click-failed", msg: e.message }));
    done(e.code === "occluded" ? 4 : 3);
  }
  await c.sleep(AFTER);
}
done(0);
