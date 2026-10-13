// 执行「页面级 JS 模板」：把 __X__ 占位符替换成实参后交给 CDP 执行。
// 为什么需要它：项目级脚本（.agents/browser-scripts/）写成带 __PARAM__ 占位符的模板，
//   免得每个脚本都自己解析一遍命令行参数，也免得手工 sed 替换。
//
// 用法:
//   node run-page.mjs <script.js> --param FT=Video --param PT=Walmart [--param DO_RELOAD=false]
//   node run-page.mjs <script.js> --json '{"FT":"Video","PT":"Walmart"}' --wait 25000
//   node run-page.mjs <script.js> --list          # 列出该模板需要的占位符
//
// 占位符映射规则（模板里写占位符，执行时传键名，不带下划线）:
//   模板里的 __FILE_TYPE__  →  --param FT=Video
//   模板里的 __DO_RELOAD__  →  --param DO_RELOAD=false
//   模板里的 __WAIT__       →  --wait 25000     （特殊名，直接用 --wait）
//
// 值类型推断: "true"/"false" → 布尔, 纯数字 → 数字, 其它 → 字符串（自动加引号）
//
// 其它参数: --port(9222) --match(localhost:3001) --target --out(json 落盘) --timeout
import fs from "node:fs";

function flag(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const args = process.argv.slice(2);
const SCRIPT = args[0];
if (!SCRIPT || SCRIPT.startsWith("--")) {
  console.error("USAGE: node run-page.mjs <script.js> --param K=V [--param ...] [--json '{..}'] [--list]");
  process.exit(2);
}

const src = fs.readFileSync(SCRIPT, "utf8");

// 模板需要哪些占位符。
// 🔴 只认「出现在赋值右侧」的 __X__，不要全文匹配 —— 说明文字里的 `__X__` 示例会被误当成真占位符。
// 只在**代码行**里找占位符（跳过注释行）—— 说明文字里的 __X__ 示例不算。
const NL = String.fromCharCode(10);
const codeLines = src.split(NL).filter((l) => !l.trim().startsWith("//"));
const codeSrc = codeLines.join(NL);
const placeholders = [
  ...new Set(
    [
      // 三种写法都算：= __X__（裸值）、= "__X__"（字符串）、set(k, __X__)
      ...[...codeSrc.matchAll(/=\s*(?:"__([A-Z0-9_]+)__"|'__([A-Z0-9_]+)__'|__([A-Z0-9_]+)__)/g)].map(
        (m) => m[1] || m[2] || m[3]
      ),
      ...[...codeSrc.matchAll(/\bset\([^,]+,\s*__([A-Z0-9_]+)__/g)].map((m) => m[1]),
    ].filter(Boolean)
  ),
];

if (args.includes("--list")) {
  console.log(JSON.stringify({ script: SCRIPT, placeholders }, null, 1));
  process.exit(0);
}

// 收集实参
const params = {};
// 🔴 要遍历**所有** --param，不能遇到下一个 -- 就 break（那样只能传一个参数）
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--param") continue;
  const a = args[i + 1] || "";
  const eq = a.indexOf("=");
  if (eq > 0) params[a.slice(0, eq)] = a.slice(eq + 1);
}
const jsonIdx = args.indexOf("--json");
if (jsonIdx >= 0 && args[jsonIdx + 1]) {
  try {
    Object.assign(params, JSON.parse(args[jsonIdx + 1]));
  } catch (e) {
    console.error("BAD_JSON " + String(e).slice(0, 120));
    process.exit(2);
  }
}

// __WAIT__ 特殊：--wait 直接给
const WAIT = flag("--wait", "");
if (WAIT !== "") params.WAIT = WAIT;

const missing = placeholders.filter((p) => !(p in params));
if (missing.length) {
  console.error("MISSING_PARAMS " + JSON.stringify(missing) + " for " + placeholders.join(","));
  console.error("HINT: --param " + missing[0] + '="value"  或 --json \'{"' + missing[0] + '":"value"}\'');
  process.exit(2);
}

// 用单引号包裹：模板里写的是 `const X = "__X__"`（双引号），
//   若替换值也带双引号就会变成 "const X = ""Video"";" —— 语法直接坏掉。
const lit = (v) => {
  const s = String(v);
  if (s === "true" || s === "false") return s;
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  if (s.includes("'")) return JSON.stringify(s); // 含单引号才退回双引号并转义
  return "'" + s + "'";
};

// 🔴 只替换**代码区**，绝不碰注释。
//   否则说明文字里的 `__X__` 示例会被替换成裸文本，整个表达式语法坏掉，
//   而且报错发生在页面里，定位成本极高（实测踩过）。
//   做法：先剥掉注释占位（连续注释行 / 行注释），替换完再拼回。
const commentRanges = [];
{
  const lines = src.split(NL);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (inBlock) {
      commentRanges.push(i);
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("//")) {
      commentRanges.push(i);
      continue;
    }
    if (t.startsWith("/*")) {
      commentRanges.push(i);
      if (!t.includes("*/")) inBlock = true;
    }
  }
}
const lines = src.split(NL);
for (const p of placeholders) {
  for (let i = 0; i < lines.length; i++) {
    if (commentRanges.includes(i)) continue;
    lines[i] = lines[i].split("__" + p + "__").join(lit(params[p]));
  }
}
let expr = lines.join(NL);

// 自检：残留占位符说明实参没覆盖到，直接报错（比页面抛 SyntaxError 好定位）。
// 🔴 只在**代码行**上检查 —— 注释里的 `__X__` 说明文字是故意保留的，不是漏替换。
{
  const bad = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (commentRanges.includes(i)) continue;
    for (const t of lines[i].match(/__[A-Z0-9_]+__/g) || []) {
      if (placeholders.includes(t.slice(2, -2))) bad.add(t);
    }
  }
  if (bad.size) {
    console.error("UNREPLACED " + JSON.stringify([...bad]));
    process.exit(2);
  }
}

const PORT = Number(flag("--port", 9222));
const MATCH = flag("--match", "");
const TARGET = flag("--target", "");
const OUT = flag("--out", "");
const TIMEOUT = Number(flag("--timeout", 90000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = targets.filter((t) => t.type === "page");
let page;
if (TARGET) {
  page = pages.find((t) => t.id === TARGET);
  if (!page) {
    console.error("TARGET_NOT_FOUND", TARGET);
    process.exit(2);
  }
} else page = (MATCH ? pages.find((t) => String(t.url).includes(MATCH)) : null) || pages[0];
if (!page) {
  console.error("NO_PAGE_TARGET");
  process.exit(3);
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
const send = (method, params = {}, timeout = TIMEOUT) =>
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
try {
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
} catch {}

console.error(`[run-page] ${SCRIPT} on ${page.url}`);
const r = await send("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true,
});
if (r.exceptionDetails) {
  console.error("EVAL_THROW " + JSON.stringify(r.exceptionDetails).slice(0, 600));
  process.exit(3);
}
const val = r.result?.value;
if (val === undefined || val === null) {
  console.error("EMPTY_RESULT （脚本返回了 undefined —— 是不是没有 return？）");
  process.exit(3);
}
if (OUT) fs.writeFileSync(OUT, val, "utf8");

// 尝试 pretty-print（容忍非 JSON 文本）
let shown = val;
try {
  shown = JSON.stringify(JSON.parse(val), null, 1);
} catch {}
console.log(shown);
if (OUT) console.error("[run-page] saved -> " + OUT);
try {
  ws.close();
} catch {}
process.exit(0);