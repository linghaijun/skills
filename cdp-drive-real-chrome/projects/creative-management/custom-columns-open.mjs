// 打开 Custom Columns 并切到指定分类，返回勾选状态（不改任何勾选）
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const [cat, shotFile] = process.argv.slice(2); const c = await connect();
const click = async (p) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 }); };
const DLG = `[...document.querySelectorAll('.el-dialog')].find(e => e.getBoundingClientRect().width > 0 && /Custom Columns/.test(e.innerText))`;
const icon = await c.ev(`(() => { const ic=[...document.querySelectorAll('.el-icon.pacvue-download-wrap')].find(e=>e.getBoundingClientRect().width>0 && !e.closest('.el-drawer,.el-dialog')); const r=ic.getBoundingClientRect(); return {x:r.x-40+r.width/2, y:r.y+r.height/2}; })()`);
await click(icon); await c.sleep(1500);
const m = await c.ev(`(() => { const it = [...document.querySelectorAll('li, div, span')].filter(e => e.childElementCount === 0 && e.textContent.trim() === 'Custom Columns' && e.getBoundingClientRect().width > 0 && !e.closest('.el-dialog')).pop(); if(!it) return null; const r = it.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
await click(m); await c.sleep(2500);
const q = await c.ev(`(() => { const dlg = ${DLG}; const it = [...dlg.querySelectorAll('*')].find(e => e.childElementCount === 0 && e.textContent.trim() === '${cat}' && e.getBoundingClientRect().x < dlg.getBoundingClientRect().x + 200); const r = it.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
await click(q); await c.sleep(1200);
const st = await c.ev(`(() => { const dlg = ${DLG}; const lines = dlg.innerText.split(String.fromCharCode(10)).map(s=>s.trim()).filter(Boolean); return { selected: lines.find(l => l.startsWith('Selected')), boxes: [...dlg.querySelectorAll('.el-checkbox')].filter(e => e.getBoundingClientRect().height > 0).map(e => e.innerText.trim() + (e.className.includes('is-checked') ? ' [x]' : ' [ ]')) }; })()`);
if (shotFile) { const s = await c.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(shotFile, Buffer.from(s.data, "base64")); }
console.log(JSON.stringify(st)); c.close();
