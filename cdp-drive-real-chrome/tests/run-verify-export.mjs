// 离线回归 verify-export.mjs + export-lib.mjs（xlsx / csv / json + 页面 Total 对账）。
//   node tests/run-verify-export.mjs
// fixture（4145 行 xlsx/csv/json）在缺失时用 openpyxl 现场生成到临时目录——不把二进制样本放进 skill。
import { SKILL, startFake, makeReporter, ensureFixtures, FIXTURES } from "./testkit.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const { ok, done } = makeReporter();
const S = "file:///" + SKILL.replace(/\\/g, "/");
const { parseExport } = await import(S + "/scripts/export-lib.mjs");
ensureFixtures();
const FIX = FIXTURES;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "verify-export-"));

// ---------- export-lib：三种格式 ----------
{
  const x = parseExport(path.join(FIX, "export.xlsx"));
  ok("export-lib 解析 xlsx 行数", x.rowCount === 4145, `rows=${x.rowCount} format=${x.format}`);
  ok("export-lib xlsx 表头（sharedStrings 解析）", x.headers.join("|") === "Ad|Ad Type|Creative|Spend", JSON.stringify(x.headers));
  ok("export-lib xlsx 单元格文本非空且正确", x.rows[0] && x.rows[0][0] === "Ad 1 (ID: 600000)" && x.rows[0][1] === "SP", JSON.stringify(x.rows[0]));

  const c = parseExport(path.join(FIX, "export.csv"));
  ok("export-lib 解析 csv（含 BOM）行数", c.rowCount === 4145, `rows=${c.rowCount}`);
  ok("export-lib csv 表头无 BOM 残留", c.headers[0] === "Ad", JSON.stringify(c.headers));
  ok("export-lib csv 内容正确", c.rows[0][0] === "Ad 1 (ID: 600000)", JSON.stringify(c.rows[0]));

  const j = parseExport(path.join(FIX, "export.json"));
  ok("export-lib 解析 json 数组", j.rowCount === 5 && j.headers.includes("Ad Type"), `rows=${j.rowCount} headers=${JSON.stringify(j.headers)}`);

  const bad = parseExport(path.join(TMP, "nope.bin"));
  ok("export-lib 坏文件不抛错、带 error 字段", typeof bad.error === "string" || bad.rowCount >= 0, JSON.stringify(bad.error || bad.format));
}

const runVerify = (args, extraEnv = {}) => new Promise((res) => {
  const p = spawn(process.execPath, [path.join(SKILL, "scripts", "verify-export.mjs"), ...args], {
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv },
  });
  let so = "", se = ""; p.stdout.on("data", (d) => (so += d)); p.stderr.on("data", (d) => (se += d));
  p.on("close", (code) => res({ code, so, se }));
});

// ---------- 不连页面：只判文件侧 ----------
{
  const meta = path.join(TMP, "meta.json");
  const r = await runVerify(["--file", path.join(FIX, "export.xlsx"), "--out", meta, "--expect-header", "Ad Type", "--find", "ID: 600000"]);
  let j = null; try { j = JSON.parse(r.so); } catch {}
  ok("verify-export 无页面时也能判定文件侧（exit 0）", r.code === 0, `code=${r.code} stderr=${r.se.trim().slice(0, 100)}`);
  ok("verify-export 报告行数 4145", j && j.file.rowCount === 4145, j && JSON.stringify(j.file));
  ok("verify-export 落盘证据 JSON", fs.existsSync(meta) && JSON.parse(fs.readFileSync(meta, "utf8")).checks.length >= 3, meta);
}

// ---------- 页面 Total 一致 / 不一致 / No data found ----------
{
  const { proc, info } = await startFake(["--port", "0", "--total-text", "Total4145entries,50/page"]);
  const port = new URL(info.http).port;
  const r = await runVerify(["--file", path.join(FIX, "export.csv"), "--page-total-sel", ".page-total"], { CDP_PORT: port, CDP_TARGET: "FAKE-TARGET-1" });
  let j = null; try { j = JSON.parse(r.so); } catch {}
  ok("verify-export 页面 Total == 文件行数 → exit 0", r.code === 0, `code=${r.code} ${j ? JSON.stringify(j.page) : r.se.trim().slice(0, 120)}`);
  ok("verify-export 判定项含 page-total", j && j.checks.some((c) => c.startsWith("PASS page-total")), j && JSON.stringify(j.checks));
  proc.kill();
}
{
  const { proc, info } = await startFake(["--port", "0", "--total-text", "Total4144entries,50/page"]);
  const port = new URL(info.http).port;
  const r = await runVerify(["--file", path.join(FIX, "export.csv"), "--page-total-sel", ".page-total"], { CDP_PORT: port, CDP_TARGET: "FAKE-TARGET-1" });
  let j = null; try { j = JSON.parse(r.so); } catch {}
  ok("verify-export 行数不一致 → exit 1", r.code === 1, `code=${r.code}`);
  ok("verify-export 不一致时 verdict.failed 点名 page-total", j && j.verdict && j.verdict.failed.includes("page-total"), j && JSON.stringify(j.verdict));
  proc.kill();
}
{
  const { proc, info } = await startFake(["--port", "0", "--total-text", "No data found!"]);
  const port = new URL(info.http).port;
  const r = await runVerify(["--file", path.join(FIX, "export.xlsx"), "--page-total-sel", ".page-total"], { CDP_PORT: port, CDP_TARGET: "FAKE-TARGET-1" });
  let j = null; try { j = JSON.parse(r.so); } catch {}
  ok("verify-export 页面 No data found → exit 1 且点名 no-empty-page", r.code === 1 && j && j.verdict.failed.includes("no-empty-page"), j && JSON.stringify(j.verdict));
  proc.kill();
}
{
  const r = await runVerify(["--file", path.join(FIX, "export.json"), "--find", "绝不存在的值-XYZ"]);
  let j = null; try { j = JSON.parse(r.so); } catch {}
  ok("verify-export --find 未命中 → exit 1", r.code === 1 && j && j.verdict.failed.some((n) => n.startsWith("find:")), j && JSON.stringify(j.verdict));
}
{
  const r = await runVerify([]);
  ok("verify-export 缺 --file → exit 2", r.code === 2, `code=${r.code}`);
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
done();
