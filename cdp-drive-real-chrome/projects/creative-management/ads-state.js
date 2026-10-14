// Ads 页状态快照：日期 / 素材类型页签 / KPI 卡片 / 可见表头 / Total / 偏好类 localStorage key 名（只列 key，不读值）
// 可选：先 `window.__lsExcludeUid = <userId>` 排除另一个账号的偏好 key（原写死 2572 = client 777 账号，2026-10-13 参数化；不设 = 不排除）
(() => ({ range: document.querySelector('.reportrange-text')?.textContent.trim(), tab: document.querySelector('.file-type-tab--active')?.textContent.trim(),
  cards: [...document.querySelectorAll('.creative-performance-panel .card-item, [class*=panel] [class*=card]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.innerText.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,30),
  headers: [...document.querySelectorAll('.surely-table-header-cell')].filter(e=>e.getBoundingClientRect().width>0 && !e.closest('.el-drawer,.el-dialog')).map(h=>h.innerText.trim()).filter(Boolean),
  total: (document.body.innerText.match(/Total \d+ entries/)||[])[0],
  ls: Object.keys(localStorage).filter(k=>/lastSearchColumn|showList/.test(k) && !(window.__lsExcludeUid && k.includes(String(window.__lsExcludeUid)))) }))()
