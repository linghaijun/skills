// 把 data-row-key=window.__rk 的行滚到吸顶表头正下方；行未被虚拟渲染时从顶部逐步滚动寻找
(async () => { const k=String(window.__rk); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const body=[...document.querySelectorAll('.surely-table-body')].find(e=>e.getBoundingClientRect().width>0 && !e.closest('.el-drawer,.el-dialog'));
 const find=()=>[...document.querySelectorAll('.surely-table-row[data-row-key]')].find(e=>e.getAttribute('data-row-key')===k && e.getBoundingClientRect().height>0 && !e.closest('.el-drawer'));
 let row=find(); if(!row){ body.scrollTop=0; await sleep(400); for(let i=0;i<80 && !(row=find());i++){ body.scrollTop+=300; await sleep(250);} }
 if(!row) return {err:'row not found '+k};
 const hdr=[...document.querySelectorAll('.surely-table-header-cell')].find(e=>e.getBoundingClientRect().width>0 && !e.closest('.el-drawer,.el-dialog'));
 body.scrollTop += row.getBoundingClientRect().y - (hdr.getBoundingClientRect().bottom + 4); await sleep(600); row=find();
 return {after: row && Math.round(row.getBoundingClientRect().y), hdrBottom: Math.round(hdr.getBoundingClientRect().bottom)}; })()
