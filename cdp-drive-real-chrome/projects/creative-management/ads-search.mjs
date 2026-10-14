// Ads 页搜索框（Search Ad/Creative Name）输入关键字 → 点 Search（真鼠标）→ 等加载结束；传空串 = 清空搜索
//   CDP_TARGET=<id> node ads-search.mjs "<keyword>"
// 搜索条件不是持久化偏好（不进 localStorage），并行时可用；但会改变当前窗口列表，读数前确认 Total 与关键字
import { connect } from "../../scripts/conn.mjs";
import { makeBusyGone, waitBusyGone } from "./wait-lib.mjs";
const kw = process.argv[2] ?? ""; const c = await connect();
const busyGone = makeBusyGone(c);
const inp = await c.ev(`(() => { const i=[...document.querySelectorAll('input')].find(i=>i.placeholder==='Search Ad/Creative Name' && i.offsetParent); if(!i) return null; i.scrollIntoView({block:'center'}); const r=i.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
if (!inp) { console.error("search input not found"); process.exit(3); }
await c.click(inp); await c.sleep(300);
await c.key("a", "KeyA", 65).catch(() => {});
await c.ev(`(() => { const i=document.activeElement; if (i && i.tagName==='INPUT') { i.select(); } return 1; })()`);
await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
if (kw) await c.send("Input.insertText", { text: kw });
const btn = await c.ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent && b.textContent.trim()==='Search' && !b.closest('.el-dialog,.el-drawer')); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
await c.click(btn);
await waitBusyGone(c, busyGone, { label: "ads-search" });
const st = await c.ev(`({ value: [...document.querySelectorAll('input')].find(i=>i.placeholder==='Search Ad/Creative Name')?.value, total: (document.body.innerText.match(/Total \\d+ entries/)||[])[0] })`);
console.log(JSON.stringify(st)); c.close();
