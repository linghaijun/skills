// L0 给 <input type=file> 设文件（DOM.setFileInputFiles；取自 browser-harness upload_file，2026-10-14）
//
// 不用点「上传」按钮、不弹系统文件框：直接把文件塞给 file input（el-upload 那种隐藏的 input 也行），然后读回 files 个数 / 文件名。
// 🔴 el-upload 多为 auto-upload：文件一设上就会发上传请求 = 写操作，按 SKILL 红线需用户本轮授权；只想验证选择逻辑先确认组件是否 auto-upload。
//
// 用法:
//   CDP_TARGET=<id> node upload.mjs --sel "input[type=file]" --file a.png[,b.png]
//   node upload.mjs --sel ".el-upload input" --nth 1 --file "D:/样图/参考图.png"
//   --target / --port / --match / --index 同 conn.mjs
//
// 输出 {sel, nth, files, readBack:{n,names}}；读回个数与给的文件数不一致退出码 1（input 没有 multiple 时只会留 1 个）。
// 退出码：0 成功 / 1 读回不一致 / 2 参数错 / 3 找不到元素或文件
import fs from "node:fs";
import path from "node:path";
import { connect, cliTargetOpts } from "./conn.mjs";

const flag = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : d; };
const SEL = flag("--sel", "input[type=file]");
const NTH = Number(flag("--nth", 0));
const FILES = String(flag("--file", "")).split(",").map((s) => s.trim()).filter(Boolean).map((f) => path.resolve(f));
if (!FILES.length) { console.error('usage: node upload.mjs --sel "input[type=file]" --file a.png[,b.png] [--nth N]'); process.exit(2); }
for (const f of FILES) if (!fs.existsSync(f)) { console.error("文件不存在: " + f); process.exit(3); }

let c;
try { c = await connect(cliTargetOpts()); } catch (e) { console.error("NO_PAGE_TARGET " + e.message); process.exit(3); }
try {
  const n = await c.ev(`document.querySelectorAll(${JSON.stringify(SEL)}).length`);
  if (n <= NTH) { console.error(`选择器 ${SEL} 命中 ${n} 个，没有第 ${NTH} 个`); c.close(); process.exit(3); }
  const back = await c.setFiles(`document.querySelectorAll(${JSON.stringify(SEL)})[${NTH}]`, FILES);
  const okType = String(back.type).toLowerCase() === "file";
  console.log(JSON.stringify({ sel: SEL, nth: NTH, files: FILES, readBack: back, ...(okType ? {} : { warn: "命中的不是 type=file 的 input" }) }, null, 1));
  process.exitCode = back.n === FILES.length ? 0 : 1;
} catch (e) {
  console.error("upload: " + e.message);
  process.exitCode = 3;
} finally { c.close(); }
