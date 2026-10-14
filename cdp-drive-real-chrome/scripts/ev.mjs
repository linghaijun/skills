// L0 单步求值：  CDP_TARGET=<id> node ev.mjs "<表达式>"      或     node ev.mjs --file page.js
//               node ev.mjs --target <id> "<表达式>"         （--target / --port / --match / --index 实参优先于环境变量，位置不限）
// 页面代码含正则 / 反斜杠时用 --file（原样注入，避免模板字符串与 shell 吞反斜杠，见 SCRIPTS.md 坑 22/23）
import { connect, cliTargetOpts } from "./conn.mjs"; import fs from "node:fs";
const argv = process.argv.slice(2);
const VALUED = new Set(["--file", "--target", "--port", "--match", "--index"]);
const pos = argv.filter((a, k) => !VALUED.has(a) && !VALUED.has(argv[k - 1])); // 去掉带值参数及其值，剩下的才是表达式
const i = argv.indexOf("--file");
const expr = i >= 0 ? fs.readFileSync(argv[i + 1], "utf8") : pos[0];
if (!expr) { console.error('usage: node ev.mjs [--target <id>] "<expr>" | --file page.js'); process.exit(2); }
let c;
try {
  c = await connect(cliTargetOpts());
  const r = await c.ev(expr, 180000);
  console.log(typeof r === "string" ? r : JSON.stringify(r, null, 1));
} catch (e) {
  console.error("ev: " + e.message);
  process.exitCode = 1;
} finally {
  c?.close();
}
