/**
 * 执行 Atlassian Media phase1 的 uploadCommand，stdout 只打印一行 fileId。
 *
 * 用法（推荐）：
 *   把 MCP 返回的整段 JSON（或仅含 uploadCommand 字段）存成文件后：
 *     node jira-run-upload-command.mjs upload-phase1.json [--out resp.json]
 *
 * 也支持：文件内容就是一整行 curl / 一个 .cmd（含 uploadCommand 原文）。
 *
 * 约定：
 * - 禁止手抄 Bearer；MCP 响应 Write 落盘再跑（手抄易令牌签名失败）
 * - 跑完由调用方删除含 token 的临时文件
 * - 成功后拿 fileId → MCP phase2 挂附件，或 html 内嵌（见 jira-comment-template.md）
 *
 * 最后验证：2026-10-14（CP-58922）
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";

const file = process.argv[2];
const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;

if (!file) {
  console.error("usage: node jira-run-upload-command.mjs <phase1.json|cmd|txt> [--out resp.json]");
  process.exit(2);
}

const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
  console.error("file not found: " + abs);
  process.exit(2);
}

const text = fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, "").trim();
let uploadCommand = text;

if (text.startsWith("{")) {
  try {
    const j = JSON.parse(text);
    uploadCommand =
      j.uploadCommand ||
      j.data?.uploadCommand ||
      j.result?.uploadCommand ||
      null;
    if (!uploadCommand) {
      console.error("JSON has no uploadCommand field");
      process.exit(2);
    }
  } catch (e) {
    console.error("invalid JSON: " + e.message);
    process.exit(2);
  }
}

// 归一成 Windows cmd 可跑的一行（MCP 给的是 curl --location '...' 形式）
let cmdBody = uploadCommand.trim();
if (cmdBody.startsWith("curl ")) {
  cmdBody = cmdBody.replace(/^curl\b/, "curl.exe");
}

const tmpCmd = path.join(os.tmpdir(), `jira-media-upload-${Date.now()}.cmd`);
fs.writeFileSync(tmpCmd, "@echo off\r\n" + cmdBody + "\r\n", "utf8");

const result = spawnSync("cmd.exe", ["/c", tmpCmd], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});

try {
  fs.unlinkSync(tmpCmd);
} catch {
  /* ignore */
}

const stdout = (result.stdout || "").trim();
const stderr = (result.stderr || "").trim();

// curl 进度在 stderr；JSON 在 stdout。若失败，stderr 可能含 error JSON
let jsonText = stdout;
if (!jsonText && stderr.includes("{")) {
  const m = stderr.match(/\{[\s\S]*\}/);
  if (m) jsonText = m[0];
}

if (!jsonText) {
  console.error(stderr || "upload produced no output, exit " + result.status);
  process.exit(result.status || 1);
}

let parsed;
try {
  parsed = JSON.parse(jsonText.replace(/^[\s\S]*?(\{[\s\S]*\})\s*$/, "$1"));
} catch (e) {
  console.error("cannot parse media JSON: " + e.message);
  console.error(jsonText.slice(0, 500));
  process.exit(1);
}

if (parsed.error) {
  console.error(JSON.stringify(parsed.error));
  process.exit(1);
}

const id = parsed?.data?.id;
if (!id) {
  console.error("no data.id in response");
  process.exit(1);
}

if (outPath) fs.writeFileSync(path.resolve(outPath), JSON.stringify(parsed, null, 2), "utf8");
process.stdout.write(id + "\n");
