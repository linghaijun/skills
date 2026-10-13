// L0 单步求值：  CDP_TARGET=<id> node ev.mjs "<表达式>"      或     node ev.mjs --file page.js
// 页面代码含正则 / 反斜杠时用 --file（原样注入，避免模板字符串与 shell 吞反斜杠，见 SCRIPTS.md 坑 22/23）
import { connect } from "./conn.mjs"; import fs from "node:fs";
const i = process.argv.indexOf("--file");
const expr = i > 0 ? fs.readFileSync(process.argv[i + 1], "utf8") : process.argv[2];
if (!expr) { console.error('usage: node ev.mjs "<expr>" | --file page.js'); process.exit(2); }
const c = await connect(); const r = await c.ev(expr, 180000);
console.log(typeof r === "string" ? r : JSON.stringify(r, null, 1)); c.close();
