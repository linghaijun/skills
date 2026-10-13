// 用法: node colrect.mjs out.json "lab=dataIndex|表头文字[|maxRows]" ...  —— 表头 + 可见单元格外接框（截图像素）
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const c = await connect(); const out = {};
for (const a of process.argv.slice(3)) { const i = a.indexOf("="); const lab = a.slice(0, i); const [di, title, maxRows] = a.slice(i + 1).split("|");
  out[lab] = await c.ev(`(() => { const s=devicePixelRatio; const ok=e=>{const r=e.getBoundingClientRect(); return r.height>0 && r.width>0 && r.bottom<=innerHeight && !e.closest('.el-drawer,.el-dialog')};
   const h=[...document.querySelectorAll('.surely-table-header-cell')].filter(e=>ok(e) && e.innerText.replace(/\\s+/g," ").trim()===${JSON.stringify(title)});
   const cells=[...document.querySelectorAll('.surely-table-cell[data-column-id="${di}"]')].filter(ok).sort((a,b)=>a.getBoundingClientRect().y-b.getBoundingClientRect().y).slice(0, ${Number(maxRows || 99)});
   const all=[...h,...cells]; if(!all.length) return null; const rs=all.map(e=>e.getBoundingClientRect());
   return [Math.min(...rs.map(r=>r.x))*s, Math.min(...rs.map(r=>r.y))*s, Math.max(...rs.map(r=>r.right))*s, Math.max(...rs.map(r=>r.bottom))*s].map(Math.round); })()`); }
fs.writeFileSync(process.argv[2], JSON.stringify(out)); console.log(JSON.stringify(out)); c.close();
