// Ads / Tag 页：日期面板里若 Compare 已勾则真实点掉 → Apply → 等加载结束（compare-on.mjs 的反操作）
//   CDP_TARGET=<id> node compare-off.mjs
import { connect } from "../../scripts/conn.mjs";
const c = await connect();
const busy = () => c.ev(`[...document.querySelectorAll(".el-loading-mask,.pacvue-loading-mask")].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=="none"&&!e.closest('.el-dialog,.el-drawer')})`);
await c.ev("window.scrollTo(0,0)");
const open = await c.ev(`!![...document.querySelectorAll('.cus_checkout')].find(e=>e.getBoundingClientRect().width>0 && e.textContent.trim()==='Compare')`);
if (!open) { const d = await c.ev(`(() => { const e=document.querySelector('.reportrange-text'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`); await c.click(d); await c.sleep(1500); }
const cb = await c.ev(`(() => { const e=[...document.querySelectorAll('.cus_checkout')].find(e=>e.getBoundingClientRect().width>0 && e.textContent.trim()==='Compare'); const r=e.getBoundingClientRect(); return {x:r.x+10,y:r.y+r.height/2, checked: !!e.querySelector('input')?.checked}; })()`);
if (cb.checked) { await c.click(cb); await c.sleep(1000); }
const ap = await c.ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.getBoundingClientRect().width>0 && b.textContent.trim()==='Apply'); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
await c.click(ap);
for (let k = 0; k < 180; k++) { await c.sleep(1000); if (!(await busy()) && k > 3) break; }
const after = await c.ev(`[...document.querySelectorAll('.cus_checkout')].find(e=>e.textContent.trim()==='Compare')?.querySelector('input')?.checked ?? null`);
console.log(JSON.stringify({ wasChecked: cb.checked, compareCheckedAfter: after })); c.close();
