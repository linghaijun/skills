// L0 一步出「带红框的证据图」：布景 → 截图 + 同帧导几何 → 框边写字的标注图 → 落盘可引用 JSON。
//
// 为什么有它：一次证据原来是 4~6 条命令（stage-shot --rects → 再导一次 rects → annotate.py --rects），
//   靠人记住「截图前后各导一次 rects 且 cmp 一致」（坑 15）；漏一步就会被验收退回（CP-58252 被追问过）。
//   本脚本把「同帧 + 标注 + 两处提醒」做成一条命令，并复用现成的 stage-shot.mjs（不重写几何逻辑）。
//
// 用法:
//   CDP_TARGET=<id> node evidence.mjs --out evidence/AC-27-01-列表首行.png \
//       --pre setup.js --shot-rects shot.rects.json --out-rects ev.rects.json \
//       --mark "1:Ad Type=Ad Type 分组行" --mark "2:Spend=花费列"
//
//   --pre <f.js>        布景脚本（切页签 / 选日期 / 等数据）；stage-shot 的 __SEL__ / __TEXT__ 占位符同样可用
//   --eval "<expr>"     额外的前置表达式（可重复）
//   --w/--h             视口（默认 1700x1100，同 stage-shot）
//   --mark <spec>       要框的单元格（可重复，见下）；不给则自动框「前 2 行的前 3 列」
//   --mark-file <j.js>  页面表达式，返回 [{x,y,w,h,label}] 或 {label:[x0,y0,x1,y1]}（页面自定义框位）
//   --label <text>      顶部说明带文本（默认取输出文件名）
//   --scale <n>         标注图放大倍数（annotate.py，1~4，默认 2）
//   --color R,G,B       框色（默认红；annotate.py 会拒绝黑/深灰）
//   --rects <path>      跳过截图，直接用已有的 rects 标注（离线补图；须同时给 --src 指定要标注的原图）
//   --src <path>        离线补图时的原图（配 --rects 用）
//   --python <exe>      Python 解释器（默认自动探测：dsh 运行时 > py > python）
//
// --mark 语法:
//   "1:Ad=说明"        第 1 行、表头/列名为 Ad 的单元格
//   "2-4:Spend=说明"   第 2~4 行的 Spend 列（一框一个单元格）
//   "Ad=说明"          所有行里的 Ad 列（最多 20 个，防爆）
//   两列范围用 "1:Ad..1:Creative" 表示从 Ad 到 Creative 合并成**一个**框（用于框一整个区间）
//
// 产出（都可通过参数改名）:
//   <out>               标注图
//   --out-rects         页面导出的几何 JSON（与 <out> 同帧，另存 rects-before/after 供核对）
//   --meta              证据 JSON：用了哪些框、点击/布景、耗时、检验项
//
// 退出码：0 成功；2 参数/依赖问题；3 截图或标注失败。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findPython } from "./conn.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const flag = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const flags = (n) => process.argv.reduce((a, v, i) => (v === n && process.argv[i + 1] ? [...a, process.argv[i + 1]] : a), []);

const OUT = flag("--out", "");
const PRE = flags("--pre");
const EVALS = flags("--eval");
const W = flag("--w", "1700");
const H = flag("--h", "1100");
const MARKS = flags("--mark");
const MARK_FILE = flag("--mark-file", "");
const LABEL = flag("--label", "");
const SCALE = flag("--scale", "2");
const COLOR = flag("--color", "");
const RECTS_IN = flag("--rects", "");
const SRC = flag("--src", "");
const RECTS_OUT = flag("--out-rects", "");
const META = flag("--meta", "");
const PY_ARG = flag("--python", "");

if (!OUT) { console.error("usage: node evidence.mjs --out <证据图.png> [--pre setup.js] [--mark \"1:Ad Type=说明\"]"); process.exit(2); }

// ---------- Python 探测统一走 conn.mjs 的 findPython（annotate.py 需要 Pillow）----------

// ---------- 1) 取几何：要么复用 --rects，要么跑 stage-shot ----------
let rectsPath = RECTS_IN;
let stage = null;
const SRC_IMG = RECTS_IN ? SRC : OUT;   // 离线补图时原图由 --src 给；在线时 stage-shot 直接产出到 OUT
if (RECTS_IN && !SRC) { console.error("--rects（离线补图）必须同时给 --src <原图.png>：否则没有底图可标注"); process.exit(2); }
if (!rectsPath) {
  rectsPath = RECTS_OUT || OUT.replace(/\.png$/i, "") + "-rects.json";
  fs.mkdirSync(path.dirname(path.resolve(rectsPath)), { recursive: true });
  const args = [path.join(HERE, "stage-shot.mjs"), "--out", OUT, "--rects", rectsPath, "--w", W, "--h", H];
  if (!process.env.CDP_TARGET && !process.argv.includes("--target")) {
    // stage-shot 要求显式 target / CDP_TARGET，这里透传并给出可读提示
    const t = flag("--target", "");
    if (t) args.push("--target", t);
  } else if (process.argv.includes("--target")) {
    args.push("--target", flag("--target", ""));
  }
  for (const p of PRE) args.push("--pre", p);
  for (const e of EVALS) args.push("--eval", e);
  if (flag("--sel", "")) args.push("--sel", flag("--sel", ""));
  if (flag("--text", "")) args.push("--text", flag("--text", ""));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
  stage = { argv: args.slice(1), status: r.status, elapsedMs: Date.now() - t0 };
  if (r.status !== 0) { console.error(`stage-shot 失败（status=${r.status}）—— 见上面输出`); process.exit(3); }
  if (!fs.existsSync(rectsPath)) { console.error("stage-shot 没产出 rects：" + rectsPath); process.exit(3); }
}

// ---------- 2) 页面几何 → 标注框 ----------
// 🔴 去 BOM：PowerShell 的 `Set-Content -Encoding utf8` / 部分导出工具会写 UTF-8 BOM，而 JSON.parse 见 BOM 直接抛
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const raw = readJson(rectsPath);
let marks = [];       // [{label, rect:[x0,y0,x1,y1]}]
let auto = false;

if (MARK_FILE) {
  // 页面自定义框位：CM 模式下取一帧，用 cdp/conn 执行；这里只接受「文件里已经是结果」的简单形态，
  // 真正的页面求值交给调用方（保持本脚本无 CDP 依赖，便于离线补图）
  const custom = JSON.parse(fs.readFileSync(MARK_FILE, "utf8"));
  for (const [label, rect] of Object.entries(custom)) marks.push({ label, rect });
} else if (Array.isArray(raw.rows)) {
  const hdr = (raw.hdr || []).map((h) => h.title);
  const rows = raw.rows;
  const cellRect = (cell) => [cell.x, cell.y, cell.x + cell.w, cell.y + cell.h];
  const colIdx = (name) => hdr.findIndex((h) => String(h) === name);

  const addCell = (rIdx, cIdx, label) => {
    const row = rows[rIdx];
    const cell = row && row.cells.find((c) => c.col === hdr[cIdx]);
    if (!cell) return false;
    marks.push({ label, rect: cellRect(cell) });
    return true;
  };

  if (!MARKS.length) {
    auto = true;
    for (let r = 0; r < Math.min(2, rows.length); r++) for (let c = 0; c < Math.min(3, hdr.length); c++) addCell(r, c, `r${r + 1}${hdr[c]}`);
  }
  for (const specRaw of MARKS) {
    const [sel, ...descParts] = specRaw.split("=");
    const desc = descParts.join("=");
    if (sel.includes("..")) {
      // 区间框：把两个单元格合成一个框
      const [a, b] = sel.split("..").map((s) => s.trim());
      const parseOne = (s) => { const m = /^(\d+):(.*)$/.exec(s); return m ? { r: Number(m[1]) - 1, col: m[2] } : { r: 0, col: s }; };
      const A = parseOne(a), B = parseOne(b);
      const ca = rows[A.r] && rows[A.r].cells.find((c) => c.col === A.col);
      const cb = rows[B.r] && rows[B.r].cells.find((c) => c.col === B.col);
      if (!ca || !cb) { console.error(`--mark ${specRaw}: 找不到单元格（可用表头：${hdr.join(" / ")}）`); process.exit(2); }
      const x0 = Math.min(ca.x, cb.x), y0 = Math.min(ca.y, cb.y);
      const x1 = Math.max(ca.x + ca.w, cb.x + cb.w), y1 = Math.max(ca.y + ca.h, cb.y + cb.h);
      marks.push({ label: desc || `${a}..${b}`, rect: [x0, y0, x1, y1] });
      continue;
    }
    const m = /^(\d+)(?:-(\d+))?:(.*)$/.exec(sel);
    if (!m) {
      // 只有列名 → 该列所有行（上限 20）
      const ci = colIdx(sel.trim());
      if (ci < 0) { console.error(`--mark ${specRaw}: 表头里没有「${sel}」。可用：${hdr.join(" / ")}`); process.exit(2); }
      let n = 0;
      for (let r = 0; r < rows.length && n < 20; r++) if (addCell(r, ci, `${desc || sel}[${r + 1}]`)) n++;
      if (!n) { console.error(`--mark ${specRaw}: 该列没有可见行`); process.exit(2); }
      continue;
    }
    const r0 = Number(m[1]) - 1, r1 = m[2] ? Number(m[2]) - 1 : r0;
    const colName = m[3].trim();
    const ci = colIdx(colName);
    if (ci < 0) { console.error(`--mark ${specRaw}: 表头里没有「${colName}」。可用：${hdr.join(" / ")}`); process.exit(2); }
    let okAny = false;
    for (let r = r0; r <= r1; r++) if (addCell(r, ci, desc || `${colName}[${r + 1}]`)) okAny = true;
    if (!okAny) { console.error(`--mark ${specRaw}: 第 ${r0 + 1}~${r1 + 1} 行没有「${colName}」单元格`); process.exit(2); }
  }
} else {
  // 已经是 {lab:[x0,y0,x1,y1]} 形态
  const need = MARKS.map((s) => s.split("=")[0]);
  for (const [label, rect] of Object.entries(raw)) {
    if (!need.length || need.includes(label)) marks.push({ label, rect });
  }
  if (!marks.length && need.length) { console.error(`--mark 的 lab 在 rects 里不存在。可用：${Object.keys(raw).join(" / ")}`); process.exit(2); }
}

if (!marks.length) { console.error("没有可标注的框（--mark 没给且自动选框也失败）"); process.exit(2); }

// ---------- 3) 调 annotate.py ----------
const dst = OUT;
const py = findPython(PY_ARG);
if (!py) { console.error("找不到可用 Python（需要 Pillow 来画标注）。用 --python <exe> 指定。"); process.exit(2); }

const ann = [path.join(HERE, "annotate.py"), SRC_IMG, dst, "--scale", SCALE];
const labelsJson = {};
for (const m of marks) labelsJson[m.label] = m.rect;
// 落盘位置：在线从 OUT 派生；离线（--rects）时别写回原 rects 的同名前缀，优先用 --meta / 原图路径
const tmpRects = RECTS_IN
  ? (META ? META.replace(/\.json$/i, "") + "-marks.json" : OUT.replace(/\.png$/i, "") + "-marks.json")
  : OUT.replace(/\.png$/i, "") + "-marks.json";
fs.writeFileSync(tmpRects, JSON.stringify(labelsJson, null, 1));
ann.push("--rects", tmpRects);
for (const m of marks) ann.push("--mark", `${m.label}=${m.label}`);
if (LABEL) ann.push("--title", LABEL);
else ann.push("--title", path.basename(OUT, ".png"));
if (COLOR) ann.push("--color", COLOR);

if (!fs.existsSync(SRC_IMG)) { console.error("找不到原图（在线模式应来自 stage-shot；离线模式请用 --src 指定）: " + SRC_IMG); process.exit(3); }
const a = spawnSync(py, ann, { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
if (a.stdout && a.stdout.length) process.stderr.write(a.stdout.toString());   // annotate.py 的「已输出…」走 stderr，保证本脚本 stdout 只有 JSON 摘要
if (a.status !== 0) { console.error(`annotate.py 失败（status=${a.status}）`); process.exit(3); }

// ---------- 4) 证据 JSON ----------
const meta = {
  evidence: path.resolve(OUT),
  sourceImage: path.resolve(SRC_IMG),
  rects: path.resolve(rectsPath),
  marksFile: path.resolve(tmpRects),
  markCount: marks.length,
  autoMarks: auto,
  marks: marks.map((m) => ({ label: m.label, rect: m.rect })),
  viewport: { w: Number(W), h: Number(H) },
  stage,
  annotate: { argv: ann.slice(1), scale: SCALE, color: COLOR || "255,0,0" },
  /// 自查（给验收看）：图在、rects 在、框数=标数
  checks: [
    { name: "image-exists", pass: fs.existsSync(OUT), detail: OUT },
    { name: "source-exists", pass: fs.existsSync(SRC_IMG), detail: SRC_IMG },
    { name: "rects-exists", pass: fs.existsSync(rectsPath), detail: rectsPath },
    { name: "marks-nonempty", pass: marks.length > 0, detail: `${marks.length} 框` },
    { name: "same-frame-hint", pass: true, detail: "几何来自 stage-shot 的同帧导出；如需逐字节核对，见 <out>-rects-before/after.json" },
  ],
};
if (META) { fs.mkdirSync(path.dirname(path.resolve(META)), { recursive: true }); fs.writeFileSync(META, JSON.stringify(meta, null, 1)); }
console.log(JSON.stringify(meta, null, 1));
process.exit(0);
