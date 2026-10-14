// L0 导出验证：文件解析出「行数 / 表头 / 抽样」→ 与页面上的 Total / 首行做对账 → 落盘可引用的证据 JSON。
//
// 为什么有它：export-target.mjs 只证明「点到了按钮 + 文件落盘 + 打到哪个后端」，
//   不证明「文件内容对不对」。而「平台导出 vs 中台页面」对账正是本 skill 的主场景之一
//   （L1 里 export-parse.py / export-page-crosscheck.py 就是各自手写的专用版）。
//
// 用法:
//   CDP_TARGET=<id> node verify-export.mjs --file <导出文件> --out meta.json
//   CDP_TARGET=<id> node verify-export.mjs --file out.xlsx --out meta.json \
//        --page-total-sel "span.page-total" --page-rows-sel ".surely-table-cell" \
//        --expect-header "Ad Type" --expect-header "Creative" --find "某个值"
//
// 参数:
//   --file <path>           🔴 必填：导出落盘的文件（.xlsx / .csv / .tsv / .json）
//   --out <path>            证据 JSON 落盘（强烈建议；stdout 只回摘要，不倒大内容）
//   --page-total-sel <css>  页面 Total 文本选择器（如 `span.page-total`）；不给则跳过行数对账
//   --page-rows-sel <css>   页面行选择器；给了会与「文件行数」做二次对照（虚拟滚动只算可见行，仅作提示）
//   --expect-header <text>  期望文件里有的表头（可重复）；缺一个就判 fail
//   --find <text>           期望文件里出现的值（可重复，任意列包含即可）
//   --sample <n>            抽样行数，默认 3（只用于人工核对，不进判定）
//   --min-rows <n>          文件行数下限（默认 1；0 行直接 fail）
//
// 退出码：0 = 全部判定通过；1 = 有判定失败；2 = 文件/连接问题。
// 判定项（verdict.checks）：
//   file-parsed     文件能解析且行数 ≥ min-rows
//   headers         期望表头都存在（--expect-header 给了才有）
//   finds           期望值都能在文件里找到（--find 给了才有）
//   page-total      文件行数 == 页面 Total（--page-total-sel 给了才有）
//   no-empty-page   页面 Total 不是 0 / No data found（防「后端没起/未登录」被当成「导出为空」）
import fs from "node:fs";
import path from "node:path";
import { connect, cliTargetOpts } from "./conn.mjs";
import { parseExport } from "./export-lib.mjs";

const flag = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const flags = (n) => process.argv.reduce((a, v, i) => (v === n && process.argv[i + 1] ? [...a, process.argv[i + 1]] : a), []);

const FILE = flag("--file", "");
const OUT = flag("--out", "");
const TOTAL_SEL = flag("--page-total-sel", "");
const ROWS_SEL = flag("--page-rows-sel", "");
const EXPECT_HEADERS = flags("--expect-header");
const FINDS = flags("--find");
const SAMPLE = Number(flag("--sample", 3));
const MIN_ROWS = Number(flag("--min-rows", 1));

if (!FILE) { console.error("usage: node verify-export.mjs --file <导出文件> [--out meta.json] [--page-total-sel sel]"); process.exit(2); }
if (!fs.existsSync(FILE)) { console.error("FILE_NOT_FOUND " + FILE); process.exit(2); }

// ---------- ① 文件侧 ----------
const f = parseExport(FILE);
const checks = [];
const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

add("file-parsed", !f.error && f.rowCount >= MIN_ROWS, f.error ? `解析失败: ${f.error}` : `format=${f.format} rows=${f.rowCount} bytes=${f.bytes}`);

const headersLower = f.headers.map((h) => String(h).toLowerCase());
for (const h of EXPECT_HEADERS) add(`header:${h}`, headersLower.includes(h.toLowerCase()), `表头前 10：${JSON.stringify(f.headers.slice(0, 10))}`);

const flatRows = f.rows.map((r) => (Array.isArray(r) ? r.join("\u0001") : JSON.stringify(r)));
for (const v of FINDS) {
  const hit = flatRows.findIndex((s) => String(s).includes(v));
  add(`find:${v}`, hit >= 0, hit >= 0 ? `第 ${hit + 1} 个数据行命中` : `文件里没有该值（共 ${f.rowCount} 行）`);
}

// ---------- ② 页面侧（只读）----------
let c, page = null;
let exitCode = checks.every((x) => x.pass) ? 0 : 1;
try {
  try { c = await connect(cliTargetOpts()); } catch (e) { console.error("NO_PAGE_TARGET " + e.message); process.exit(2); }

  const parseNum = (s) => {
    if (s == null) return null;
    const t = String(s).replace(/[,\s]/g, "");
    const m = /(\d+)/.exec(t);
    return m ? Number(m[1]) : null;
  };

  page = { url: c.page.url, targetId: c.page.id };
  if (TOTAL_SEL) {
    // 与 ads-state-rects.js 同一口径：Total 文案常在第一个子元素里，且可能被去掉空格
    const txt = await c.ev(`(() => { const e = document.querySelector(${JSON.stringify(TOTAL_SEL)}); if (!e) return null; const kid = e.firstElementChild; return ((kid && kid.textContent) || e.textContent || "").trim(); })()`);
    const total = parseNum(txt);
    const emptyish = !txt || /no\s*data|no\s*product/i.test(txt) || total === 0;
    add("no-empty-page", !emptyish, `页面 Total 文本=${JSON.stringify(txt)} → ${total}`);
    if (!emptyish) add("page-total", total === f.rowCount, `文件 ${f.rowCount} 行 vs 页面 Total ${total}${total === f.rowCount ? "" : " ⚠️ 不一致"}`);
    page.totalText = txt; page.total = total;
  }
  if (ROWS_SEL) {
    const n = await c.ev(`document.querySelectorAll(${JSON.stringify(ROWS_SEL)}).length`);
    page.domCells = n;
    page.domCellsNote = "虚拟滚动只渲染可见行，此值仅作提示，不参与判定";
    // 只作提示：若「文件行数 < 可见行数」说明文件反而比页面少，值得人看
    add("file-not-smaller-than-visible", !(typeof n === "number" && n > 0 && f.rowCount < n), `文件 ${f.rowCount} 行 / 页面可见单元格 ${n}`);
  }
} finally { try { c?.close(); } catch {} }

// ---------- ③ 输出 ----------
const failed = checks.filter((x) => !x.pass);
const meta = {
  verifiedAt: new Date().toISOString(),
  file: { path: path.resolve(FILE), format: f.format, bytes: f.bytes, sha1: f.sha1, rowCount: f.rowCount, headers: f.headers.slice(0, 40), sheet: f.sheet, delimiter: f.delimiter || null, note: f.note || null, error: f.error || null },
  page,
  checks,
  verdict: { ok: failed.length === 0, failed: failed.map((x) => x.name) },
  sample: f.rows.slice(0, SAMPLE),
};
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(meta, null, 1)); }

console.log(JSON.stringify({
  out: OUT || null,
  file: { format: meta.file.format, rowCount: meta.file.rowCount, bytes: meta.file.bytes, sha1: meta.file.sha1 },
  page: page ? { url: page.url, total: page.total ?? null, totalText: page.totalText ?? null, domCells: page.domCells ?? null } : null,
  checks: checks.map((x) => `${x.pass ? "PASS" : "FAIL"} ${x.name} — ${String(x.detail).slice(0, 120)}`),
  verdict: meta.verdict,
}, null, 1));

if (failed.length) exitCode = 1;
process.exit(exitCode);
