// tests/ 共用工具：定位 skill 根、探测 Python、按需生成 fixture、起假 Chrome。
//
// 为什么有它：6 个套件都要这三件事。以前每个 run-*.mjs 各写一份 SKILL 绝对路径 +
// 硬编码 python + 依赖 fixtures 里预先存在的二进制文件 —— 换机器 / 换目录 / 干净 clone 就全废。
// 现在统一：路径从 import.meta.url 推、Python 走 conn.mjs 的 findPython、fixture 缺失时现场生成。
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));       // <skill>/tests
export const SKILL = process.env.SKILL_DIR || path.dirname(HERE); // <skill>
export const FAKE = path.join(HERE, "fake-chrome.mjs");
export const L1 = path.join(SKILL, "projects", "creative-management");
export const skillUrl = (rel) => new URL("file:///" + path.join(SKILL, rel).replace(/\\/g, "/")).href;

// ---------- Python（annotate.py / fixture 生成要用）----------
const { findPython } = await import(skillUrl("scripts/conn.mjs"));
export const PYTHON = findPython(process.env.DSH_PYTHON || "");
export function requirePython() {
  if (!PYTHON) {
    throw new Error("找不到可用 Python（需要 Pillow）。用 --python / DSH_PYTHON 指定；本机运行时在 dependencies/python/python.exe");
  }
  return PYTHON;
}

// ---------- fixtures（xlsx/csv/json 三格式，4145 行）----------
// 不把二进制样本放进 skill：缺失就现场用 openpyxl 生成到临时目录。
export const FIXTURES = path.join(os.tmpdir(), "cdp-harness-fixtures");
export function ensureFixtures() {
  const need = ["export.xlsx", "export.csv", "export.json"];
  if (need.every((f) => fs.existsSync(path.join(FIXTURES, f)))) return FIXTURES;
  fs.mkdirSync(FIXTURES, { recursive: true });
  const r = spawnSync(requirePython(), [path.join(HERE, "fixtures", "gen_fixtures.py"), FIXTURES], { stdio: "inherit" });
  if (r.status !== 0 || !need.every((f) => fs.existsSync(path.join(FIXTURES, f)))) {
    throw new Error("fixture 生成失败（status=" + r.status + "）→ " + FIXTURES);
  }
  return FIXTURES;
}

// ---------- 假 Chrome ----------
export function startFake(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [FAKE, ...args], { stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    const to = setTimeout(() => reject(new Error("fake-chrome 启动超时")), 8000);
    p.stdout.on("data", (d) => {
      buf += d.toString();
      const nl = buf.indexOf("\n");
      if (nl >= 0) { clearTimeout(to); resolve({ proc: p, info: JSON.parse(buf.slice(0, nl)) }); }
    });
    p.on("error", reject);
  });
}

// ---------- 极简断言器 ----------
export function makeReporter() {
  const results = [];
  const ok = (name, cond, info = "") => {
    results.push({ name, pass: !!cond });
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`);
  };
  const done = () => {
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed}/${results.length} 通过`);
    process.exit(failed ? 1 : 0);
  };
  return { ok, done, results };
}

// ---------- 子进程跑 skill 脚本（顺带验证 CLI 与退出码）----------
export function runScript(relPath, args, { env = {} } = {}) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, [path.join(SKILL, relPath), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(PYTHON ? { DSH_PYTHON: PYTHON } : {}), ...env },
    });
    let so = "", se = "";
    p.stdout.on("data", (d) => (so += d));
    p.stderr.on("data", (d) => (se += d));
    p.on("close", (code) => res({ code, so, se, ms: Date.now() - t0 }));
  });
}
