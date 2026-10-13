// 横向滚动列表到最右（window.__hx 指定像素则滚到该位置）
(() => { const els=[...document.querySelectorAll('.surely-table-body, .surely-table-header, [class*=surely-table-center]')].filter(e=>e.scrollWidth>e.clientWidth+20 && !e.closest('.el-drawer,.el-dialog'));
 const res=els.map(e=>{ e.scrollLeft = window.__hx ?? e.scrollWidth; e.dispatchEvent(new Event('scroll')); return String(e.className).slice(0,40)+':'+Math.round(e.scrollLeft); }); return res; })()
