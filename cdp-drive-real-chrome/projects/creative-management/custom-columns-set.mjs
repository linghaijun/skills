// 用法: CDP_TARGET=<id> node custom-columns-set.mjs outDir "Video:Views at 25%,6-second Views" "Traffic:PDPV Rate" ... [--prefix fix-r1-]
//   —— 打开 Custom Columns，真实点击勾选（已勾的跳过），Apply
//   产出 <outDir>/<prefix>cc-<分类>.png、<outDir>/<prefix>cc-log.json；--prefix 默认 fix-r1-（与旧文件名一致，2026-10-13 起可改）
//   🔴 Apply = 改持久化列偏好（localStorage，同实例所有标签共享）→ 并行时只能在「写偏好」组里串行跑
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const _a = process.argv.slice(2); const _pi = _a.indexOf("--prefix"); const PREFIX = _pi >= 0 ? _a[_pi + 1] : "fix-r1-";
const [E, ...specs] = _pi >= 0 ? _a.filter((x, i) => i !== _pi && i !== _pi + 1) : _a; const c = await connect();
const click = async (p) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 }); };
const shot = async (f) => { const s = await c.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(f, Buffer.from(s.data, "base64")); };
const DLG = `[...document.querySelectorAll('.el-dialog')].find(e => e.getBoundingClientRect().width > 0 && /Custom Columns/.test(e.innerText))`;
await c.ev(`window.scrollTo(0,0)`);
const icon = await c.ev(`(() => { const ic=[...document.querySelectorAll('.el-icon.pacvue-download-wrap')].find(e=>e.getBoundingClientRect().width>0 && !e.closest('.el-drawer,.el-dialog')); const r=ic.getBoundingClientRect(); return {x:r.x-40+r.width/2, y:r.y+r.height/2}; })()`);
await click(icon); await c.sleep(1500);
const m = await c.ev(`(() => { const it = [...document.querySelectorAll('li, div, span')].filter(e => e.childElementCount === 0 && e.textContent.trim() === 'Custom Columns' && e.getBoundingClientRect().width > 0 && !e.closest('.el-dialog')).pop(); if(!it) return null; const r = it.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
if (!m) { console.log("menu not open"); process.exit(3); }
await click(m); await c.sleep(2500); const log = [];
for (const spec of specs) { const [cat, list] = spec.split(":");
  const q = await c.ev(`(() => { const dlg = ${DLG}; const it = [...dlg.querySelectorAll('*')].find(e => e.childElementCount === 0 && e.textContent.trim() === '${cat}' && e.getBoundingClientRect().x < dlg.getBoundingClientRect().x + 200); const r = it.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await click(q); await c.sleep(1200);
  for (const name of list.split(",")) {
    const b = await c.ev(`(() => { const dlg = ${DLG}; const b = [...dlg.querySelectorAll('.el-checkbox')].find(e => e.getBoundingClientRect().height > 0 && e.innerText.trim() === ${JSON.stringify(name)}); if(!b) return null; b.scrollIntoView({block:'center'}); const r = b.querySelector('.el-checkbox__inner').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, checked: b.className.includes('is-checked') }; })()`);
    if (!b) { log.push(name + ": NOT FOUND"); continue; }
    if (b.checked) { log.push(name + ": already checked"); continue; }
    await click(b); await c.sleep(600); log.push(name + ": clicked");
  }
  await shot(`${E}/${PREFIX}cc-${cat}.png`);
}
const state = await c.ev(`(() => { const dlg = ${DLG}; const lines = dlg.innerText.split(String.fromCharCode(10)).map(s=>s.trim()).filter(Boolean); return lines.find(l => l.startsWith('Selected')); })()`);
const ap = await c.ev(`(() => { const b = [...(${DLG}).querySelectorAll('button')].find(b => b.innerText.trim() === 'Apply'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
await click(ap); await c.sleep(2500);
fs.writeFileSync(`${E}/${PREFIX}cc-log.json`, JSON.stringify({ specs, log, selected: state }, null, 1)); console.log(JSON.stringify({ log, selected: state })); c.close();
