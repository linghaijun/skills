// 读 window.__rk 行若干列的环比单元格结构：数值 / 变化率文本 / 颜色 / 箭头
(() => { const k=String(window.__rk); const cols=window.__cols||['impressions','clicks','pdpv','videoViews','video6SecondViews'];
 const parts=[...document.querySelectorAll('.surely-table-row[data-row-key]')].filter(e=>e.getAttribute('data-row-key')===k && e.getBoundingClientRect().height>0 && !e.closest('.el-drawer'));
 const out={}; for (const col of cols) { const cell=parts.map(p=>p.querySelector('.surely-table-cell[data-column-id="'+col+'"]')).find(Boolean); if(!cell){out[col]=null; continue;}
   const leafs=[...cell.querySelectorAll('*')].filter(e=>e.childElementCount===0 && e.textContent.trim());
   out[col]={ text: cell.innerText.split(String.fromCharCode(10)).map(s=>s.trim()).filter(Boolean), parts: leafs.map(e=>({t:e.textContent.trim(), color:getComputedStyle(e).color, cls:String(e.className).slice(0,40)})), icons:[...cell.querySelectorAll('svg,i,.el-icon,[class*=arrow],[class*=up],[class*=down]')].map(e=>String(e.className?.baseVal??e.className).slice(0,50)) }; }
 return out; })()
