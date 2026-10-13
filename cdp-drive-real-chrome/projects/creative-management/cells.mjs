// 用法: node cells.mjs out.json parentKey "kidKey1,kidKey2,..." col1,col2,...  —— DOM 文本 + 矩形（截图像素）
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const [out, pk, kids, cols] = process.argv.slice(2); const c = await connect();
const r = await c.ev(`(() => { const s=devicePixelRatio; const keys=[${JSON.stringify(pk)}, ...${JSON.stringify(kids.split(","))}]; const cols=${JSON.stringify(cols.split(","))};
 const res={rows:{}, rects:{}};
 for (const k of keys) { res.rows[k]={}; const parts=[...document.querySelectorAll('.surely-table-row[data-row-key]')].filter(e=>e.getAttribute('data-row-key')===k && e.getBoundingClientRect().height>0 && !e.closest('.el-drawer'));
   for (const col of cols) { const cell=parts.map(p=>p.querySelector('.surely-table-cell[data-column-id="'+col+'"]')).find(Boolean); if(!cell) continue; res.rows[k][col]=cell.innerText.replace(/\\s+/g,' ').trim();
     const b=cell.getBoundingClientRect(); const R=[b.x*s,b.y*s,b.right*s,b.bottom*s].map(Math.round); const lab=(k===keys[0]?'P_':'K_')+col; const o=res.rects[lab]; res.rects[lab]= o?[Math.min(o[0],R[0]),Math.min(o[1],R[1]),Math.max(o[2],R[2]),Math.max(o[3],R[3])]:R; } }
 return res; })()`);
fs.writeFileSync(out, JSON.stringify(r, null, 1)); fs.writeFileSync(out.replace(/\.json$/, ".rects.json"), JSON.stringify(r.rects)); console.log(JSON.stringify(r.rows)); c.close();
