// L0「首次进入」模拟：清掉用户偏好类 localStorage key 后重新进入页面（AC 前置「首次进入、未做过配置」的证据）
//
//   CDP_TARGET=<id> node fresh-entry.mjs --keys "lastSearchColumn|showList" [--exclude "2572"] \
//       --back "http://localhost:3001/xxx/Page" [--static "/@vite/client"] [--out fresh-run.json] [--backup bk.json]
//
// 🔴 为什么不能「删 key → location.reload()」：页面卸载时组件会把**内存里的配置写回** localStorage，
//    删了等于没删（实测：删完刷新，key 又带着旧值回来了）。
//    做法：先把标签导航到**同源但不跑应用代码**的资源（vite 的 /@vite/client、/favicon.ico 之类），
//    此时应用已卸载、写回已发生，再删 key，最后导航回目标页 —— 这才是真正的「首次进入」。
//    about:blank 不行：它不是同源，访问不到目标域的 localStorage。
//
// 输出：{ deleted, leftAfterDelete, backup }；--backup 把被删 key 的原值存盘，测完可恢复。
// ⚠️ 只删 --keys 命中的偏好类 key；登录态/凭据类 key 不碰，也不要把它们写进任何证据文件。
import { connect } from "./conn.mjs"; import fs from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const KEYS = arg("--keys"); const EXC = arg("--exclude", ""); const BACK = arg("--back"); const STATIC = arg("--static", "/@vite/client");
if (!KEYS || !BACK) { console.error("need --keys <regex> --back <url>"); process.exit(2); }
const origin = new URL(BACK).origin;
const c = await connect(); await c.send("Page.enable");
await c.send("Page.navigate", { url: origin + STATIC }); await c.sleep(2500);
const r = await c.ev(`(() => { const re = new RegExp(${JSON.stringify(KEYS)}); const ex = ${JSON.stringify(EXC)} ? new RegExp(${JSON.stringify(EXC)}) : null;
  const del = Object.keys(localStorage).filter(k => re.test(k) && !(ex && ex.test(k))); const backup = {}; del.forEach(k => { backup[k] = localStorage[k]; localStorage.removeItem(k); });
  return { href: location.href, deleted: del, leftAfterDelete: Object.keys(localStorage).filter(k => re.test(k) && !(ex && ex.test(k))), backup }; })()`);
if (arg("--backup")) fs.writeFileSync(arg("--backup"), JSON.stringify(r.backup, null, 1));
delete r.backup;
await c.send("Page.navigate", { url: BACK });
if (arg("--out")) fs.writeFileSync(arg("--out"), JSON.stringify(r, null, 1));
console.log(JSON.stringify(r)); c.close();
