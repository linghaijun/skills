// L0 导出文件解析（无第三方依赖）：csv / json / xlsx（xlsx 走 zip 容器 + 内联或 sharedStrings 取文本）。
//
// 为什么自己写：本机没装 exceljs/xlsx，而导出验证必须能离线看文件的**行数与列**；
//   projects/creative-management/export-parse.py 是「AC-17 专用」的 openpyxl 脚本，不能跨项目复用。
//
// 库用法:
//   import { parseExport, cellText } from "./export-lib.mjs";
//   const f = parseExport("out.xlsx");    // { format, rows, headers, sheet, truncated, raw:[...] }
//
// CLI（自检用）:
//   node export-lib.mjs <file> [--out summary.json]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

const MAX_ROWS = 200000;

// ---------- CSV ----------
function detectDelimiter(head) {
  const c = { ",": 0, "\t": 0, ";": 0 };
  for (const ch of head) if (ch in c) c[ch]++;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
}
function parseCsv(text) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // 去 BOM
  const head = body.slice(0, 20000);
  const d = detectDelimiter(head);
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < body.length && rows.length < MAX_ROWS; i++) {
    const ch = body[i];
    if (q) {
      if (ch === '"') { if (body[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const headers = (rows.shift() || []).map((h) => h.trim());
  return { rows, headers, delimiter: d === "\t" ? "TAB" : d };
}

// ---------- JSON ----------
function parseJson(text) {
  const j = JSON.parse(text);
  let arr = null;
  if (Array.isArray(j)) arr = j;
  else if (j && typeof j === "object") {
    for (const k of ["data", "rows", "list", "records", "items", "content"]) if (Array.isArray(j[k])) { arr = j[k]; break; }
  }
  if (!arr) return { rows: [], headers: [], note: "JSON 里没找到数组（试过 data/rows/list/records/items/content）" };
  const headers = [...new Set(arr.slice(0, 50).flatMap((o) => (o && typeof o === "object" ? Object.keys(o) : [])))];
  const rows = arr.map((o) => (o && typeof o === "object" ? headers.map((h) => o[h]) : [o]));
  return { rows, headers };
}

// ---------- XLSX（zip 容器）----------
function unzip(buf) {
  // 用 EOCD 找中央目录；只支持 stored(0) 与 deflate(8)——xlsx 实际只用这两种
  const out = new Map();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("不是 zip（找不到 EOCD）");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count && off + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    // 本地头：跳过 name/extra
    const lnameLen = buf.readUInt16LE(lho + 26);
    const lextraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lnameLen + lextraLen;
    const cdata = buf.subarray(dataStart, dataStart + csize);
    try {
      if (method === 0) out.set(name, cdata);
      else if (method === 8) out.set(name, zlib.inflateRawSync(cdata));
    } catch { /* 单个条目坏了不影响整体 */ }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const unesc = (s) => String(s)
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, "&");
function colLetterToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || "");
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function parseXlsx(buf) {
  const zip = unzip(buf);
  const shared = [];
  const ss = zip.get("xl/sharedStrings.xml");
  if (ss) {
    const xml = ss.toString("utf8");
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unesc(x[1]));
      shared.push(parts.join(""));
    }
  }
  const sheetName = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) {
    // 可能是 online 导出的单 sheet 结构
    const alt = [...zip.keys()].find((k) => /worksheet/i.test(k) && k.endsWith(".xml"));
    if (!alt) return { rows: [], headers: [], note: "xlsx 里找不到 worksheet（可能是 .xls 或加密文件）" };
  }
  const sheetXml = zip.get(sheetName).toString("utf8");
  const raw = [];
  for (const rm of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    if (raw.length >= MAX_ROWS) break;
    const cells = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] || "", inner = cm[2] || "";
      const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1];
      const t = (/t="([^"]+)"/.exec(attrs) || [])[1];
      let v = null;
      if (t === "inlineStr") {
        const is = /<is>([\s\S]*?)<\/is>/.exec(inner);
        v = is ? [...is[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unesc(x[1])).join("") : null;
      } else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
        v = vm ? unesc(vm[1]) : null;
        if (t === "s" && v != null) v = shared[Number(v)] ?? v;      // sharedStrings
        else if (t === "b") v = v === "1";                            // boolean
      }
      cells[colLetterToIndex(ref)] = v == null ? "" : String(v);
    }
    raw.push(cells.map((x) => (x === undefined ? "" : x)));
  }
  const headers = (raw.shift() || []).map((h) => String(h || "").trim());
  return { rows: raw, headers, sheet: path.basename(sheetName) };
}

// ---------- 统一入口 ----------
export function parseExport(file) {
  const ext = path.extname(file).toLowerCase();
  const base = { file, bytes: 0, sha1: null };
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    return { ...base, format: ext.slice(1) || "unknown", error: `读不到文件: ${e.message}`, rowCount: 0, headers: [], rows: [] };
  }
  base.bytes = buf.length;
  base.sha1 = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12);
  try {
    if (ext === ".xlsx") {
      const r = parseXlsx(buf);
      return { ...base, format: "xlsx", rowCount: r.rows.length, headers: r.headers, sheet: r.sheet, note: r.note, rows: r.rows };
    }
    if (ext === ".csv" || ext === ".tsv" || ext === ".txt") {
      const r = parseCsv(buf.toString("utf8"));
      return { ...base, format: ext.slice(1), rowCount: r.rows.length, headers: r.headers, delimiter: r.delimiter, rows: r.rows };
    }
    if (ext === ".json") {
      const r = parseJson(buf.toString("utf8"));
      return { ...base, format: "json", rowCount: r.rows.length, headers: r.headers, note: r.note, rows: r.rows };
    }
    // 未知扩展名按内容猜
    if (buf.subarray(0, 2).toString("latin1") === "PK") {
      const r = parseXlsx(buf);
      return { ...base, format: "xlsx(按内容识别)", rowCount: r.rows.length, headers: r.headers, sheet: r.sheet, note: r.note, rows: r.rows };
    }
    const r = parseCsv(buf.toString("utf8"));
    return { ...base, format: "csv(按内容识别)", rowCount: r.rows.length, headers: r.headers, delimiter: r.delimiter, rows: r.rows };
  } catch (e) {
    return { ...base, format: ext.slice(1) || "unknown", error: String(e.message || e), rowCount: 0, headers: [], rows: [] };
  }
}

export const cellText = (row, header) => {
  const i = row && row.__h ? row.__h.indexOf(header) : -1;
  return i >= 0 ? row[i] : undefined;
};

// ---------- CLI 自检 ----------
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/export-lib.mjs");
if (isMain) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node export-lib.mjs <file.xlsx|csv|json> [--out summary.json]"); process.exit(2); }
  const f = parseExport(file);
  const summary = {
    file: f.file, format: f.format, bytes: f.bytes, sha1: f.sha1,
    rowCount: f.rowCount, headers: f.headers.slice(0, 30), sheet: f.sheet, delimiter: f.delimiter,
    note: f.note, error: f.error, sample: f.rows.slice(0, 3),
  };
  const i = process.argv.indexOf("--out");
  if (i >= 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(f, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  process.exit(f.error ? 1 : 0);
}
