// 执行「页面级 JS 模板」：把 __X__ 占位符替换成实参后交给 CDP 执行。
// 为什么需要它：页面级脚本（本目录 *.js）写成带 __PARAM__ 占位符的模板，
//   免得每个脚本都自己解析一遍命令行参数，也免得手工 sed 替换。
//
// 用法:
//   CDP_TARGET=<id> node run-page.mjs <script.js> --param FILE_TYPE=Video --param PLATFORM=Walmart [--param DO_RELOAD=false]
//   node run-page.mjs <script.js> --json '{"FILE_TYPE":"Video","PLATFORM":"Walmart"}' --wait 25000
//   node run-page.mjs <script.js> --list          # 列出该模板需要的占位符
//
// 占位符映射规则（模板里写占位符，执行时传「去掉前后双下划线」的同名键）:
//   模板里的 __FILE_TYPE__  →  --param FILE_TYPE=Video
//   模板里的 __DO_RELOAD__  →  --param DO_RELOAD=false
//   模板里的 __WAIT__       →  --wait 25000     （特殊名，直接用 --wait）
//
// 值类型推断: "true"/"false" → 布尔, 纯数字 → 数字, 其它 → 字符串（自动加单引号）
// 🔴 所以模板里占位符**不能带引号**：写 `const FT = __FILE_TYPE__;`，不要写 `const FT = "__FILE_TYPE__";`
//    （后者替换后是 `"'Video'"`，值多一层引号 ⇒ 比较恒为假 ⇒ 轮询跑满 ⇒ 表现为 Runtime.evaluate 超时；见 README）
//
// 其它参数: --port(CDP_PORT/9222) --target(CDP_TARGET) --match(CDP_MATCH/localhost) --index --out(json 落盘) --timeout(90000)
import fs from "node:fs";
import { connect, cliTargetOpts } from "../../scripts/conn.mjs";

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

// 带引号的占位符写法会让值多一层引号（见上方 lit 注释）—— 告警但不阻断（旧模板可能仍这么写）
{
  const quoted = [...codeSrc.matchAll(/["']__([A-Z0-9_]+)__["']/g)].map((m) => m[1]);
  if (quoted.length) console.error("WARN_QUOTED_PLACEHOLDER " + JSON.stringify([...new Set(quoted)]) + "：模板应写裸占位符 __X__，否则字符串值会多一层引号");
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

// 字符串值由本函数加单引号（含单引号才退回 JSON.stringify 双引号转义）——
//   所以模板里必须写裸占位符 `const X = __X__;`。若模板写成 `"__X__"`，替换后是 `"'Video'"`：
//   语法不坏，但值多一层引号，比较恒为假（真因与「evaluate 超时」的表象无关，实测排查很久）。下方会对带引号的写法告警。
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

const OUT = flag("--out", "");
const TIMEOUT = Number(flag("--timeout", 90000));

// 连接与目标解析统一走 L0 conn.mjs：--target > CDP_TARGET > --match / CDP_MATCH（默认 localhost）；找不到直接报错，不再退回第一个 page
let c;
try { c = await connect(cliTargetOpts()); } catch (e) { console.error("NO_PAGE_TARGET " + e.message); process.exit(3); }
const page = c.page;
const send = c.send;
// 焦点模拟（防后台节流）conn.mjs 已在同一连接开启

console.error(`[run-page] ${SCRIPT} on ${page.url}`);
const r = await send("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
  userGesture: true,
}, TIMEOUT); // 模板在页面里等列表（20~42s）+ 轮询页签，默认给 90s
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
c.close();
process.exit(0);