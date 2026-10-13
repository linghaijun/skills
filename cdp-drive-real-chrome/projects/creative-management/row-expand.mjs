// 用法: node expand.mjs key1 key2 ...  —— 幂等：滚到该行；若视觉上的下一行不是它的子层级，才真实点击展开箭头
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs"; const c = await connect();
const click = async (p) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 }); };
const top = fs.readFileSync(new URL("./row-to-top.js", import.meta.url), "utf8");
const state = (k) => c.ev(`(() => { const rows=[...document.querySelectorAll('.surely-table-row[data-row-key]')].filter(e=>e.getBoundingClientRect().height>0 && !e.closest('.el-drawer'));
  const uniq=[]; const seen=new Set(); rows.sort((a,b)=>a.getBoundingClientRect().y-b.getBoundingClientRect().y).forEach(r=>{const key=r.getAttribute('data-row-key'); if(!seen.has(key)){seen.add(key); uniq.push(r);}});
  const i=uniq.findIndex(r=>r.getAttribute('data-row-key')===${JSON.stringify(k)}); if(i<0) return null; const lv=+(uniq[i].className.match(/level-(\\d)/)||[])[1]; const nx=uniq[i+1]; const nlv=nx? +(nx.className.match(/level-(\\d)/)||[])[1] : -1;
  const ic=[...document.querySelectorAll('.surely-table-row[data-row-key="'+${JSON.stringify(k)}+'"] .table-expand-elicon')].find(e=>e.getBoundingClientRect().width>0); const r=ic&&ic.getBoundingClientRect();
  return {expanded: nlv===lv+1, x: r&&r.x+r.width/2, y: r&&r.y+r.height/2}; })()`);
for (const k of process.argv.slice(2)) {
  await c.ev(`window.__rk=${JSON.stringify(k)}`); const t = await c.ev(top); if (t.err) { console.log(k, t.err); continue; }
  let s = await state(k); if (!s) { console.log(k, "not visible"); continue; }
  const want = !process.env.COLLAPSE; // COLLAPSE=1 时反向：只收起已展开的
  if (s.expanded === want) { console.log(k, want ? "already expanded" : "already collapsed"); continue; }
  if (s.x == null) { console.log(k, "no expander"); continue; }
  await click(s); await c.sleep(2500); s = await state(k); console.log(k, "clicked ->", s && s.expanded ? "expanded" : "collapsed");
}
c.close();
