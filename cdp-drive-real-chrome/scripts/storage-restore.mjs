// L0 测后恢复 localStorage 偏好（fresh-entry.mjs 的反操作）：离开到同源静态资源 → 删除 --keys 命中的 key → 写回备份 → 回到页面
//
//   CDP_TARGET=<id> node storage-restore.mjs --backup bk.json --keys "lastSearchColumn|showList" [--exclude "2572"] --back <url> [--static "/@vite/client"]
//
//   bk.json：{ key: value(string) }（fresh-entry.mjs --backup 或测前自己导出的原值）
//   命中 --keys 但不在备份里的 key 会被**删除**（= 测前不存在，回到默认）
// 🔴 必须先离开应用页再改：页面卸载时会把内存配置写回 localStorage，在应用页里直接改会被覆盖（坑 24）
import { connect } from "./conn.mjs"; import fs from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BK = arg("--backup"); const KEYS = arg("--keys"); const EXC = arg("--exclude", ""); const BACK = arg("--back"); const STATIC = arg("--static", "/@vite/client");
if (!BK || !KEYS || !BACK) { console.error("need --backup --keys --back"); process.exit(2); }
const backup = JSON.parse(fs.readFileSync(BK, "utf8")); const origin = new URL(BACK).origin;
const c = await connect(); await c.send("Page.enable");
await c.send("Page.navigate", { url: origin + STATIC }); await c.sleep(2500);
const r = await c.ev(`(() => { const re=new RegExp(${JSON.stringify(KEYS)}); const ex=${JSON.stringify(EXC)} ? new RegExp(${JSON.stringify(EXC)}) : null; const bk=${JSON.stringify(backup)};
  const hit=Object.keys(localStorage).filter(k=>re.test(k) && !(ex && ex.test(k))); const deleted=hit.filter(k=>!(k in bk)); hit.forEach(k=>localStorage.removeItem(k));
  Object.entries(bk).forEach(([k,v])=>localStorage.setItem(k,v));
  const now=Object.keys(localStorage).filter(k=>re.test(k) && !(ex && ex.test(k))); return { href: location.href, deletedNotInBackup: deleted, restored: Object.keys(bk), allMatch: Object.entries(bk).every(([k,v])=>localStorage.getItem(k)===v), nowKeys: now }; })()`);
await c.send("Page.navigate", { url: BACK });
console.log(JSON.stringify(r, null, 1)); c.close();
