(() => ({ range: document.querySelector('.reportrange-text')?.textContent.trim(), tab: document.querySelector('.file-type-tab--active')?.textContent.trim(),
  cards: [...document.querySelectorAll('.creative-performance-panel .card-item, [class*=panel] [class*=card]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.innerText.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,30),
  headers: [...document.querySelectorAll('.surely-table-header-cell')].filter(e=>e.getBoundingClientRect().width>0 && !e.closest('.el-drawer,.el-dialog')).map(h=>h.innerText.trim()).filter(Boolean),
  total: (document.body.innerText.match(/Total \d+ entries/)||[])[0],
  ls: Object.keys(localStorage).filter(k=>/lastSearchColumn|showList/.test(k) && !/2572/.test(k)) }))()
