// Ads 页列表工具栏的导出图标中心坐标（不在抽屉 / 弹框内的那个 .pacvue-download-wrap；顶栏下载中心是另一个元素）
(() => { const ic=[...document.querySelectorAll('.el-icon.pacvue-download-wrap')].find(e=>e.getBoundingClientRect().width>0 && !e.closest('.el-drawer,.el-dialog')); if(!ic) return null; ic.scrollIntoView({block:'center'}); const r=ic.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()
