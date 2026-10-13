// 完整数字/缩写切换：与 Group by 下拉同一行、带 tooltip 的第一个图标
(() => { const gb=[...document.querySelectorAll('span')].find(e=>e.childElementCount===0 && /^(Asset|Ad|Asset Group)( - .*)?$/.test(e.textContent.trim()) && e.getBoundingClientRect().width>0 && !e.closest('.surely-table,.pacvue-table-title-cell')); const y=gb.getBoundingClientRect().y;
 const ics=[...document.querySelectorAll('.el-icon.cursor-pointer.el-tooltip__trigger')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && Math.abs(r.y-y)<30 && r.x>gb.getBoundingClientRect().x}).sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x);
 const e=ics[0]; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,n:ics.length}; })()
